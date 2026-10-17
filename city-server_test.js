'use strict';
// Tests de city-server.js sans base de données ni réseau : node city-server_test.js
// express / mongoose sont simulés uniquement s'ils ne sont pas installés.
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  try { return origLoad.call(this, req, ...rest); } catch (e) {
    if (req === 'mongoose') {
      if (!Module._fakeMongoose) { const S = function () {}; S.prototype.index = () => {}; S.Types = { ObjectId: 'oid' }; Module._fakeMongoose = { Schema: S, models: {}, model: () => ({}) }; }
      return Module._fakeMongoose;
    }
    throw e;
  }
};
const assert = require('assert');
const { createPresence, cleanMood, clampNum, mountApi, INVITE } = require('./city-server.js');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('ÉCHEC :', m); } else console.log('ok   :', m); };

// ─── simulations ───
function makeIO() {
  const log = [];
  return { log, to: (room) => ({ emit: (ev, p) => log.push({ room, ev, p }) }), on() {} };
}
let sid = 0;
function makeSocket(userId, user = {}) {
  const h = {};
  return { id: 's' + ++sid, userId, username: user.username || 'u' + userId, user, on: (e, f) => (h[e] = f), h };
}
const rlSec = () => { const m = new Map(); return { socketRateLimit: (id, a, max) => { const k = id + a; m.set(k, (m.get(k) || 0) + 1); return m.get(k) <= max; } }; };
const join = (s, data = {}) => new Promise((r) => s.h['city:join'](data, r));

