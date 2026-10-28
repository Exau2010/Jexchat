'use strict';
// Images de discussion : fichiers dans Supabase Storage (bucket privé « jexchatmedia »),
// métadonnées dans MongoDB. 5 images actives max par conversation, expiration 10 min.
// Module additif : monté depuis server.js, n'altère aucun autre système.
const crypto = require('crypto');
const mongoose = require('mongoose');

const BUCKET = 'jexchatmedia';
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ACTIVE = 5;
const TTL_MS = 10 * 60 * 1000;
const PENDING_MS = 2 * 60 * 1000; // un envoi non terminé après 2 min est nettoyé
const SWEEP_MS = 30 * 1000;
const URL_PREFIX = '/api/chat-images/';

const schema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
  messageId: { type: mongoose.Schema.Types.ObjectId, default: null },
  path: { type: String, required: true },
  mime: { type: String, required: true },
  size: { type: Number, default: 0 },
  slot: { type: Number, default: undefined }, // 0..4 tant que l'image occupe une place ; retiré à l'expiration/suppression
  status: { type: String, enum: ['pending', 'active'], default: 'pending' },
  attempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: true },
});
// Au plus une image par place et par conversation : garantit la limite même avec des envois simultanés.
schema.index({ conversationId: 1, slot: 1 }, { unique: true, partialFilterExpression: { slot: { $type: 'number' } } });
const ChatImage = mongoose.models.ChatImage || mongoose.model('ChatImage', schema);

