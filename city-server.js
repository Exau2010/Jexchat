'use strict';
// city-server.js — Module serveur JexCity (additif, n'altère aucune route JexChat).
//
// Branchement dans server.js (2 lignes) :
//   const jexcity = require('./city-server.js');
//   jexcity.mountStatic(app);                       // avant app.use(sec.apiLimiter)
//   jexcity.mountApi({ app, io, db, sec, sendPushNotification });   // après les routes existantes
//
// Principes :
//  • Même origine que JexChat (/city) : le cookie de session HttpOnly existant est utilisé tel quel,
//    aucun jeton dans une URL.
//  • Aucun compte, message ou publication dupliqué : JexCity lit les routes JexChat existantes.
//  • Présence en mémoire uniquement (jamais écrite en base). Positions diffusées uniquement aux
//    utilisateurs présents dans la ville, jamais à travers un blocage, jamais pour les comptes
//    qui masquent leur statut en ligne.
//  • Seule donnée persistante ajoutée : la sourdine (CityMute), référençant des utilisateurs existants.

const path = require('path');
const mongoose = require('mongoose');

const CITY_DIR = __dirname;
const ZONE = 'main';
const BOUNDS = { x0: -64, x1: 64, z0: -240, z1: 152 }; // identique à TOWN dans city-geo.js
const MAX_PRESENCE = 60;                // avatars simultanés dans la zone
const STALE_MS = 90 * 1000;             // sans signe de vie → retiré
const INVITE = { perTargetMs: 30 * 60 * 1000, perUserMax: 5, perUserWindowMs: 10 * 60 * 1000 };

// ─── Utilitaires purs (testés) ────────────────────────────────────────────────
function cleanMood(v) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}
function clampNum(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}
function safeColor(c) { return typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : ''; }

// ─── Modèle de sourdine ───────────────────────────────────────────────────────
let _CityMute = null;
function getMuteModel() {
  if (_CityMute) return _CityMute;
  const schema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    mutedId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now },
  });
  schema.index({ userId: 1, mutedId: 1 }, { unique: true });
  _CityMute = mongoose.models.CityMute || mongoose.model('CityMute', schema);
  return _CityMute;
}

// ─── Fichiers statiques ───────────────────────────────────────────────────────
// Tous les fichiers JexCity sont à la racine du projet. Liste blanche explicite : on ne sert JAMAIS
// la racine entière (server.js, database.js, .env… resteraient exposés).
const CITY_FILES = ['city.css', 'city-main.js', 'city-api.js', 'city-social.js', 'city-posts.js', 'city-ui.js',
  'city-geo.js', 'city-world.js', 'city-controls.js', 'city-avatar.js'];

function mountStatic(app) {
  const noCache = (res) => res.setHeader('Cache-Control', 'no-cache');
  const page = (req, res) => { noCache(res); res.sendFile(path.join(CITY_DIR, 'city.html')); };
  app.get('/city', page);
  app.get('/city/', page);
  for (const f of CITY_FILES) {
    app.get('/' + f, (req, res) => { noCache(res); res.sendFile(path.join(CITY_DIR, f)); });
  }
}

