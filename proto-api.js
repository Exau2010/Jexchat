'use strict';
// Module additif (monté depuis server.js) : tout ce que l'interface « prototype » demande en plus
// du backend existant — profil enrichi, photo de profil, abonnements, publications enregistrées,
// tendances, liste complète des notifications, comptes privés, « qui peut m'écrire ».
// Aucune route existante n'est modifiée ni retirée.
const path = require('path');
const mongoose = require('mongoose');
const express = require('express');
const { _sniff: sniff } = require('./chat-media.js');

const OID = mongoose.Types.ObjectId;
const isOid = (v) => /^[a-f\d]{24}$/i.test(String(v));
const BUCKET = 'jexchatmedia';
let sb = null;
function supa() {
  if (sb) return sb;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  sb = require('@supabase/supabase-js').createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return sb;
}
const MAX_AVATAR = 1.5 * 1024 * 1024;

const Profile = mongoose.models.Profile || mongoose.model('Profile', new mongoose.Schema({
  userId: { type: OID, required: true, unique: true },
  name: { type: String, default: '', maxlength: 40 },
  bio: { type: String, default: '', maxlength: 150 },
  loc: { type: String, default: '', maxlength: 40 },
  site: { type: String, default: '', maxlength: 200 },
  cover: { type: String, default: 'g1', maxlength: 8 },
  priv: { type: Boolean, default: false },
  email: { type: String, default: '', maxlength: 120 },
  phone: { type: String, default: '', maxlength: 24 },
  twofa: { type: Boolean, default: false },
  alert: { type: Boolean, default: true },
  msg: { type: String, enum: ['all', 'fol', 'none'], default: 'all' },
  lang: { type: String, default: 'fr', maxlength: 5 },
  push: { type: Boolean, default: true },
  snd: { type: Boolean, default: true },
  notifPrefs: { type: mongoose.Schema.Types.Mixed, default: {} },
  avatar: { data: Buffer, mime: String, path: String },
  saved: [{ type: OID }],
}));

const Follow = mongoose.models.Follow || mongoose.model('Follow', new mongoose.Schema({
  from: { type: OID, required: true },
  to: { type: OID, required: true },
  createdAt: { type: Date, default: Date.now },
}).index({ from: 1, to: 1 }, { unique: true }).index({ to: 1 }));

