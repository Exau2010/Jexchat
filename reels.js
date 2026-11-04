'use strict';
// Reels : page de vidéos courtes verticales (module additif, monté depuis server.js).
// - Vidéos YouTube Shorts collectées par catégorie via l'API YouTube Data (clé YOUTUBE_API_KEY, quota gratuit 10 000 unités/jour)
// - Vidéos des publications du site (mp4 / YouTube)
// - Classement personnalisé par utilisateur : temps de visionnage + likes, 80 % préférences / 20 % découverte. Aucun appel IA.
const mongoose = require('mongoose');
const db = require('./database.js');

const CATS = {
  chant: ['chanteur a cappella', 'cover chant voix', 'chorale gospel'],
  musique: ['instrument musique solo', 'beat production', 'guitare piano'],
  danse: ['danse afro', 'chorégraphie danse', 'danse traditionnelle'],
  code: ['apprendre javascript', 'astuces programmation', 'python débutant'],
  informatique: ['astuce ordinateur windows', 'astuce smartphone', 'cybersécurité conseils'],
  marketing: ['marketing digital conseils', 'publicité réseaux sociaux', 'stratégie marketing'],
  business: ['entrepreneuriat conseils', 'idée business', 'gagner de l argent en ligne'],
  beauté: ['soin de la peau', 'coiffure tresses', 'maquillage tutoriel'],
  mode: ['conseils style vestimentaire', 'couture mode africaine', 'tenue look'],
  conduite: ['conduite auto conseils', 'code de la route', 'mécanique voiture astuce'],
  religion: ['sagesse spirituelle', 'méditation prière', 'témoignage de foi'],
  lecture: ['conseils lecture livre', 'résumé de livre', 'citation roman'],
  humour: ['sketch humour', 'comédie drôle', 'stand up humoriste'],
  science: ['expérience science', 'astuce physique', 'fait scientifique'],
  culture: ['histoire en 1 minute', 'culture générale', 'fait historique'],
  éducation: ['astuce révision examen', 'mathématiques astuce', 'apprendre anglais'],
  sport: ['football skills', 'basket highlights', 'entraînement sport'],
  fitness: ['exercice musculation maison', 'routine fitness', 'santé bien-être conseils'],
  cuisine: ['recette rapide', 'cuisine africaine', 'astuce cuisine'],
  voyage: ['découverte pays voyage', 'tourisme afrique', 'paysage nature'],
  animaux: ['animaux mignons', 'chien chat drôle', 'faune sauvage'],
  bricolage: ['bricolage astuce maison', 'DIY créatif', 'réparation facile'],
  motivation: ['motivation étudiant', 'conseils réussite', 'discipline productivité'],
};
const CAT_KEYS = Object.keys(CATS);
const DAILY_UNITS = 9000, SEARCH_COST = 100, BOOT_MIN = 15; // BOOT_MIN : vidéos visées par catégorie au démarrage

const Video = mongoose.models.ReelVideo || mongoose.model('ReelVideo', new mongoose.Schema({
  ytId: { type: String, unique: true }, title: String, channel: String, cat: { type: String, index: true }, at: { type: Date, default: Date.now }, pub: Date, views: Number, bad: { type: Boolean, default: false },
}));
const Pref = mongoose.models.ReelPref || mongoose.model('ReelPref', new mongoose.Schema({
  userId: { type: String, unique: true }, cats: { type: mongoose.Schema.Types.Mixed, default: {} }, seen: { type: [String], default: [] },
}, { minimize: false }));
const Meta = mongoose.models.ReelMeta || mongoose.model('ReelMeta', new mongoose.Schema({ day: { type: String, unique: true }, units: { type: Number, default: 0 } }));

// Seules les vidéos publiées de 2023 à aujourd'hui sont gardées (les anciennes déjà en base sont écartées au démarrage).
const REEL_FROM = new Date('2023-01-01T00:00:00Z'), MIN_VIEWS = 5000; // vidéos récentes (2023 → aujourd'hui) et déjà appréciées
Video.updateMany({ $or: [{ pub: { $exists: false } }, { pub: { $lt: REEL_FROM } }], bad: false }, { $set: { bad: true } }).catch(() => {});
const dur = (iso) => { const m = /^PT(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || ''); return m ? (+m[1] || 0) * 60 + (+m[2] || 0) : 999; };
const YT = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/|v\/))([\w-]{11})/;