// ─── Présence (en mémoire) ────────────────────────────────────────────────────
function createPresence({ io, db, sec, now = () => Date.now() }) {
  const present = new Map(); // userId -> entrée

  const canSee = (viewer, target) =>
    viewer.userId !== target.userId && !target.hidden &&
    !viewer.hide.has(target.userId) && !target.hide.has(viewer.userId);

  const view = (e) => ({
    id: e.userId, username: e.username, identity: e.identity, avatarUrl: e.avatarUrl,
    x: e.x, z: e.z, tx: e.tx, tz: e.tz, mood: e.mood,
  });
  const toUser = (id, ev, payload) => io.to(`user:${id}`).emit(ev, payload);

  function peersOf(entry) { return [...present.values()].filter((o) => canSee(o, entry)); }

  async function loadHide(userDoc, userId) {
    const hide = new Set((userDoc?.blockedUsers || []).map(String));
    try {
      const rows = await db.User.find({ blockedUsers: userId }).select('_id').lean();
      for (const r of rows || []) hide.add(String(r._id));
    } catch (_) { /* échec non fatal : on garde au moins mes propres blocages */ }
    return hide;
  }

  function remove(userId) {
    const e = present.get(userId);
    if (!e) return;
    present.delete(userId);
    if (!e.hidden) for (const o of present.values()) if (!o.hide.has(userId) && !e.hide.has(o.userId)) toUser(o.userId, 'city:left', { id: userId });
  }

  function attach(socket) {
    const userId = socket.userId;
    const rl = (action, max, ms) => sec.socketRateLimit(socket.id, `city:${action}`, max, ms);

    socket.on('city:join', async (data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (!rl('join', 6, 15000)) return reply({ error: 'Trop de tentatives.' });
        let e = present.get(userId);
        if (!e && present.size >= MAX_PRESENCE) return reply({ error: 'La ville est pleine pour le moment.' });
        const u = socket.user || {};
        const hide = await loadHide(u, userId);
        const x = clampNum(data?.x, BOUNDS.x0, BOUNDS.x1) ?? 0, z = clampNum(data?.z, BOUNDS.z0, BOUNDS.z1) ?? 0;
        if (!e) {
          e = { userId, sockets: new Set(), x, z, tx: x, tz: z, mood: '' };
          present.set(userId, e);
        }
        Object.assign(e, {
          username: socket.username || u.username || 'Anonyme',
          identity: { colorA: safeColor(u.identity?.colorA), colorB: safeColor(u.identity?.colorB) },
          avatarUrl: typeof u.avatarUrl === 'string' && u.avatarUrl.startsWith('https://') ? u.avatarUrl : '',
          hidden: u.settings?.privacy?.showOnlineStatus === false, // « ghost » : on voit mais on n'est pas vu
          hide, seen: now(),
        });
        if (data?.mood !== undefined) e.mood = cleanMood(data.mood);
        e.sockets.add(socket.id);
        socket.cityJoined = true;
        const others = [...present.values()].filter((o) => canSee(e, o)).map(view);
        for (const o of peersOf(e)) toUser(o.userId, 'city:appear', view(e));
        reply({ ok: true, self: view(e), others, hidden: e.hidden });
      } catch (err) {
        console.warn('[JexCity] join:', err.message);
        reply({ error: 'Erreur.' });
      }
    });

    socket.on('city:move', (data) => {
      const e = present.get(userId);
      if (!e || !socket.cityJoined || !rl('move', 12, 5000)) return;
      const x = clampNum(data?.x, BOUNDS.x0, BOUNDS.x1), z = clampNum(data?.z, BOUNDS.z0, BOUNDS.z1);
      const tx = clampNum(data?.tx, BOUNDS.x0, BOUNDS.x1), tz = clampNum(data?.tz, BOUNDS.z0, BOUNDS.z1);
      if (x === null || z === null || tx === null || tz === null) return;
      Object.assign(e, { x, z, tx, tz, seen: now() });
      for (const o of peersOf(e)) toUser(o.userId, 'city:moved', { id: userId, x, z, tx, tz });
    });

    socket.on('city:mood', (data) => {
      const e = present.get(userId);
      if (!e || !socket.cityJoined || !rl('mood', 6, 60000)) return;
      e.mood = cleanMood(data?.mood); e.seen = now();
      for (const o of peersOf(e)) toUser(o.userId, 'city:mood', { id: userId, mood: e.mood });
    });

    socket.on('city:ping', () => { const e = present.get(userId); if (e && rl('ping', 6, 60000)) e.seen = now(); });

    const leave = () => {
      const e = present.get(userId);
      if (!e) return;
      e.sockets.delete(socket.id);
      socket.cityJoined = false;
      if (e.sockets.size === 0) remove(userId);
    };
    socket.on('city:leave', leave);
    socket.on('disconnect', leave);
  }

  function sweep() {
    const t = now();
    for (const [id, e] of present) if (t - e.seen > STALE_MS) remove(id);
  }

  return { attach, sweep, present, remove, canSee };
}