let client = null;
function supa() {
  if (client) return client;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  const { createClient } = require('@supabase/supabase-js');
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

// Format réel d'après les premiers octets (jamais le seul type MIME envoyé par le navigateur).
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

async function freeExpired(conversationId) {
  await ChatImage.updateMany({ conversationId, slot: { $type: 'number' }, expiresAt: { $lte: new Date() } }, { $unset: { slot: 1 } });
}

// Réserve une place de façon atomique (index unique) ; null si les 5 places sont prises.
async function reserve(conversationId, senderId, doc) {
  await freeExpired(conversationId);
  for (let slot = 0; slot < MAX_ACTIVE; slot++) {
    try {
      return await ChatImage.create({ ...doc, conversationId, senderId, slot, status: 'pending', expiresAt: new Date(Date.now() + PENDING_MS) });
    } catch (e) {
      if (e && e.code === 11000) continue;
      throw e;
    }
  }
  return null;
}

async function removeFile(path) {
  const s = supa();
  if (!s) throw new Error('storage non configuré');
  const { error } = await s.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(error.message || 'remove');
}

// Libère la place, rend l'image inaccessible, supprime le fichier puis les références (réessai si échec).
async function purge(img, io, db) {
  await ChatImage.updateOne({ _id: img._id }, { $unset: { slot: 1 }, $set: { expiresAt: new Date(Math.min(+img.expiresAt, Date.now())) } });
  try { await removeFile(img.path); } catch (e) {
    await ChatImage.updateOne({ _id: img._id }, { $inc: { attempts: 1 } });
    console.warn('[ChatMedia] suppression différée:', e.message);
    return false;
  }
  await ChatImage.deleteOne({ _id: img._id });
  if (img.messageId) {
    try {
      const msg = await db.getMessageById(img.messageId);
      await db.permanentDeleteMessage(img.messageId);
      const conv = await db.getConversationById(img.conversationId);
      if (conv && io) for (const m of conv.members) io.to(`user:${m.toString()}`).emit('message_deleted', { messageId: String(img.messageId), conversationId: img.conversationId });
      void msg;
    } catch (e) { console.warn('[ChatMedia] message:', e.message); }
  }
  return true;
}

async function sweep(io, db) {
  if (mongoose.connection.readyState !== 1) return;
  const list = await ChatImage.find({ expiresAt: { $lte: new Date() } }).limit(100).lean();
  for (const img of list) await purge(img, io, db);
}

// Appelé par la suppression manuelle d'un message image (même mécanisme, fichier supprimé aussi).
async function removeByMessage(messageId, io, db) {
  const img = await ChatImage.findOne({ messageId }).lean();
  if (img) await purge(img, io, db);
}

// Appelé par POST /messages : valide qu'une image téléversée peut être rattachée à ce message.
async function claim(imageId, userId, conversationId) {
  if (!mongoose.isValidObjectId(imageId)) return null;
  return ChatImage.findOneAndUpdate(
    { _id: imageId, senderId: userId, conversationId, status: 'active', messageId: null, expiresAt: { $gt: new Date() } },
    { $set: { messageId: new mongoose.Types.ObjectId() } }, // marque « pris » ; l'id réel est posé par attach()
    { new: true }
  );
}
async function attach(imageId, messageId) { await ChatImage.updateOne({ _id: imageId }, { $set: { messageId } }); }
async function release(imageId) { await ChatImage.updateOne({ _id: imageId }, { $set: { messageId: null } }); }
const urlFor = (id) => URL_PREFIX + id;

function mount(app, sec, io, db) {
  const raw = require('express').raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: MAX_BYTES });
  const upLimiter = sec.createRateLimiter(15, 60 * 1000, (r) => (r.user?._id || r.ip) + ':img');

  app.post('/api/conversations/:id/images', sec.requireAuth, upLimiter, raw, async (req, res) => {
    let rec = null;
    try {
      if (!supa()) return res.status(503).json({ error: 'Envoi d’images non configuré (SUPABASE_URL / SUPABASE_SECRET_KEY).' });
      if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
      const conv = await db.getConversationById(req.params.id);
      if (!conv || !conv.members.map(String).includes(req.user._id.toString())) return res.status(403).json({ error: 'Accès non autorisé.' });
      if (conv.type === 'private') {
        const me = await db.findUserById(req.user._id);
        const otherId = conv.members.map(String).find((m) => m !== req.user._id.toString());
        const other = await db.findUserById(otherId);
        if (me.blockedUsers?.map(String).includes(otherId) || other?.blockedUsers?.map(String).includes(req.user._id.toString())) return res.status(403).json({ error: 'Action non autorisée.' });
      }
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Image manquante.' });
      if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'Image trop lourde (5 Mo max).' });
      const kind = sniff(buf);
      if (!kind) return res.status(415).json({ error: 'Format non autorisé (JPEG, PNG ou WebP uniquement).' });

      const objectPath = `${req.params.id}/${crypto.randomBytes(16).toString('hex')}.${kind.ext}`;
      rec = await reserve(req.params.id, req.user._id, { path: objectPath, mime: kind.mime, size: buf.length });
      if (!rec) return res.status(409).json({ error: 'Limite atteinte : 5 images actives dans cette conversation. Réessayez quand l’une aura expiré.' });

      const { error } = await supa().storage.from(BUCKET).upload(objectPath, buf, { contentType: kind.mime, upsert: false, cacheControl: '60' });
      if (error) { await ChatImage.deleteOne({ _id: rec._id }); rec = null; console.warn('[ChatMedia] upload:', error.message); return res.status(502).json({ error: 'Échec de l’envoi de l’image. Réessayez.' }); }

      const expiresAt = new Date(Date.now() + TTL_MS); // à partir de l'envoi réellement réussi
      await ChatImage.updateOne({ _id: rec._id }, { $set: { status: 'active', expiresAt } });
      return res.status(201).json({ imageId: rec._id, expiresAt });
    } catch (e) {
      console.error('[ChatMedia]', e.message);
      if (rec) { await ChatImage.updateOne({ _id: rec._id }, { $set: { expiresAt: new Date() } }).catch(() => {}); }
      return res.status(500).json({ error: 'Erreur.' });
    }
  });

  // Accès : droits vérifiés + expiration vérifiée à chaque demande ; URL signée très courte, jamais en cache partagé.
  app.get(URL_PREFIX + ':imageId', sec.requireAuth, async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.imageId) || !supa()) return res.status(404).end();
      const img = await ChatImage.findById(req.params.imageId).lean();
      if (!img || img.status !== 'active' || +img.expiresAt <= Date.now()) return res.status(410).json({ error: 'Image expirée.' });
      const conv = await db.getConversationById(img.conversationId);
      if (!conv || !conv.members.map(String).includes(req.user._id.toString())) return res.status(403).end();
      const secs = Math.max(1, Math.min(30, Math.floor((+img.expiresAt - Date.now()) / 1000)));
      const { data, error } = await supa().storage.from(BUCKET).createSignedUrl(img.path, secs);
      if (error || !data?.signedUrl) return res.status(502).end();
      res.set('Cache-Control', 'private, no-store');
      return res.redirect(302, data.signedUrl);
    } catch (e) { return res.status(500).end(); }
  });

  sweep(io, db).catch((e) => console.warn('[ChatMedia] sweep:', e.message)); // rattrapage au démarrage
  const t = setInterval(() => sweep(io, db).catch((e) => console.warn('[ChatMedia] sweep:', e.message)), SWEEP_MS);
  t.unref?.();
}

module.exports = { mount, claim, attach, release, removeByMessage, urlFor, URL_PREFIX, _sniff: sniff };