(async () => {
  assert.strictEqual(cleanMood('  <b>Salut</b>\n\n tout   le monde  '), 'bSalut/b tout le monde');
  ok(cleanMood('x'.repeat(100)).length === 40, 'humeur bornée à 40 caractères');
  ok(cleanMood(42) === '', 'humeur non textuelle ignorée');
  ok(clampNum('abc', 0, 1) === null && clampNum(500, -64, 64) === 64, 'coordonnées bornées / invalides rejetées');

  // ─── présence ───
  const io = makeIO(), db = { User: { find: () => ({ select: () => ({ lean: async () => [] }) }) } };
  let t = 1000;
  const P = createPresence({ io, db, sec: rlSec(), now: () => t });
  const A = makeSocket('A', { blockedUsers: ['C'] }), B = makeSocket('B'), C = makeSocket('C'), D = makeSocket('D', { settings: { privacy: { showOnlineStatus: false } } });
  [A, B, C, D].forEach((s) => P.attach(s));
  const ra = await join(A, { x: 0, z: 0 });
  ok(ra.ok && ra.others.length === 0, 'A rejoint une ville vide');
  const rb = await join(B, { x: 5, z: 5 });
  ok(rb.others.length === 1 && rb.others[0].id === 'A', 'B voit A');
  ok(io.log.some((l) => l.room === 'user:A' && l.ev === 'city:appear' && l.p.id === 'B'), 'A est informé de l’arrivée de B');
  const rc = await join(C);
  ok(!rc.others.some((o) => o.id === 'A') && rc.others.some((o) => o.id === 'B'), 'C (bloqué par A) ne voit pas A mais voit B');
  ok(!io.log.some((l) => l.room === 'user:C' && l.ev === 'city:appear' && l.p.id === 'A'), 'aucune fuite de A vers C');
  const rd = await join(D);
  ok(rd.hidden && rd.others.length >= 2, 'D (statut masqué) voit les autres');
  ok(![...io.log].some((l) => l.ev === 'city:appear' && l.p.id === 'D'), 'D n’est annoncé à personne');

  io.log.length = 0;
  B.h['city:move']({ x: 9999, z: -9999, tx: 3, tz: 4 });
  const mv = io.log.filter((l) => l.ev === 'city:moved');
  ok(mv.some((l) => l.room === 'user:A') && !mv.some((l) => l.room === 'user:C' && l.p.id === 'A'), 'mouvement diffusé aux seuls visibles');
  ok(mv[0].p.x === 64 && mv[0].p.z === -240, 'position bornée côté serveur');
  io.log.length = 0;
  B.h['city:move']({ x: 'a', z: 1, tx: 1, tz: 1 });
  ok(io.log.length === 0, 'mouvement invalide ignoré');
  let sent = 0; for (let i = 0; i < 30; i++) { const b4 = io.log.length; B.h['city:move']({ x: 1, z: 1, tx: 2, tz: 2 }); sent += io.log.length - b4 > 0 ? 1 : 0; }
  ok(sent <= 12, `limitation de débit des mouvements (${sent} acceptés sur 30)`);

  io.log.length = 0;
  A.h['city:mood']({ mood: '<script>Café ?' });
  ok(io.log.some((l) => l.room === 'user:B' && l.ev === 'city:mood' && !/[<>]/.test(l.p.mood)), 'humeur assainie et diffusée');

  io.log.length = 0;
  B.h.disconnect();
  ok(io.log.some((l) => l.room === 'user:A' && l.ev === 'city:left' && l.p.id === 'B'), 'départ annoncé aux visibles');
  ok(!P.present.has('B'), 'B retiré de la présence');

  t += 100000; P.sweep();
  ok(P.present.size === 0, 'présences inactives balayées (aucune écriture en base)');

  // ─── invitations ───
  const routes = {};
  const app = { get: (p, ...h) => (routes['GET ' + p] = h), post: (p, ...h) => (routes['POST ' + p] = h), delete: (p, ...h) => (routes['DELETE ' + p] = h) };
  const users = {
    me: { _id: 'me', username: 'Moi', blockedUsers: [], settings: {} },
    ok1: { _id: 'ok1', username: 'Ami', blockedUsers: [], settings: {}, fcmTokens: ['tok'] },
    blk: { _id: 'blk', username: 'Bloque', blockedUsers: ['me'], settings: {} },
    mine: { _id: 'mine', username: 'JeBloque', blockedUsers: [], settings: {} },
    mut: { _id: 'mut', username: 'Sourdine', blockedUsers: [], settings: {} },
  };
  users.me.blockedUsers = ['mine'];
  const notifs = [], pushes = [], rate = new Map();
  const io2 = makeIO(); io2.on = () => {};
  const sec = {
    requireAuth: () => {}, isValidObjectId: (x) => typeof x === 'string' && x.length > 0,
    rateLimit: (k, max) => { rate.set(k, (rate.get(k) || 0) + 1); return rate.get(k) <= max; }, socketRateLimit: () => true,
  };
  const db2 = {
    findUserById: async (id) => users[id] || null,
    findOrCreatePrivateConversation: async () => ({ _id: 'conv1' }),
    createNotification: async (n) => notifs.push(n),
    User: db.User,
  };
  let clock = 5000;
  const api = mountApi({ app, io: io2, db: db2, sec, sendPushNotification: async (...a) => pushes.push(a), now: () => clock });
  // La sourdine passe par le modèle : on le simule via mongoose.models.
  const mongoose = require('mongoose');
  const mutes = new Set(['mut:me']);
  mongoose.models.CityMute = { exists: async (q) => (mutes.has(`${q.userId}:${q.mutedId}`) ? { _id: 1 } : null), find: () => ({ select: () => ({ lean: async () => [] }) }) };
  // forcer la lecture du modèle simulé
  require('./city-server.js');
  const call = async (body) => {
    const h = routes['POST /api/city/invite']; const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await h[h.length - 1]({ user: { _id: 'me', username: 'Moi' }, body }, res); return res;
  };
  ok((await call({ userId: 'me' })).code === 400, 'invitation à soi-même refusée');
  ok((await call({ userId: 'zzz' })).code === 404, 'utilisateur inconnu → 404');
  ok((await call({ userId: 'blk' })).code === 403, 'invitation refusée si l’autre m’a bloqué');
  ok((await call({ userId: 'mine' })).code === 403, 'invitation refusée si j’ai bloqué l’autre');
  ok(notifs.length === 0, 'aucune notification créée pour les cas refusés');
  const r1 = await call({ userId: 'ok1' });
  ok(r1.code === 200 && r1.body.conversationId === 'conv1', 'invitation valide');
  ok(notifs.length === 1 && notifs[0].userId === 'ok1' && notifs[0].type === 'system', 'notification privée créée pour la cible');
  ok(io2.log.every((l) => l.room === 'user:ok1'), 'seule la personne invitée est notifiée (rien à la ville)');
  ok(pushes.length === 1, 'push envoyé à la cible');
  ok((await call({ userId: 'ok1' })).code === 429, 'invitation répétée à la même personne limitée');
  clock += INVITE.perTargetMs + 1; rate.clear();
  ok((await call({ userId: 'ok1' })).code === 200, 'invitation de nouveau possible après le délai');
  const n0 = notifs.length; rate.clear();
  const r2 = await call({ userId: 'mut' });
  ok(r2.code === 200 && notifs.length === n0, 'mise en sourdine : succès apparent, aucune notification');
  let limited = false; for (let i = 0; i < 8; i++) { users['u' + i] = { _id: 'u' + i, username: 'x', blockedUsers: [], settings: {} }; if ((await call({ userId: 'u' + i })).code === 429) limited = true; }
  ok(limited, 'quota global d’invitations par utilisateur');

  console.log(fails ? `\n${fails} échec(s)` : '\nTous les tests passent');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