const txt = (v, n) => (typeof v === 'string' ? v.replace(/[<>]/g, '').trim().slice(0, n) : '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9 ().-]{8,18}$/;

function mount(app, sec, io, db) {
  const pub = (p) => ({
    name: p.name || '', bio: p.bio || '', loc: p.loc || '', site: p.site || '', cover: p.cover || 'g1', priv: !!p.priv,
  });
  const card = (u) => ({ id: u._id, username: u.username, avatarUrl: u.avatarUrl || '', isOnline: !!u.isOnline });

  app.get('/jex-live.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('application/javascript');
    res.sendFile(path.join(__dirname, 'jex-live.js'));
  });

  // ── Profil public d'un autre utilisateur ──
  app.get('/api/profile/u/:username', sec.requireAuth, async (req, res) => {
    try {
      const r = sec.validateUsername(req.params.username);
      if (!r.valid) return res.status(400).json({ error: 'Pseudo invalide.' });
      const u = await db.User.findOne({ username: r.value }).lean();
      if (!u || u.isBanned) return res.status(404).json({ error: 'Utilisateur introuvable.' });
      const [p, posts, followers, following, isF] = await Promise.all([
        Profile.findOne({ userId: u._id }).select('-avatar').lean(),
        db.Post.find({ authorId: u._id, deleted: false }).select('likesCount').lean(),
        Follow.countDocuments({ to: u._id }), Follow.countDocuments({ from: u._id }),
        Follow.exists({ from: req.user._id, to: u._id }),
      ]);
      return res.json({ id: u._id, username: u.username, avatarUrl: u.avatarUrl || '', ...pub(p || {}), name: (p && p.name) || u.username, isMe: String(u._id) === String(req.user._id), following: !!isF, stats: { posts: posts.length, likes: posts.reduce((x, y) => x + (y.likesCount || 0), 0), followers, following } });
    } catch (e) { return res.status(500).json({ error: 'Erreur.' }); }
  });

  // ── Mon profil ──
  async function myProfile(req) {
    const uid = req.user._id;
    const [p, posts, followers, following] = await Promise.all([
      Profile.findOne({ userId: uid }).select('-avatar.data').lean(),
      db.Post.find({ authorId: uid, deleted: false }).select('likesCount').lean(),
      Follow.countDocuments({ to: uid }),
      Follow.countDocuments({ from: uid }),
    ]);
    const pr = p || {};
    return {
      id: uid, username: req.user.username, avatarUrl: req.user.avatarUrl || '', createdAt: req.user.createdAt,
      ...pub(pr), email: pr.email || '', phone: pr.phone || '', twofa: !!pr.twofa, alert: pr.alert !== false,
      msg: pr.msg || 'all', lang: pr.lang || 'fr', push: pr.push !== false, snd: pr.snd !== false,
      notifPrefs: pr.notifPrefs || {}, showOnline: req.user.settings?.privacy?.showOnlineStatus !== false,
      stats: { posts: posts.length, likes: posts.reduce((a, x) => a + (x.likesCount || 0), 0), followers, following },
    };
  }
  app.get('/api/me/profile', sec.requireAuth, async (req, res) => {
    try { return res.json(await myProfile(req)); } catch (e) { return res.status(500).json({ error: 'Erreur.' }); }
  });

  app.put('/api/me/profile', sec.requireAuth, async (req, res) => {
    try {
      const b = req.body || {}, set = {};
      if (b.name !== undefined) { const v = txt(b.name, 40); if (v.length < 2) return res.status(400).json({ error: 'Le nom doit contenir au moins 2 caractères.' }); set.name = v; }
      if (b.bio !== undefined) set.bio = txt(b.bio, 150);
      if (b.loc !== undefined) set.loc = txt(b.loc, 40);
      if (b.site !== undefined) {
        const s = String(b.site || '').trim();
        if (s) { const r = sec.validateUrl(s); if (!r.valid) return res.status(400).json({ error: 'Le site doit commencer par https://' }); set.site = r.value; } else set.site = '';
      }
      if (b.cover !== undefined) { if (!/^(g[1-9]|p[0-9])$/.test(b.cover)) return res.status(400).json({ error: 'Fond invalide.' }); set.cover = b.cover; }
      if (b.priv !== undefined) set.priv = !!b.priv;
      if (b.email !== undefined) {
        const e = String(b.email || '').trim().toLowerCase().slice(0, 120);
        if (e && !EMAIL.test(e)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
        if (e && await Profile.exists({ email: e, userId: { $ne: req.user._id } })) return res.status(409).json({ error: 'Cette adresse est déjà utilisée.' });
        set.email = e;
      }
      if (b.phone !== undefined) {
        const t = String(b.phone || '').trim();
        if (t && !PHONE.test(t)) return res.status(400).json({ error: 'Numéro invalide.' });
        set.phone = t;
      }
      for (const k of ['twofa', 'alert', 'push', 'snd']) if (b[k] !== undefined) set[k] = !!b[k];
      if (b.msg !== undefined) { if (!['all', 'fol', 'none'].includes(b.msg)) return res.status(400).json({ error: 'Valeur invalide.' }); set.msg = b.msg; }
      if (b.lang !== undefined) set.lang = txt(b.lang, 5) || 'fr';
      if (b.notifPrefs && typeof b.notifPrefs === 'object') {
        const np = {}; for (const [k, v] of Object.entries(b.notifPrefs).slice(0, 20)) if (/^[a-z_]{2,20}$/.test(k)) np[k] = v ? 1 : 0;
        set.notifPrefs = np;
      }
      // Les e-mails sont confidentiels : changer l'e-mail exige le mot de passe actuel.
      if (b.email !== undefined) {
        const bcrypt = require('bcryptjs');
        const u = await db.findUserByUsername(req.user.username);
        if (!(await bcrypt.compare(String(b.password || ''), u.passwordHash))) return res.status(401).json({ error: 'Mot de passe incorrect.' });
      }
      await Profile.updateOne({ userId: req.user._id }, { $set: set }, { upsert: true });
      return res.json(await myProfile(req));
    } catch (e) { console.error('[Proto] profile', e.message); return res.status(500).json({ error: 'Erreur.' }); }
  });

  // ── Photo de profil : fichier binaire (JPEG/PNG/WebP), vérifié par signature, stocké en base ──
  const raw = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: MAX_AVATAR });
  const upLimiter = sec.createRateLimiter(10, 60 * 1000, (r) => (r.user?._id || r.ip) + ':avatar');
  app.post('/api/me/avatar', sec.requireAuth, upLimiter, raw, async (req, res) => {
    try {
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Image manquante.' });
      const kind = sniff(buf);
      if (!kind) return res.status(415).json({ error: 'Format non autorisé (JPEG, PNG ou WebP).' });
      const path = `avatars/${req.user._id}.${kind.ext}`;
      let inSb = false;
      if (supa()) {
        const { error } = await supa().storage.from(BUCKET).upload(path, buf, { contentType: kind.mime, upsert: true, cacheControl: '60' });
        if (error) console.warn('[Avatar] Supabase:', error.message); else inSb = true;
      }
      await Profile.updateOne({ userId: req.user._id }, inSb ? { $set: { avatar: { mime: kind.mime, path } } } : { $set: { avatar: { data: buf, mime: kind.mime } } }, { upsert: true });
      const url = `/api/avatar/${req.user._id}?v=${Date.now()}`;
      await db.User.updateOne({ _id: req.user._id }, { $set: { avatarUrl: url } });
      return res.json({ avatarUrl: url });
    } catch (e) { return res.status(500).json({ error: 'Erreur.' }); }
  });
  app.delete('/api/me/avatar', sec.requireAuth, async (req, res) => {
    try {
      const p0 = await Profile.findOne({ userId: req.user._id }).select('avatar.path').lean();
      if (p0?.avatar?.path && supa()) await supa().storage.from(BUCKET).remove([p0.avatar.path]).catch(() => {});
      await Profile.updateOne({ userId: req.user._id }, { $unset: { avatar: 1 } });
      await db.User.updateOne({ _id: req.user._id }, { $set: { avatarUrl: '' } });
      return res.json({ avatarUrl: '' });
    } catch (e) { return res.status(500).json({ error: 'Erreur.' }); }
  });
  app.get('/api/avatar/:id', async (req, res) => {
    try {
      if (!isOid(req.params.id)) return res.status(404).end();
      const p = await Profile.findOne({ userId: req.params.id }).select('avatar').lean();
      if (!p || !p.avatar) return res.status(404).end();
      let data = null;
      if (p.avatar.path && supa()) {
        const { data: blob, error } = await supa().storage.from(BUCKET).download(p.avatar.path);
        if (error || !blob) return res.status(404).end();
        data = Buffer.from(await blob.arrayBuffer());
      } else if (p.avatar.data) data = p.avatar.data.buffer ? Buffer.from(p.avatar.data.buffer) : p.avatar.data;
      if (!data) return res.status(404).end();
      res.set({ 'Content-Type': p.avatar.mime || 'image/jpeg', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
      return res.end(data);
    } catch (e) { return res.status(500).end(); }
  });

  // ── Abonnements ──
  app.post('/api/follow/:id', sec.requireAuth, async (req, res) => {
    try {
      if (!isOid(req.params.id) || req.params.id === String(req.user._id)) return res.status(400).json({ error: 'ID invalide.' });
      const target = await db.findUserById(req.params.id);
      if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });
      const q = { from: req.user._id, to: target._id };
      let following;
      if (await Follow.exists(q)) { await Follow.deleteOne(q); following = false; }
      else {
        await Follow.create(q); following = true;
        if (target.settings?.notifications !== false) {
          await db.createNotification({ userId: target._id, type: 'follow', fromUserId: req.user._id, content: `${req.user.username} a commencé à vous suivre` });
          io.to(`user:${target._id}`).emit('notification', { type: 'follow', fromUserId: String(req.user._id) });
        }
      }
      return res.json({ following });
    } catch (e) { return res.status(500).json({ error: 'Erreur.' }); }
  });
  app.get('/api/follow/mine', sec.requireAuth, async (req, res) => {
    try {
      const [a, b] = await Promise.all([Follow.find({ from: req.user._id }).lean(), Follow.find({ to: req.user._id }).lean()]);
      const ids = [...new Set([...a.map((x) => String(x.to)), ...b.map((x) => String(x.from))])];
      const users = ids.length ? await db.findUsersByIds(ids) : [];
      const m = new Map(users.map((u) => [String(u._id), card(u)]));
      return res.json({
        following: a.map((x) => m.get(String(x.to))).filter(Boolean),
        followers: b.map((x) => m.get(String(x.from))).filter(Boolean),
      });
    } catch (e) { return res.status(500).json({ error: 'Erreur.' }); }
  });

  // ── Explorer : comptes suggérés + tendances ──
  app.get('/api/explore/accounts', sec.requireAuth, async (req, res) => {
    try {
      const me = await db.findUserById(req.user._id);
      const blocked = (me.blockedUsers || []).map(String);
      const users = await db.User.find({ _id: { $nin: [me._id, ...blocked] }, isBanned: false, isSuspended: false }).sort({ lastSeen: -1 }).limit(30).lean();
      const profs = await Profile.find({ userId: { $in: users.map((u) => u._id) } }).select('-avatar').lean();
      const pm = new Map(profs.map((p) => [String(p.userId), p]));
      const fol = new Set((await Follow.find({ from: me._id }).lean()).map((f) => String(f.to)));
      return res.json(users.map((u) => ({ ...card(u), bio: pm.get(String(u._id))?.bio || '', following: fol.has(String(u._id)) })));
    } catch (e) { return res.status(500).json({ error: 'Erreur.' }); }
  });
  app.get('/api/explore/trends', sec.requireAuth, async (req, res) => {
    try {
      const posts = await db.Post.find({ deleted: false }).sort({ createdAt: -1 }).limit(400).select('content description').lean();
      const c = new Map();
      for (const p of posts) for (const t of new Set(((p.content || '') + ' ' + (p.description || '')).toLowerCase().match(/#[\p{L}\p{N}_]{2,30}/gu) || [])) c.set(t, (c.get(t) || 0) + 1);
      return res.json([...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag, n]) => ({ tag, n })));
    } catch (e) { return res.status(500).json({ error: 'Erreur.' }); }
  });

  // ── Publications aimées / enregistrées (vue légère pour la grille de profil) ──
  const light = async (posts) => {
    const us = await db.findUsersByIds([...new Set(posts.map((p) => String(p.authorId)))]);
    const m = new Map(us.map((u) => [String(u._id), u.username]));
    return posts.filter((p) => !p.deleted).map((p) => ({
      id: p._id, author: m.get(String(p.authorId)) || '', content: p.content, mediaType: p.mediaType, mediaUrl: p.mediaUrl,
      likesCount: p.likesCount || 0, createdAt: p.createdAt,
    }));
  };
  app.get('/api/me/likes', sec.requireAuth, async (req, res) => {
    try {
      const likes = await db.PostLike.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(60).lean();
      const posts = await db.getPostsByIds(likes.map((l) => l.postId));
      const by = new Map(posts.map((p) => [String(p._id), p]));
      return res.json(await light(likes.map((l) => by.get(String(l.postId))).filter(Boolean)));
    } catch (e) { return res.status(500).json({ error: 'Erreur.' }); }
  });
  app.get('/api/me/saved', sec.requireAuth, async (req, res) => {
    try {
      const p = await Profile.findOne({ userId: req.user._id }).select('saved').lean();
      const ids = (p?.saved || []).slice(-60).reverse();
      const posts = ids.length ? await db.getPostsByIds(ids) : [];
      const by = new Map(posts.map((x) => [String(x._id), x]));
      return res.json(await light(ids.map((i) => by.get(String(i))).filter(Boolean)));
    } catch (e) { return res.status(500).json({ error: 'Erreur.' }); }
  });
  app.post('/api/saved/:id', sec.requireAuth, async (req, res) => {
    try {
      if (!isOid(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
      if (!(await db.getPostById(req.params.id))) return res.status(404).json({ error: 'Publication introuvable.' });
      const p = await Profile.findOne({ userId: req.user._id }).select('saved').lean();
      const has = (p?.saved || []).some((x) => String(x) === req.params.id);
      await Profile.updateOne({ userId: req.user._id }, has ? { $pull: { saved: req.params.id } } : { $addToSet: { saved: req.params.id } }, { upsert: true });
      return res.json({ saved: !has });
    } catch (e) { return res.status(500).json({ error: 'Erreur.' }); }
  });

  // ── Notifications : liste complète (lues + non lues), non lue/lue, suppression ──
  app.get('/api/notifs', sec.requireAuth, async (req, res) => {
    try {
      const list = await db.Notification.find({ userId: req.user._id, read: false }).sort({ createdAt: -1 }).limit(100).lean();
      const us = await db.findUsersByIds([...new Set(list.map((n) => n.fromUserId).filter(Boolean).map(String))]);
      const um = new Map(us.map((u) => [String(u._id), card(u)]));
      const posts = await db.getPostsByIds([...new Set(list.map((n) => n.postId).filter(Boolean).map(String))]);
      const pm = new Map(posts.map((p) => [String(p._id), p]));
      return res.json(list.map((n) => {
        const p = n.postId ? pm.get(String(n.postId)) : null;
        return { id: n._id, type: n.type, from: n.fromUserId ? um.get(String(n.fromUserId)) || null : null, conversationId: n.conversationId, postId: n.postId, content: n.content, read: n.read, createdAt: n.createdAt, thumb: p && p.mediaType === 'image' ? p.mediaUrl : '' };
      }));
    } catch (e) { return res.status(500).json({ error: 'Erreur.' }); }
  });
  app.post('/api/notifs/state', sec.requireAuth, async (req, res) => {
    try {
      const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(isOid).slice(0, 200);
      const q = { userId: req.user._id, ...(req.body?.all ? {} : { _id: { $in: ids } }) };
      if (req.body?.del) { await db.Notification.deleteMany(q); return res.json({ ok: true }); }
      await db.Notification.updateMany(q, { $set: { read: !!req.body?.read } });
      return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ error: 'Erreur.' }); }
  });
}