async function collect() { // une recherche par passage, en tournant sur les catégories
  const key = (process.env.YOUTUBE_API_KEY || '').trim(); if (!key) { if (!collect.warned) { collect.warned = 1; console.warn('[Reels] YOUTUBE_API_KEY absente : aucune vidéo YouTube ne sera collectée (seules les vidéos des publications sont affichées).'); } return; }
  const day = new Date().toISOString().slice(0, 10);
  const meta = await Meta.findOneAndUpdate({ day }, { $setOnInsert: { units: 0 } }, { upsert: true, new: true });
  if (meta.units + SEARCH_COST + 1 > DAILY_UNITS) return; // quota du jour consommé : le calcul des préférences continue, pas la collecte
  const counts = await Video.aggregate([{ $match: { bad: false } }, { $group: { _id: '$cat', n: { $sum: 1 } } }]);
  const n = Object.fromEntries(counts.map((c) => [c._id, c.n]));
  const cat = CAT_KEYS.slice().sort((a, b) => (n[a] || 0) - (n[b] || 0))[0]; // la catégorie la moins fournie
  const kws = CATS[cat], q = kws[Math.floor(Math.random() * kws.length)] + ' #shorts';
  const order = ['relevance', 'viewCount', 'viewCount'][Math.floor(Math.random() * 3)];
  const u = 'https://www.googleapis.com/youtube/v3/search?' + new URLSearchParams({ part: 'snippet', type: 'video', videoDuration: 'short', videoEmbeddable: 'true', safeSearch: 'strict', maxResults: '50', q, order, relevanceLanguage: 'fr', publishedAfter: REEL_FROM.toISOString(), publishedBefore: new Date().toISOString(), key });
  const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
  await Meta.updateOne({ day }, { $inc: { units: SEARCH_COST } });
  if (!r.ok) { console.error('[Reels] search', r.status); return; }
  const items = ((await r.json()).items || []).filter((i) => i.id && i.id.videoId);
  if (!items.length) return;
  const d = await fetch('https://www.googleapis.com/youtube/v3/videos?' + new URLSearchParams({ part: 'contentDetails,status,statistics', id: items.map((i) => i.id.videoId).join(','), key }), { signal: AbortSignal.timeout(10000) });
  await Meta.updateOne({ day }, { $inc: { units: 1 } });
  if (!d.ok) return;
  const ok = new Map(((await d.json()).items || []).filter((v) => dur(v.contentDetails && v.contentDetails.duration) <= 60 && v.status && v.status.embeddable && +(v.statistics && v.statistics.viewCount) >= MIN_VIEWS).map((v) => [v.id, +v.statistics.viewCount]));
  const ops = items.filter((i) => ok.has(i.id.videoId) && new Date(i.snippet.publishedAt) >= REEL_FROM).map((i) => ({ updateOne: { filter: { ytId: i.id.videoId }, update: { $setOnInsert: { ytId: i.id.videoId, views: ok.get(i.id.videoId), pub: new Date(i.snippet.publishedAt), title: String(i.snippet.title || '').slice(0, 120), channel: String(i.snippet.channelTitle || '').slice(0, 60), cat, at: new Date() } }, upsert: true } }));
  if (ops.length) await Video.bulkWrite(ops, { ordered: false }).catch(() => {});
}

const pick = (arr, k) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, k); };