// ─── API HTTP ─────────────────────────────────────────────────────────────────
function mountApi({ app, io, db, sec, sendPushNotification, now = () => Date.now() }) {
  const inviteLast = new Map(); // "de:vers" -> horodatage
  const MuteModel = () => getMuteModel();

  const presence = createPresence({ io, db, sec, now });
  io.on('connection', (socket) => { if (socket.userId) presence.attach(socket); });
  const timers = [
    setInterval(presence.sweep, 30 * 1000),
    setInterval(() => { const t = now(); for (const [k, v] of inviteLast) if (t - v > INVITE.perTargetMs) inviteLast.delete(k); }, 10 * 60 * 1000),
  ];
  timers.forEach((t) => t.unref && t.unref());

  const isMuted = async (ownerId, otherId) => {
    try { return !!(await MuteModel().exists({ userId: ownerId, mutedId: otherId })); } catch (_) { return false; }
  };

  app.get('/api/city/config', sec.requireAuth, async (req, res) => {
    try {
      const rows = await MuteModel().find({ userId: req.user._id }).select('mutedId').lean();
      return res.json({ zone: ZONE, bounds: BOUNDS, maxAvatars: MAX_PRESENCE, muted: rows.map((r) => String(r.mutedId)) });
    } catch (_) {
      return res.json({ zone: ZONE, bounds: BOUNDS, maxAvatars: MAX_PRESENCE, muted: [] });
    }
  });

  app.post('/api/city/mute/:id', sec.requireAuth, async (req, res) => {
    try {
      const id = req.params.id;
      if (!sec.isValidObjectId(id) || id === req.user._id.toString()) return res.status(400).json({ error: 'ID invalide.' });
      if (!(await db.findUserById(id))) return res.status(404).json({ error: 'Utilisateur introuvable.' });
      await MuteModel().updateOne({ userId: req.user._id, mutedId: id }, { $setOnInsert: { createdAt: new Date() } }, { upsert: true });
      return res.json({ ok: true });
    } catch (_) { return res.status(500).json({ error: 'Erreur.' }); }
  });

  app.delete('/api/city/mute/:id', sec.requireAuth, async (req, res) => {
    try {
      if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
      await MuteModel().deleteOne({ userId: req.user._id, mutedId: req.params.id });
      return res.json({ ok: true });
    } catch (_) { return res.status(500).json({ error: 'Erreur.' }); }
  });

  // Invitation à une conversation TEXTUELLE (aucun appel vocal). Jamais annoncée à la ville :
  // seule une notification privée est envoyée à la personne invitée.
  app.post('/api/city/invite', sec.requireAuth, async (req, res) => {
    try {
      const meId = req.user._id.toString();
      const tid = req.body?.userId;
      if (!sec.isValidObjectId(tid) || tid === meId) return res.status(400).json({ error: 'ID invalide.' });
      if (!sec.rateLimit(`${meId}:cityinvite`, INVITE.perUserMax, INVITE.perUserWindowMs)) {
        return res.status(429).json({ error: "Trop d'invitations. Réessayez dans quelques minutes." });
      }
      const [target, me] = await Promise.all([db.findUserById(tid), db.findUserById(meId)]);
      if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });
      if (me.blockedUsers?.map(String).includes(tid)) return res.status(403).json({ error: 'Vous avez bloqué cet utilisateur.' });
      if (target.blockedUsers?.map(String).includes(meId)) return res.status(403).json({ error: 'Action non autorisée.' });

      const key = `${meId}:${tid}`, last = inviteLast.get(key);
      if (last && now() - last < INVITE.perTargetMs) {
        return res.status(429).json({ error: 'Vous avez déjà invité cette personne récemment.' });
      }
      inviteLast.set(key, now());

      const conv = await db.findOrCreatePrivateConversation(meId, tid);
      // Si la personne m'a mis en sourdine : succès apparent, aucune notification (on ne révèle pas la sourdine).
      const silent = (await isMuted(tid, meId)) || target.settings?.notifications === false;
      if (!silent) {
        const content = `${req.user.username} vous invite à discuter (JexCity)`;
        await db.createNotification({ userId: tid, type: 'system', fromUserId: meId, conversationId: conv._id, content });
        io.to(`user:${tid}`).emit('notification', { type: 'system', fromUserId: meId, conversationId: String(conv._id), content });
        if (typeof sendPushNotification === 'function' && target.fcmTokens?.length) {
          sendPushNotification(tid, target.fcmTokens, 'JexCity', content, { conversationId: String(conv._id) }).catch(() => {});
        }
      }
      return res.json({ ok: true, conversationId: String(conv._id) });
    } catch (err) {
      console.warn('[JexCity] invite:', err.message);
      return res.status(500).json({ error: 'Erreur.' });
    }
  });

  return { presence, inviteLast };
}

module.exports = { CITY_FILES, mountStatic, mountApi, createPresence, cleanMood, clampNum, INVITE, BOUNDS, MAX_PRESENCE };