// Middlewares enregistrés AVANT les routes existantes (comptes privés, « qui peut m'écrire »).
function early(app, sec, db) {
  const viewer = async (req) => {
    const t = req.cookies?.jexchat_session || req.headers['x-session-token'];
    if (!t) return null;
    const s = await db.findSession(t);
    return s ? String(s.userId) : null;
  };

  app.use('/api/posts', async (req, res, next) => {
    if (req.method !== 'GET') return next();
    let vid = null; try { vid = await viewer(req); } catch {}
    const send = res.json.bind(res);
    res.json = (body) => {
      (async () => {
        const items = Array.isArray(body) ? body : (body && body.author && body.author.id ? [body] : null);
        if (!items || !items.length) return send(body);
        const aids = [...new Set(items.map((i) => i.author && String(i.author.id)).filter(Boolean))];
        const privs = (await Profile.find({ userId: { $in: aids }, priv: true }).select('userId').lean()).map((p) => String(p.userId)).filter((id) => id !== vid);
        if (!privs.length) return send(body);
        const fol = vid ? new Set((await Follow.find({ from: vid, to: { $in: privs } }).lean()).map((f) => String(f.to))) : new Set();
        const hidden = new Set(privs.filter((id) => !fol.has(id)));
        if (!hidden.size) return send(body);
        if (Array.isArray(body)) return send(body.filter((i) => !(i.author && hidden.has(String(i.author.id)))));
        return res.status(403).json({ error: 'Ce compte est privé.' });
      })().catch(() => send(body));
      return res;
    };
    next();
  });

  app.post('/api/conversations/:id/messages', async (req, res, next) => {
    try {
      const vid = await viewer(req);
      if (!vid || !isOid(req.params.id)) return next();
      const conv = await db.getConversationById(req.params.id);
      if (!conv || conv.type !== 'private' || !conv.members.map(String).includes(vid)) return next();
      const other = conv.members.map(String).find((m) => m !== vid);
      const pr = await Profile.findOne({ userId: other }).select('msg').lean();
      if (pr && pr.msg === 'none') return res.status(403).json({ error: 'Cette personne n’accepte pas de nouveaux messages.' });
      if (pr && pr.msg === 'fol' && !(await Follow.exists({ from: vid, to: other }))) return res.status(403).json({ error: 'Seuls ses abonnés peuvent lui écrire. Abonnez-vous d’abord.' });
    } catch {}
    next();
  });

  // Nettoyage des données du module quand un compte est supprimé.
  app.delete('/api/settings/account', async (req, res, next) => {
    let vid = null; try { vid = await viewer(req); } catch {}
    res.on('finish', () => {
      if (vid && res.statusCode < 300) { Profile.deleteOne({ userId: vid }).catch(() => {}); Follow.deleteMany({ $or: [{ from: vid }, { to: vid }] }).catch(() => {}); }
    });
    next();
  });
}

module.exports = { mount, early, Profile, Follow };