function mount(app, sec) {
  const lim = sec.createRateLimiter(120, 60 * 1000, (r) => (r.user?._id || r.ip) + ':reels');
  const run = () => collect().catch((e) => console.error('[Reels]', e.message));
  setTimeout(async () => { // remplissage initial : on tourne sur toutes les catégories peu fournies, 3 s entre chaque recherche
    for (let i = 0; i < CAT_KEYS.length * 2; i++) {
      const c = await Video.aggregate([{ $match: { bad: false } }, { $group: { _id: '$cat', n: { $sum: 1 } } }]).catch(() => []);
      const n = Object.fromEntries(c.map((x) => [x._id, x.n]));
      if (CAT_KEYS.every((k) => (n[k] || 0) >= BOOT_MIN)) break;
      await run(); await new Promise((ok) => setTimeout(ok, 3000));
    }
  }, 5000);
  setInterval(run, 10 * 60 * 1000); // ensuite ≈ 89 recherches/jour au plus, plafonné par le quota

  app.get('/api/reels', sec.requireAuth, lim, async (req, res) => {
    try {
      const uid = String(req.user._id), n = Math.min(parseInt(req.query.n) || 8, 12);
      const pref = (await Pref.findOne({ userId: uid }).lean()) || { cats: {}, seen: [] };
      const seen = new Set(pref.seen || []);
      // catégories pondérées : score appris + base 1 (découverte), plancher à 0,2
      const w = CAT_KEYS.map((c) => [c, Math.max(0.2, 1 + (pref.cats[c] || 0))]);
      const total = w.reduce((s, x) => s + x[1], 0);
      const draw = () => { if (Math.random() < 0.2) return CAT_KEYS[Math.floor(Math.random() * CAT_KEYS.length)]; let r = Math.random() * total; for (const [c, v] of w) { if ((r -= v) <= 0) return c; } return CAT_KEYS[0]; };
      const want = {}; for (let i = 0; i < n; i++) { const c = draw(); want[c] = (want[c] || 0) + 1; }
      const out = [];
      for (const [c, k] of Object.entries(want)) {
        const list = await Video.aggregate([{ $match: { cat: c, bad: false, ytId: { $nin: [...seen].slice(-300) } } }, { $sample: { size: k } }]);
        list.forEach((v) => out.push({ k: 'yt', id: v.ytId, ytId: v.ytId, title: v.title, channel: v.channel, cat: c }));
      }
      if (out.length < n) {
        const have = new Set(out.map((x) => x.id));
        const extra = await Video.aggregate([{ $match: { bad: false, ytId: { $nin: [...seen].slice(-300).concat([...have]) } } }, { $sample: { size: n - out.length } }]);
        extra.forEach((v) => out.push({ k: 'yt', id: v.ytId, ytId: v.ytId, title: v.title, channel: v.channel, cat: v.cat }));
      }
      // vidéos des publications du site : 1 sur 4 environ
      const posts = await db.getPosts(0, 60);
      const vids = posts.filter((p) => p.mediaType === 'video' && p.mediaUrl && !seen.has('p' + p._id) && (YT.test(p.mediaUrl) || /\.(mp4|webm|ogg)(\?|$)/i.test(p.mediaUrl))).slice(0, 30);
      let pool = vids;
      if (!out.length && !pool.length) pool = posts.filter((p) => p.mediaType === 'video' && p.mediaUrl && (YT.test(p.mediaUrl) || /\.(mp4|webm|ogg)(\?|$)/i.test(p.mediaUrl))).slice(0, 30); // tout déjà vu : on repasse les anciennes
      if (!out.length) { const any = await Video.aggregate([{ $match: { bad: false } }, { $sample: { size: n } }]).catch(() => []); any.forEach((v) => out.push({ k: 'yt', id: v.ytId, ytId: v.ytId, title: v.title, channel: v.channel, cat: v.cat })); } // base épuisée pour cet utilisateur : on recycle
      const chosen = pick(pool, out.length ? Math.max(1, Math.round(n / 4)) : n); // sans vidéo YouTube, les vidéos des publications remplissent le fil
      const authors = chosen.length ? await db.findUsersByIds([...new Set(chosen.map((p) => p.authorId.toString()))]) : [];
      const am = new Map(authors.map((a) => [a._id.toString(), a.username]));
      chosen.forEach((p) => { const y = YT.exec(p.mediaUrl); out.push(y ? { k: 'yt', id: 'p' + p._id, ytId: y[1], title: p.content || '', channel: am.get(p.authorId.toString()) || '', cat: 'communauté', post: String(p._id) } : { k: 'mp4', id: 'p' + p._id, url: p.mediaUrl, title: p.content || '', channel: am.get(p.authorId.toString()) || '', cat: 'communauté', post: String(p._id) }); });
      res.json(pick(out, out.length));
    } catch (e) { console.error('[Reels] feed', e.message); res.status(500).json({ error: 'Erreur.' }); }
  });

  app.post('/api/reels/event', sec.requireAuth, lim, async (req, res) => {
    try {
      const b = req.body || {}, id = String(b.id || '').slice(0, 40), cat = String(b.cat || '');
      if (!/^[\w-]{1,40}$/.test(id)) return res.status(400).json({ error: 'Invalide.' });
      const watch = Math.max(0, Math.min(Number(b.watchMs) || 0, 600000)), len = Math.max(3000, Math.min(Number(b.durMs) || 30000, 600000));
      const ratio = watch / len;
      let d = ratio >= 0.8 ? 1 : ratio >= 0.4 ? 0.4 : ratio < 0.12 ? -0.5 : 0; // regardé en entier / à moitié / passé tout de suite
      if (b.liked === true) d += 2;
      if (b.liked === false) d -= 1;
      const upd = { $addToSet: { seen: id } };
      if (CAT_KEYS.includes(cat) && d) upd.$inc = { ['cats.' + cat]: d };
      const p = await Pref.findOneAndUpdate({ userId: String(req.user._id) }, upd, { upsert: true, new: true });
      if (p.seen.length > 400) await Pref.updateOne({ _id: p._id }, { $push: { seen: { $each: [], $slice: -300 } } });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'Erreur.' }); }
  });
}
module.exports = { mount };
