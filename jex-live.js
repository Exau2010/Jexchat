/* JexChat — connecte l'interface (design inchangé) au backend : API REST + Socket.IO. Aucune donnée fictive. */
(() => {
'use strict';
const q$ = (s) => document.querySelector(s);
const UID = {}, AVM = {}, FOLU = {};            // pseudo -> id / avatar
let MEID = null, SOCK = null, STG = [], LIKES = [], SAVED = [], booted = false, typT = 0, notifT = 0;
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const col = (n) => { let h = 0; for (const c of String(n)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % 6; };
const ago = (t) => { const s = (Date.now() - +new Date(t)) / 1000; if (s < 60) return 'à l’instant'; if (s < 3600) return 'il y a ' + Math.floor(s / 60) + ' min'; if (s < 86400) return 'il y a ' + Math.floor(s / 3600) + ' h'; if (s < 172800) return 'hier'; return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }); };
const seenTxt = (t) => { if (!t) return ''; const s = (Date.now() - t) / 1000; if (s < 60) return 'vu à l’instant'; if (s < 3600) return 'vu il y a ' + Math.floor(s / 60) + ' min'; if (s < 86400 && new Date(t).toDateString() === new Date().toDateString()) return 'vu il y a ' + Math.floor(s / 3600) + ' h'; if (new Date(t).toDateString() === new Date(Date.now() - 864e5).toDateString()) return 'vu hier'; return 'vu le ' + new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }); };
const copy = (t, m) => { try { navigator.clipboard.writeText(t).then(() => T(m)); } catch { T(t); } };

async function api(m, u, b) {
  const o = { method: m, credentials: 'same-origin', headers: {} };
  if (b !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(b); }
  let r; try { r = await fetch(u, o); } catch { throw new Error('Connexion au serveur impossible.'); }
  let d = null; try { d = await r.json(); } catch {}
  if (!r.ok) {
    if (r.status === 401 && booted && !/\/auth\//.test(u)) { kick(); }
    throw new Error((d && d.error) || 'Erreur ' + r.status);
  }
  return d;
}
const reg = (u) => { if (!u || !u.username) return u; UID[u.username] = u.id; AVM[u.username] = u.avatarUrl || ''; if (u.username !== ME && !U.includes(u.username)) U.push(u.username); return u; };

/* ---------- Avatars réels ---------- */
av = function (n, k = 0) {
  const a = AVM[n], s = String(n).slice(0, 2).toUpperCase().replace(/[<>&"']/g, '');
  return `<div class="av" style="--c:linear-gradient(135deg,${C[((k % 6) + 6) % 6]})">${a ? `<img src="${esc(a)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block">` : s}</div>`;
};
const paintMe = () => { AVM[ME] = PD.av || ''; const c = q$('.comp .sm'); if (c) c.innerHTML = av(ME, 0); };

/* ---------- Session / authentification ---------- */
function resetState() {
  D.length = 0; NT.length = 0; POSTS.length = 0; XP.length = 0; XT.length = 0; U.length = 0; LIKES = []; SAVED = []; STG = []; ONL.clear(); FOL.clear();
  cur = null; $('#feed').innerHTML = ''; $('#stories').innerHTML = ''; go.i = 0;
}
function kick() { if (!booted) return; booted = false; if (SOCK) SOCK.disconnect(); resetState(); setSess(null); showAuth(); }
async function loadProfile() {
  const p = await api('GET', '/api/me/profile');
  MEID = p.id; ME = p.username;
  Object.assign(PD, { name: p.name || p.username, handle: p.username, bio: p.bio, loc: p.loc, site: p.site, cover: p.cover, priv: p.priv ? 1 : 0, push: p.push ? 1 : 0, snd: p.snd ? 1 : 0, av: p.avatarUrl || null, lk: 0, np: p.stats.posts, nl: p.stats.likes });
  Object.assign(ACC, { twofa: p.twofa ? 1 : 0, alert: p.alert ? 1 : 0, online: p.showOnline ? 1 : 0, msg: p.msg, lang: p.lang, phone: p.phone });
  Object.assign(NPREF, p.notifPrefs || {});
  ACCS[ME] = { name: PD.name, handle: ME, email: p.email, created: (p.createdAt || '').slice(0, 10) }; sset('jx-accounts', ACCS);
  paintMe();
  return p;
}
async function enter(rem, isNew) {
  await loadProfile(); setSess({ u: ME }, rem);
  $('#auth').classList.add('out'); setTimeout(() => { $('#auth').hidden = true; $('#auth').classList.remove('out'); }, 300);
  booted = true; await bootData(); connectSocket(); go('home'); renderProf(); renderAcct();
  T(isNew ? 'Bienvenue sur JexChat, ' + PD.name.split(' ')[0] + ' 🎉' : 'Connexion réussie');
}
aSubmit = async function () {
  const m = aMode;
  if (m === 'login' || m === 'pick') {
    const u = $('#au-u').value.trim().replace(/^@/, ''), p = $('#au-p').value, f = $('#e-form'); f.textContent = '';
    let ok = aErr('au-u', !u ? 'Entrez votre pseudo.' : ''); ok = aErr('au-p', !p ? 'Entrez votre mot de passe.' : '') && ok; if (!ok) return aFirstBad();
    aBusy(true);
    try { await api('POST', '/api/auth/login', { username: u, password: p }); await enter($('#au-r').checked, false); }
    catch (e) { aBusy(false); f.textContent = e.message; $('#au-p').value = ''; $('#au-p').focus(); }
    return;
  }
  const n = $('#au-n').value.trim(), u = $('#au-u').value.trim().replace(/^@/, ''), e = $('#au-e').value.trim().toLowerCase(), p = $('#au-p').value, c = $('#au-c').value;
  let ok = aErr('au-n', n.length < 2 ? 'Entrez un nom (2 caractères minimum).' : '');
  ok = aErr('au-u', !/^[A-Za-z0-9_][A-Za-z0-9_.-]{1,31}$/.test(u) ? '2 à 32 caractères : lettres, chiffres, _ . -' : '') && ok;
  ok = aErr('au-p', p.length < 6 ? '6 caractères minimum.' : '') && ok;
  ok = aErr('au-c', c !== p ? 'Les mots de passe ne correspondent pas.' : '') && ok;
  ok = aErr('au-e', e && !EMRX.test(e) ? 'Adresse e-mail invalide.' : '') && ok;
  const t = $('#au-t').checked; $('#e-au-t').textContent = t ? '' : 'Vous devez accepter les conditions.'; ok = t && ok;
  if (!ok) return aFirstBad() || $('#au-t').focus();
  aBusy(true); const f = $('#e-form');
  try {
    await api('POST', '/api/auth/register', { username: u, password: p });
    try { await api('PUT', '/api/me/profile', { name: n, ...(e ? { email: e, password: p } : {}) }); } catch (x) { setTimeout(() => T(x.message), 1500); }
    await enter(true, true);
  } catch (x) { aBusy(false); f.textContent = x.message; }
};
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-ac="logout2"],[data-pg="plog2"]'); if (!t) return;
  e.stopImmediatePropagation(); e.preventDefault(); CL();
  api('POST', '/api/auth/logout').catch(() => {}).finally(() => { go('home'); kick(); });
}, true);

/* ---------- Chargement des données ---------- */
async function bootData() {
  await Promise.allSettled([loadFollows(), loadConvs(), loadFeed(true), loadStories(), loadNotifs(), loadOnline(), loadMine(), loadExplore(), loadCfg()]);
  D.forEach((c) => applyBg(c, c.bgSrv));
  renderList(); renderNotif(); renderProf(); nBadge();
}
async function loadFollows() { const f = await api('GET', '/api/follow/mine'); FOL.clear(); f.following.forEach((u) => { reg(u); FOL.add(u.username); }); f.followers.forEach(reg); }
async function loadOnline() {
  const l = await api('GET', '/api/users/online'); ONL.clear();
  l.forEach((u) => { reg(u); if (u.username !== ME) ONL.add(u.username); });
  $('#online').innerHTML = [...ONL].slice(0, 6).map((u) => `<button class="sr" style="width:100%;text-align:left" data-dm="${esc(u)}"><div class="xs" style="position:relative">${av(u, col(u))}<i class="dot"></i></div><div><b>${esc(u)}</b><small>En ligne</small></div></button>`).join('') || '<div class="empty" style="padding:12px">Personne en ligne pour le moment.</div>';
}
const SITES = [['FastDL', 'fastdl.app', 'Télécharger des photos et vidéos Instagram', '#f58529,#dd2a7b'], ['FDown', 'fdown.net', 'Télécharger des vidéos Facebook', '#1877f2,#0b4fb3'], ['Gratos', 'gratos.app', 'Un site gratuit à découvrir', '#12b886,#0b7285'], ['Onread', 'onread.com', 'Un site gratuit à découvrir', '#7950f2,#4c2fb8'], ['Discover Profile', 'discoverprofile.com', 'Un site gratuit à découvrir', '#fa5252,#c2255c']];
$('#sites').innerHTML = SITES.map((s) => `<div class="sr"><div class="xs"><div class="av" style="--c:linear-gradient(135deg,${s[3]});border-radius:12px">${s[0][0]}</div></div><div><b>${s[0]}</b><small>${s[2]}</small></div><a class="go" href="https://${s[1]}" target="_blank" rel="noopener noreferrer" aria-label="Visiter ${s[0]}">Visiter</a></div>`).join('');

/* ---------- Configuration admin : sites suggérés + fonds de discussion + panneau ---------- */
let CFG = { sites: [], bgs: [], staff: false, admin: false }; const BG0 = BG.length, GR = ['#f58529,#dd2a7b', '#1877f2,#0b4fb3', '#12b886,#0b7285', '#7950f2,#4c2fb8', '#0057FF,#8B3EF0'];
function paintSites() {
  const l = CFG.sites.length ? CFG.sites.map((x, i) => [x.title, x.url, x.desc, GR[i % GR.length]]) : SITES.map((x) => [x[0], 'https://' + x[1], x[2], x[3]]);
  $('#sites').innerHTML = l.map((x) => `<div class="sr"><div class="xs"><div class="av" style="--c:linear-gradient(135deg,${x[3]});border-radius:12px">${esc(x[0][0])}</div></div><div><b>${esc(x[0])}</b><small>${esc(x[2])}</small></div><a class="go" href="${esc(x[1])}" target="_blank" rel="noopener noreferrer" aria-label="Visiter ${esc(x[0])}">Visiter</a></div>`).join('');
}
function applyCfgBgs() { BG.length = BG0; CFG.bgs.forEach((b) => BG.push([b.name, '', null, null, b.url])); }
async function loadCfg() { try { CFG = await api('GET', '/api/site-config'); } catch { return; } paintSites(); applyCfgBgs(); }
window.JXADM = { row: () => (CFG.staff ? `<button class="arow" data-adm>${PX('lock')}Administration</button>` : '') };
function admHtml() {
  const sites = CFG.sites.map((x, i) => `<div class="sr"><div><b>${esc(x.title)}</b><small>${esc(x.desc)}</small></div><button class="chip" data-adm-del="s${i}">Supprimer</button></div>`).join('') || '<p class="adm-s">Aucun site ajouté : la liste par défaut est affichée.</p>';
  const bgs = CFG.bgs.map((b, i) => `<div class="sr"><div class="xs"><div class="av" style="background:url('${esc(b.url)}') center/cover;border-radius:10px"></div></div><div><b>${esc(b.name)}</b></div><button class="chip" data-adm-del="b${i}">Supprimer</button></div>`).join('') || '<p class="adm-s">Aucun fond ajouté.</p>';
  return `<h3>Administration</h3><a class="arow" href="/admin">Modération : signalements et utilisateurs</a>` + (CFG.admin ? `<h4>Sites suggérés (barre latérale)</h4>${sites}<input class="adm-in" id="as-t" maxlength="60" placeholder="Nom du site"><input class="adm-in" id="as-u" type="url" inputmode="url" placeholder="https://…"><input class="adm-in" id="as-d" maxlength="160" placeholder="Description courte"><button class="pub2" data-adm-add="s">Ajouter le site</button><h4>Fonds d’écran de discussion</h4>${bgs}<input class="adm-in" id="ab-n" maxlength="30" placeholder="Nom du fond"><input class="adm-in" id="ab-u" type="url" inputmode="url" placeholder="https://… lien de l’image"><button class="pub2" data-adm-add="b">Ajouter le fond</button><p class="er" id="adm-e" role="alert"></p>` : '<p class="adm-s">Seuls les administrateurs modifient les sites et les fonds.</p>');
}
async function admSave(next) {
  try { const r = await api('PUT', '/api/admin/site-config', next); CFG.sites = r.sites; CFG.bgs = r.bgs; paintSites(); applyCfgBgs(); openS(admHtml()); T('Enregistré'); }
  catch (x) { const e = $('#adm-e'); if (e) e.textContent = x.message; else T(x.message); }
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-adm]')) return openS(admHtml());
  const d = e.target.closest('[data-adm-del]'), a = e.target.closest('[data-adm-add]');
  if (d) { const k = d.dataset.admDel[0], i = +d.dataset.admDel.slice(1); return admSave({ sites: CFG.sites.filter((_, j) => k !== 's' || j !== i), bgs: CFG.bgs.filter((_, j) => k !== 'b' || j !== i) }); }
  if (a) {
    const v = (id) => ($(id).value || '').trim(), s = a.dataset.admAdd === 's', u = v(s ? '#as-u' : '#ab-u'), er = $('#adm-e');
    try { if (new URL(u).protocol !== 'https:') throw 0; } catch { er.textContent = 'Entrez un lien HTTPS valide.'; return; }
    if (s) { if (!v('#as-t')) { er.textContent = 'Entrez le nom du site.'; return; } admSave({ sites: [...CFG.sites, { title: v('#as-t'), url: u, desc: v('#as-d') }], bgs: CFG.bgs }); }
    else { if (!v('#ab-n')) { er.textContent = 'Entrez le nom du fond.'; return; } admSave({ sites: CFG.sites, bgs: [...CFG.bgs, { name: v('#ab-n'), url: u }] }); }
  }
});

/* ---------- Fil d'actualité ---------- */
const VER = '<svg viewBox="0 0 24 24" width="15" height="15"><circle cx="12" cy="12" r="11" fill="#0057FF"/><path d="m7 12.5 3 3 7-7" stroke="#fff" stroke-width="2.4" fill="none"/></svg>';
const ptxt = (s) => lin(esc(s || '')).replace(/(^|\s)(#[\p{L}\p{N}_]{2,30})/gu, '$1<a class="htag" href="#" data-q="$2">$2</a>');
const host = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const YT = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/|v\/))([\w-]{11})/;
function embed(u) {
  let m;
  if ((m = u.match(YT))) return `<iframe referrerpolicy="strict-origin-when-cross-origin" src="https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1" allow="autoplay; fullscreen" allowfullscreen style="width:100%;height:100%;min-height:200px;border:0;border-radius:12px"></iframe>`;
  if ((m = u.match(/vimeo\.com\/(\d+)/))) return `<iframe src="https://player.vimeo.com/video/${m[1]}?autoplay=1" allow="autoplay; fullscreen" allowfullscreen style="width:100%;height:100%;min-height:200px;border:0;border-radius:12px"></iframe>`;
  return `<video src="${esc(u)}" controls autoplay playsinline style="width:100%;max-height:420px;border-radius:12px"></video>`;
}
const ytid = (u) => { const m = u.match(YT); return m && m[1]; };
const thumb = (u) => { const y = ytid(u); return y ? `<img src="https://img.youtube.com/vi/${y}/hqdefault.jpg" alt="" referrerpolicy="no-referrer">` : `<div style="background:linear-gradient(135deg,#0b1030,#2b2f8f 60%,#8b3ef0);display:grid;place-items:center;color:#9fb4ff;font:600 16px monospace;padding:16px;text-align:center">${esc(host(u))}</div>`; };
const isEmb = (u) => /youtu\.?be|vimeo\.com|\.(mp4|webm|ogg)(\?|$)/i.test(u);
media = function (p) {
  const r = p.raw; if (!r) return '';
  const one = (o) => {
    if (o.mediaType === 'image') return `<div class="media"><img data-u="${esc(o.mediaUrl)}" src="${esc(o.mediaUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`;
    if (o.mediaType === 'video' && !isEmb(o.mediaUrl) && !/(facebook|fb\.watch|tiktok|instagram|twitter|x\.com)/i.test(o.mediaUrl)) return `<div class="media"><video src="${esc(o.mediaUrl)}#t=0.1" data-u="${esc(o.mediaUrl)}" controls playsinline preload="metadata" style="background:#000"></video></div>`;
    if (o.mediaType === 'video' && isEmb(o.mediaUrl)) return `<div class="media" data-vu="${esc(o.mediaUrl)}">${thumb(o.mediaUrl)}<button class="play" aria-label="Lire la vidéo"><span>${ic('play', 'style="fill:#fff;margin-left:3px"')}</span></button><span class="tag">Vidéo</span></div>`;
    if (o.mediaType === 'video' || o.mediaType === 'link') return `<a class="lk" href="${esc(o.mediaUrl)}" target="_blank" rel="noopener noreferrer" style="--c:linear-gradient(135deg,${o.mediaType === 'video' ? '#8B3EF0,#0057FF' : '#12b886,#0b7285'})"><div class="th">${ic(o.mediaType === 'video' ? 'play' : 'ext')}</div><div><small>${esc(host(o.mediaUrl))}</small><b>${o.mediaType === 'video' ? 'Vidéo' : 'Lien'}</b><small>${esc(o.mediaUrl)}</small></div></a>`;
    return '';
  };
  let h = one(r);
  if (r.sharedFrom) {
    const s = r.sharedFrom; reg(s.author);
    h += s.deleted ? '<div class="shared"><div class="pt" style="padding:0">Cette publication n’est plus disponible.</div></div>'
      : `<div class="shared"><div class="ph" style="padding:0 0 8px"><div class="xs">${av(s.author.username, col(s.author.username))}</div><b>${esc(s.author.username)}</b></div><div class="pt" style="padding:0 0 8px">${ptxt(s.content)}</div>${one(s)}</div>`;
  }
  return h;
};
function mapPost(r) {
  reg(r.author); const a = r.author.username;
  return { id: r.id, aid: r.author.id, a, k: col(a), v: (r.author.roles || []).some((x) => x !== 'USER') ? 1 : 0, t: ago(r.createdAt), x: r.content, m: r.mediaType, n: r.likesCount - (r.likedByMe ? 1 : 0), liked: !!r.likedByMe, raw: r };
}
post = function (p, i) {
  const r = p.raw || {}, mine = String(p.aid) === String(MEID);
  return `<article class="card post" data-id="${p.id}" data-aid="${p.aid}" data-mine="${mine ? 1 : 0}" style="animation:sh0 .5s ${i * .06}s both"><div class="ph"><div class="sm">${av(p.a, p.k)}</div><div><b>${esc(p.a)}${p.v ? VER : ''}</b><small>${p.t}</small></div><button class="more" aria-label="Options">${ic('more')}</button></div>${p.x ? `<div class="pt">${ptxt(p.x)}</div>` : ''}${media(p)}${r.description ? `<div class="pt" style="color:var(--sub);font-size:13.5px;margin-top:10px">${ptxt(r.description)}</div>` : ''}<div class="pa"><button class="act ${p.liked ? 'on' : ''}" aria-pressed="${!!p.liked}" onclick="lk(this,${p.n})">${ic('heart')}<span>${fm(p.n + (p.liked ? 1 : 0))}</span></button><button class="act">${ic('share')}<span>Partager</span></button></div></article>`;
};
let feedSkip = 0;
async function loadFeed(reset) {
  const f = $('#feed');
  if (reset) { feedSkip = 0; f.innerHTML = '<div class="card sk"></div><div class="card sk"></div>'; }
  const l = await api('GET', '/api/posts?limit=20&skip=' + feedSkip); feedSkip += l.length;
  f.querySelectorAll('.sk,.more2,.empty').forEach((e) => e.remove());
  f.insertAdjacentHTML('beforeend', l.map((r, i) => post(mapPost(r), i)).join(''));
  if (!f.querySelector('.post')) f.innerHTML = '<div class="card empty"><b>Aucune publication</b>Soyez le premier à publier quelque chose !</div>';
  else if (l.length >= 20) f.insertAdjacentHTML('beforeend', '<button class="more2">Voir plus</button>');
}
load = () => {};
document.addEventListener('click', async (e) => {
  const m = e.target.closest('.more2'); if (!m) return; e.stopImmediatePropagation(); m.disabled = true;
  try { await loadFeed(false); } catch (x) { T(x.message); m.disabled = false; }
}, true);
{ // composeur
  const ps = $('#ps'), n = ps.cloneNode(true); ps.replaceWith(n);
  n.addEventListener('click', async () => {
    const x = $('#pc').value.trim(), t = $('#pm').value, u = $('#pu').value.trim(), d = ($('#pd') || {}).value ? $('#pd').value.trim() : '', er = (s) => ($('#pe').textContent = s);
    if (t !== 'none') { try { if (new URL(u).protocol !== 'https:') throw 0; } catch { return er('Entrez une URL HTTPS valide.'); } }
    if (!x && t === 'none') return er('Écrivez quelque chose ou ajoutez un média.');
    n.disabled = true; er('');
    try {
      const r = await api('POST', '/api/posts', { content: x, mediaType: t, mediaUrl: t === 'none' ? '' : u, description: d });
      addPost(r, true); $('#pc').value = ''; $('#pu').value = ''; if ($('#pd')) $('#pd').value = ''; M.classList.remove('on'); T('Publié !'); PD.np++; POSTS.unshift(tileOf(r));
    } catch (x) { er(x.message); } finally { n.disabled = false; }
  });
}
function addPost(r, mine) {
  const f = $('#feed'); if (f.querySelector(`.post[data-id="${r.id}"]`)) return;
  f.querySelector('.empty') && f.querySelector('.empty').remove();
  const w = document.createElement('div'); w.innerHTML = post(mapPost(r), 0); f.prepend(w.firstElementChild);
}

/* clics sur le fil : like, menu, partage, vidéos, hashtags */
document.addEventListener('click', async (e) => {
  const t = e.target, art = t.closest('.post'), id = art && art.dataset.id;
  let x;
  if ((x = t.closest('.act[onclick^="lk("]')) && id) { // like (l'interface bascule déjà l'état)
    const n = +x.getAttribute('onclick').match(/lk\(this,(\d+)\)/)[1];
    api('POST', `/api/posts/${id}/like`).catch((er) => { lk(x, n); T(er.message); });
    return;
  }
  if ((x = t.closest('.act')) && /Partager/.test(x.textContent) && id) {
    $('#shl').innerHTML = D.slice(0, 8).map((c) => `<button class="sr shr" data-cid="${c.id}" style="width:100%;text-align:left"><div class="xs">${c.type === 'group' ? avc(c) : av(c.name, c.k)}</div><div><b>${esc(c.name)}</b><small>Envoyer dans la conversation</small></div></button>`).join('')
      + `<button class="sr shr" data-copy style="width:100%;text-align:left"><div class="xs"><div class="av" style="--c:var(--chip);color:var(--b)">${ic('share')}</div></div><div><b>Copier le lien</b><small>Ou partager via le système</small></div></button>`;
    return; // la feuille s'ouvre via le gestionnaire d'origine
  }
  if ((x = t.closest('.shr')) && window.sharing) {
    const pid = window.sharing.dataset.id, a = window.sharing.dataset.aid; e.stopImmediatePropagation(); e.preventDefault(); SH.classList.remove('on');
    if (x.hasAttribute('data-copy')) { const au = window.sharing.querySelector('.ph b'); const link = `${location.origin}/lapage/${encodeURIComponent(au.textContent.trim())}/actu/${pid}`; if (navigator.share) navigator.share({ url: link }).catch(() => {}); else copy(link, 'Lien copié'); return; }
    try { await api('POST', `/api/posts/${pid}/share`, { conversationId: x.dataset.cid, description: '' }); T('Publication envoyée à ' + (x.querySelector('b').textContent)); } catch (er) { T(er.message); }
    return;
  }
  if ((x = t.closest('.more')) && art) { // menu : ajoute « Enregistrer » une fois le menu d'origine ouvert
    setTimeout(() => { const p = art.querySelector('.pop'); if (p && !p.querySelector('[data-pm="save"]')) p.insertAdjacentHTML('afterbegin', '<button data-pm="save">Enregistrer</button>'); }, 0);
    return;
  }
  if ((x = t.closest('[data-pm]')) && art) {
    const m = x.dataset.pm; e.stopImmediatePropagation(); e.preventDefault(); x.closest('.pop').remove();
    try {
      if (m === 'del') { await api('DELETE', '/api/posts/' + id); art.style.maxHeight = art.offsetHeight + 'px'; art.offsetHeight; art.classList.add('out'); setTimeout(() => art.remove(), 420); PD.np = Math.max(0, PD.np - 1); const i = POSTS.findIndex((p) => p.id === id); if (i > -1) POSTS.splice(i, 1); T('Publication supprimée'); }
      else if (m === 'rep') { await api('POST', '/api/reports', { targetType: 'post', targetId: id, reason: 'Signalée depuis le fil d’actualité' }); T('Signalement envoyé'); }
      else if (m === 'save') { const r = await api('POST', '/api/saved/' + id); T(r.saved ? 'Publication enregistrée' : 'Retirée des enregistrements'); }
      else copy(`${location.origin}/lapage/${encodeURIComponent(art.querySelector('.ph b').textContent.trim())}/actu/${id}`, 'Lien copié');
    } catch (er) { T(er.message); }
    return;
  }
  if ((x = t.closest('.play')) && x.parentNode.dataset.vu) { e.stopImmediatePropagation(); e.preventDefault(); x.parentNode.innerHTML = embed(x.parentNode.dataset.vu); return; }
  if ((x = t.closest('.htag'))) { e.stopImmediatePropagation(); e.preventDefault(); xQ = x.dataset.q; go('exp'); renderExp(); return; }
}, true);

/* ---------- Stories ---------- */
async function loadStories() { STG = await api('GET', '/api/stories'); STG.forEach((g) => reg(g.author)); renderStories(); }
function renderStories() {
  $('#stories').innerHTML = `<button class="st" data-new="1"><div class="add">${ic('plus')}</div>Votre story</button>` + STG.map((g, i) => {
    const me = String(g.author.id) === String(MEID), n = me ? 'Ma story' : g.author.username;
    return `<button class="st" data-g="${i}"><div class="ring ${g.allSeen || me ? 'seen' : ''}">${av(g.author.username, col(g.author.username))}</div><span style="max-width:64px;overflow:hidden;text-overflow:ellipsis">${esc(n)}</span></button>`;
  }).join('');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('#stories .st'); if (!b) return; e.stopImmediatePropagation(); e.preventDefault();
  if (b.dataset.new) return window.JXStory ? JXStory.open({ post: (body) => api('POST', '/api/stories', body), done: () => { loadStories().catch(() => {}); T('Story publiée'); } }) : storyForm();
  const g = STG[+b.dataset.g]; if (g) sv2(g.author.username, col(g.author.username), 0);
}, true);
function storyForm() {
  openS(`<h3>Nouvelle story</h3><textarea id="sc-t" rows="3" maxlength="300" placeholder="Votre texte (300 caractères max)"></textarea><select id="sc-m"><option value="text">Texte</option><option value="image">Image (URL)</option><option value="video">Vidéo (URL)</option></select><input id="sc-u" placeholder="https://…" hidden><p class="er" id="sc-e" role="alert"></p><div class="rw"><button class="chip" data-x>Annuler</button><button class="pub2" data-sc="go" style="width:auto">Publier</button></div>`);
  $('#sc-m').onchange = (e) => ($('#sc-u').hidden = e.target.value === 'text');
}
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-sc="go"]')) return; e.stopImmediatePropagation();
  const t = $('#sc-t').value.trim(), m = $('#sc-m').value, u = $('#sc-u').value.trim(), er = (s) => ($('#sc-e').textContent = s);
  if (m === 'text' && !t) return er('Écrivez un texte.');
  if (m !== 'text') { try { if (new URL(u).protocol !== 'https:') throw 0; } catch { return er('Entrez une URL HTTPS valide.'); } }
  try { await api('POST', '/api/stories', { mediaType: m, content: t, mediaUrl: m === 'text' ? '' : u }); CL(); await loadStories(); T('Story publiée'); } catch (x) { er(x.message); }
}, true);
sv2 = function (n, k, i) {
  const g = STG.find((z) => z.author.username === n); clearTimeout(sv2.t);
  if (!g || i >= g.stories.length) { SV.classList.remove('on'); return; } if (i < 0) i = 0;
  const s = g.stories[i], N = g.stories.length, mine = String(g.author.id) === String(MEID);
  const L = s.layout && s.layout.elements && window.JXStory ? s.layout : null, ms = L && L.dur ? L.dur * 1000 : (s.mediaType === 'video' || s.mediaType === 'audio' ? 15000 : 5000);
  let body = '';
  if (s.mediaType === 'image') body = `<img src="${esc(s.mediaUrl)}" alt="" style="max-width:100%;max-height:100%;border-radius:16px;object-fit:contain">`;
  else if (s.mediaType === 'video') body = isEmb(s.mediaUrl) ? embed(s.mediaUrl) : `<a class="chip" href="${esc(s.mediaUrl)}" target="_blank" rel="noopener noreferrer">Ouvrir la vidéo</a>`;
  else if (s.mediaType === 'audio') body = `<audio src="${esc(s.mediaUrl)}" controls autoplay></audio>`;
  if (L) body = '<div class="se-stage" id="se-view"></div>';
  const cap = s.content && !L ? `<div style="${s.mediaType === 'text' ? '' : 'position:absolute;left:0;right:0;bottom:8px;'}font:600 ${s.mediaType === 'text' ? 26 : 17}px Fraunces,serif;text-align:center;padding:0 10px;text-shadow:0 1px 6px rgba(0,0,0,.4)">${esc(s.content)}</div>` : '';
  SV.firstChild.innerHTML = `<div style="display:flex;gap:4px">${[...Array(N)].map((_, j) => `<div class="pg" style="flex:1">${j < i ? '<i style="animation:none;width:100%"></i>' : j == i ? `<i${L ? ` style="animation-duration:${ms}ms"` : ''}></i>` : ''}</div>`).join('')}</div><div style="display:flex;gap:10px;align-items:center"><div class="xs">${av(n, k)}</div><b>${esc(n)}</b><small style="opacity:.7">${ago(s.createdAt)}</small>${mine ? `<button class="chip" data-sviews="${s.id}" style="margin-left:auto" aria-label="Voir qui a vu cette story">${s.viewsCount} vue${s.viewsCount > 1 ? 's' : ''} ›</button>` : ''}</div><div${L ? ' class="se-fit"' : ''} style="flex:1;display:grid;place-items:center;position:relative;min-height:0;overflow:hidden">${body}${cap}<span data-z="-1" style="position:absolute;left:0;top:0;bottom:0;width:40%"></span><span data-z="1" style="position:absolute;right:0;top:0;bottom:0;width:60%"></span></div><div style="display:flex;gap:8px;justify-content:center"><button class="chip" data-x>Fermer</button>${mine ? `<button class="chip" data-sdel="${s.id}">Supprimer</button>` : ''}</div>`;
  SV.dataset.n = n; SV.dataset.k = k; SV.dataset.i = i; SV.firstChild.style.background = 'linear-gradient(160deg,' + G[(k + i) % 6] + ')'; SV.classList.add('on');
  if (L) JXStory.build(SV.querySelector('#se-view'), L, s);
  if (!mine && !s.viewedByMe) { s.viewedByMe = true; api('POST', `/api/stories/${s.id}/view`).catch(() => {}); if (g.stories.every((z) => z.viewedByMe)) { g.allSeen = true; renderStories(); } }
  sv2.t = setTimeout(() => { if (SV.classList.contains('on')) sv2(n, k, i + 1); }, ms);
};
document.addEventListener('click', async (e) => {
  const vb = e.target.closest('[data-sviews]'), vc = e.target.closest('[data-svclose]');
  if (vc) { e.stopImmediatePropagation(); const q = SV.querySelector('.sv-vw'); if (q) q.remove(); sv2(SV.dataset.n, +SV.dataset.k, +SV.dataset.i); return; }
  if (!vb) return; e.stopImmediatePropagation(); clearTimeout(sv2.t);
  const old = SV.querySelector('.sv-vw'); if (old) old.remove();
  const p = document.createElement('div'); p.className = 'sv-vw'; p.innerHTML = '<div class="sv-vh"><b>Vues</b><button class="chip" data-svclose>Fermer</button></div><div class="sv-vl"><small>Chargement…</small></div>'; SV.firstChild.appendChild(p);
  try { const l = await api('GET', `/api/stories/${vb.dataset.sviews}/views`); l.forEach((v) => reg(v.user)); p.querySelector('.sv-vl').innerHTML = l.length ? l.map((v) => `<div class="sr"><div class="xs">${av(v.user.username, col(v.user.username))}</div><div><b>${esc(v.user.username)}</b><small>${ago(v.viewedAt)}</small></div></div>`).join('') : '<small>Personne pour le moment.</small>'; }
  catch (x) { p.querySelector('.sv-vl').textContent = x.message; }
}, true);
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-sdel]'); if (!b) return; e.stopImmediatePropagation();
  try { await api('DELETE', '/api/stories/' + b.dataset.sdel); SV.classList.remove('on'); await loadStories(); T('Story supprimée'); } catch (x) { T(x.message); }
}, true);

/* ---------- Messagerie ---------- */
const ptype = (t) => (t === 'shared_post' ? 'sp' : t === 'sticker' || t === 'note' ? 'text' : t === 'deleted' || t === 'expired' ? 'text' : t);
function mapMsg(m) {
  reg(m.sender); const mine = String(m.senderId) === String(MEID), r = {}; let me = null;
  (m.reactions || []).forEach((x) => { r[x.type] = (r[x.type] || 0) + 1; if (String(x.userId) === String(MEID)) me = x.type; });
  const o = { id: m.id, f: mine ? 'me' : (m.sender ? m.sender.username : '?'), x: m.content || '', t: +new Date(m.createdAt), a: 0, type: ptype(m.type), url: m.url || '', r, me, pin: !!m.pinned, ed: !!m.editedAt, del: !!(m.deleted || m.expired || m.type === 'deleted' || m.type === 'expired'), seen: (m.seenBy || []).some((id) => String(id) !== String(MEID)) };
  if (o.type === 'sp') { const s = m.sharedPost; o.who = s && s.author ? reg(s.author).username : 'Publication'; o.x = s && !s.deleted ? (s.content || 'Publication').slice(0, 90) : 'Publication indisponible'; o.pimg = s && s.mediaType === 'image' ? s.mediaUrl : ''; }
  if (m.replyPreview) o.rp = { a: m.replyPreview.author ? m.replyPreview.author.username : '…', x: m.replyPreview.deleted ? 'Message supprimé' : (m.replyPreview.content || pv({ type: ptype(m.replyPreview.type) })) };
  return o;
}
function mapConv(x) {
  let c = D.find((z) => z.id === x.id); if (!c) { c = { id: x.id, ms: [], unread: 0, k: 0 }; D.push(c); }
  x.members.forEach(reg); const o = x.otherUser;
  Object.assign(c, { type: x.type, name: x.name, unread: x.unreadCount || 0, ids: x.members.map((m) => m.id), mem: x.members.map((m) => m.username), owner: String(x.owner) === String(MEID) ? 1 : 0, other: o ? o.id : null, k: col(x.name), bgSrv: x.background });
  if (o) { o.isOnline ? ONL.add(o.username) : ONL.delete(o.username); c.ls = o.lastSeen ? +new Date(o.lastSeen) : 0; c.seen = seenTxt(c.ls); }
  applyBg(c, x.background);
  if (!c.loaded && x.lastMessage && x.lastMessage.createdAt && Date.now() - +new Date(x.lastMessage.createdAt) < 5 * 864e5) { const l = x.lastMessage; c.ms = [{ id: 'lm' + x.id, f: String(l.senderId) === String(MEID) ? 'me' : (c.name), x: l.content || '', type: ptype(l.type), t: +new Date(l.createdAt), a: 0, stub: 1, r: {} }]; }
  return c;
}
function applyBg(c, b) {
  if (!b || b.type === 'none') { if (!c.bgu) c.bg = 0; return; }
  const m = /^bg(\d+)$/.exec(b.value || ''); if (b.type === 'gradient' && m && BG[+m[1]]) c.bg = +m[1];
}
async function loadConvs() { const l = await api('GET', '/api/conversations?limit=50'); const keep = new Set(l.map((x) => x.id)); l.forEach(mapConv); for (let i = D.length - 1; i >= 0; i--) if (!keep.has(D[i].id)) D.splice(i, 1); const S = sget('jx-bgs', {}); D.forEach((c) => { const s = S[c.id]; if (s && s.bgu) { c.bg = s.bg; c.bgu = s.bgu; } }); }
async function resync() { // rattrape ce qui a été manqué pendant une coupure du socket (veille du téléphone, réseau instable)
  if (!booted) return;
  try {
    await loadConvs(); const c = cur && cv();
    if (c && c.loaded && !document.hidden) {
      const l = await api('GET', `/api/conversations/${c.id}/messages?limit=50`); let add = 0;
      l.filter((m) => !m.expired && m.type !== 'expired').map(mapMsg).forEach((m) => { if (!c.ms.some((z) => String(z.id) === String(m.id))) { c.ms.push(m); add++; } });
      if (add) { c.ms.sort((a, b) => a.t - b.t); th2(); }
      c.unread = 0; api('POST', `/api/conversations/${c.id}/seen`).catch(() => {});
    }
    renderList();
  } catch {}
}
let sockUp = false;
document.addEventListener('visibilitychange', () => { if (document.hidden || !booted) return; if (SOCK && !SOCK.connected) SOCK.connect(); resync(); });
addEventListener('online', () => { if (booted && SOCK && !SOCK.connected) SOCK.connect(); });
setInterval(() => { if (booted && SOCK && !SOCK.connected && !document.hidden) resync(); }, 15000);
async function loadMsgs(c) { const l = await api('GET', `/api/conversations/${c.id}/messages?limit=50`); c.ms = l.filter((m) => !m.expired && m.type !== 'expired').map(mapMsg).sort((a, b) => a.t - b.t); c.loaded = 1; }
const _open = openConv;
openConv = function (id) {
  const c = D.find((z) => z.id === id); if (!c) return; const un = c.unread;
  if (cur && cur !== id && SOCK) SOCK.emit('leave_conversation', cur);
  _open(id); if (SOCK) SOCK.emit('join_conversation', id);
  const done = () => { if (cur !== id) return; c.ud = un && c.ms.length >= un ? c.ms[c.ms.length - un].id : null; renderThread(true); renderList(); };
  (c.loaded ? Promise.resolve() : loadMsgs(c)).then(done).catch((e) => T(e.message));
  api('POST', `/api/conversations/${id}/seen`).catch(() => {});
};
initMsg = function (id) { renderList(); renderChat(); if (id) openConv(id); };
dm = async function (name) {
  let c = D.find((z) => z.type === 'private' && z.name === name);
  if (!c) { try { const x = await api('POST', '/api/conversations/private', { userId: UID[name] }); c = mapConv(x); } catch (e) { return T(e.message); } }
  go('msg', c.id);
};
push = function (c, m) { if (!navigator.onLine) m.fail = 1; c.ms = c.ms.filter((z) => !z.stub); c.ms.push(m); c.ud = null; bars(); appendOne(c, m); renderList(); if (!m.fail) sendOut(c, m); };
async function sendOut(c, m) {
  m.pending = 1; m.cid = m.cid || rid();
  try {
    const b = { type: m.type === 'sp' ? 'shared_post' : m.type, clientId: m.cid, content: m.x };
    if (['image', 'video', 'audio', 'link'].includes(m.type)) { if (!m.imageId) b.url = m.url; b.content = m.type === 'link' ? '' : m.x; }
    if (m.imageId) b.imageId = m.imageId;
    if (m.rpId) b.replyTo = m.rpId;
    const r = await api('POST', `/api/conversations/${c.id}/messages`, b); adopt(c, m, r.id);
  } catch (e) { m.pending = 0; m.fail = 1; if (cur === c.id) th2(); T(e.message); }
}
function adopt(c, m, id) {
  m.pending = 0; m.fail = 0;
  const dup = c.ms.find((z) => z !== m && String(z.id) === String(id));
  if (dup) { c.ms.splice(c.ms.indexOf(m), 1); const el = $(`.mw[data-id="${m.id}"]`); if (el) el.remove(); return; }
  const el = $(`.mw[data-id="${m.id}"]`); if (el) el.dataset.id = id; m.id = id; setTimeout(() => { const s = $(`.mw[data-id="${id}"] time`); if (s && m.seen) s.innerHTML = fmtT(m.t) + ' <span class="tk">✓✓</span>'; }, 0);
}
send = function () {
  const i = $('#mi'), x = i.value.trim(), c = cv(); if (!x || !c) return;
  if (edit) { const m = edit; edit = null; i.value = ''; $('#sd').disabled = true; bars(); api('PUT', '/api/messages/' + m.id, { content: x }).then(() => { m.x = x; m.ed = 1; th2(); T('Message modifié'); }).catch((e) => T(e.message)); return; }
  const m = mm('me', x, 0, { t: Date.now() });
  if (reply) { m.rp = { a: reply.f === 'me' ? ME : reply.f, x: pv(reply) }; m.rpId = /^[a-f\d]{24}$/i.test(reply.id) ? reply.id : null; reply = null; }
  push(c, m); i.value = ''; $('#sd').disabled = true; if (SOCK) SOCK.emit('typing_stop', { conversationId: c.id });
};
sendImg = async function () {
  const c = cv(), cap = $('#cap').value.trim(), w = $('#pgw'), p = $('#pgi'), file = window.__jxFile; if (!file) return T('Image introuvable.');
  w.hidden = false; p.style.width = '40%';
  try {
    let bl, ct = 'image/jpeg';
    try { bl = await shrink(pend.data, 1600, .85); } catch { if (/^image\/(jpeg|png|webp)$/.test(file.type) && file.size <= 5e6) { bl = file; ct = file.type; } else throw new Error('Format d’image non pris en charge (JPEG, PNG ou WebP).'); }
    const r = await fetch(`/api/conversations/${c.id}/images`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': ct }, body: bl });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Envoi impossible.');
    p.style.width = '100%'; const m = mm('me', cap, 0, { type: 'image', url: pend.data, t: Date.now(), imageId: d.imageId }); pend = null; bars(); push(c, m);
  } catch (e) { T(e.message); pend = null; bars(); }
  setTimeout(() => { w.hidden = true; p.style.width = '0'; }, 400);
};
function shrink(src, max, qual) {
  return new Promise((ok, ko) => { const im = new Image(), u = src; im.onload = () => { const k = Math.min(1, max / Math.max(im.width, im.height)), cn = document.createElement('canvas'); cn.width = Math.round(im.width * k); cn.height = Math.round(im.height * k); cn.getContext('2d').drawImage(im, 0, 0, cn.width, cn.height); cn.toBlob((b) => (b ? ok(b) : ko(new Error('Image illisible.'))), 'image/jpeg', qual); }; im.onerror = () => ko(new Error('Image illisible.')); im.src = u; });
}
document.addEventListener('change', (e) => { // conserve le fichier pour l'envoi réel (le gestionnaire d'origine garde l'aperçu)
  if (e.target.id !== 'fi') return; const f = e.target.files[0]; if (f) window.__jxFile = f;
}, true);
react = async function (id, t) {
  const m = gm(id); if (!m) return; CL();
  try { const r = await api('POST', `/api/messages/${id}/react`, { type: t }); Object.assign(m, mapMsg({ ...r, sender: null, senderId: r.senderId })); m.f = m.f === '?' ? m.f : m.f; th2(); } catch (e) { T(e.message); }
};
shareTo = function (name) { /* le partage réel passe par la feuille de partage (publication → conversation) */ };
delConv = function (id) {
  const el = $(`[data-conv="${id}"]`); if (el) { el.style.maxHeight = el.offsetHeight + 'px'; el.offsetHeight; el.classList.add('rm'); }
  $('#dr').classList.remove('on');
  setTimeout(() => { const i = D.findIndex((c) => c.id === id); if (i > -1) D.splice(i, 1); if (cur === id) { cur = null; setCo(false); renderChat(); } renderList(); }, 380);
};
const _act = act;
act = function (a, x) {
  const id = x.dataset.id || (x.closest('.mw') || { dataset: {} }).dataset.id, m = id && gm(id), c = cv(), real = (v) => /^[a-f\d]{24}$/i.test(v);
  switch (a) {
    case 'pin': { if (!m || !real(m.id)) return; _act(a, x); api('POST', `/api/messages/${m.id}/pin`).catch((e) => { m.pin = !m.pin; th2(); T(e.message); }); return; }
    case 'del': { if (!m) return; if (!real(m.id)) { _act(a, x); return; } _act(a, x); api('DELETE', '/api/messages/' + m.id).catch((e) => { m.del = false; th2(); T(e.message); }); return; }
    case 'retry': { if (m) { CL(); m.fail = 0; th2(); sendOut(c, m); T('Message renvoyé'); } return; }
    case 'bg': { const i = +x.dataset.i; _act(a, x); if (BG[i][3] !== 'file') api('PUT', `/api/conversations/${c.id}/background`, i ? { type: 'gradient', value: 'bg' + i } : { type: 'none', value: '' }).catch((e) => T(e.message)); return; }
    case 'rep': case 'repc': { CL(); const t = a === 'rep' ? 'message' : 'conversation', tid = a === 'rep' ? (m && m.id) : c.id; if (!real(tid)) return T('Signalement impossible.'); api('POST', '/api/reports', { targetType: t, targetId: tid, reason: 'Signalé depuis la discussion' }).then(() => T('Signalement envoyé')).catch((e) => T(e.message)); return; }
    case 'block': return ask('Bloquer ' + c.name + ' ?', 'Bloquer', () => api('POST', '/api/users/block/' + c.other).then(() => { c.blocked = 1; $('#dr').classList.remove('on'); renderChat(); T(c.name + ' est bloqué'); }).catch((e) => T(e.message)));
    case 'unblock': CL(); return api('POST', '/api/users/unblock/' + c.other).then(() => { c.blocked = 0; $('#dr').classList.remove('on'); renderChat(); T(c.name + ' est débloqué'); }).catch((e) => T(e.message));
    case 'leave': return ask('Quitter « ' + c.name + ' » ?', 'Quitter', () => api('DELETE', `/api/conversations/${c.id}/members/${MEID}`).then(() => { delConv(c.id); T('Vous avez quitté le groupe'); }).catch((e) => T(e.message)));
    case 'delc': { const g = c.type === 'group' && c.owner; return ask((g ? 'Supprimer le groupe « ' : 'Supprimer la conversation avec « ') + c.name + ' » ?', 'Supprimer', () => api('DELETE', '/api/conversations/' + c.id).then(() => { delConv(c.id); T(g ? 'Groupe supprimé' : 'Conversation supprimée'); }).catch((e) => T(e.message))); }
    case 'rowdel': { const cc = D.find((z) => z.id === x.dataset.cid); return ask('Supprimer la conversation avec « ' + cc.name + ' » ?', 'Supprimer', () => api('DELETE', '/api/conversations/' + cc.id).then(() => { delConv(cc.id); T('Conversation supprimée'); }).catch((e) => T(e.message))); }
    case 'rowread': { const cc = D.find((z) => z.id === x.dataset.cid); CL(); if (cc.unread) { cc.unread = 0; api('POST', `/api/conversations/${cc.id}/seen`).catch(() => {}); } else cc.unread = 1; renderList(); return; }
    case 'gok': {
      const n = gx ? '' : ($('#gn').value || '').trim(), er = (s) => ($('#ge').textContent = s);
      if (!gx && !n) return er('Donnez un nom au groupe.'); if (!gs.size) return er('Choisissez au moins une personne.');
      const ids = [...gs].map((u) => UID[u]).filter(Boolean);
      return (async () => {
        try {
          if (gx) { const cc = cv(); for (const uid of ids) await api('POST', `/api/conversations/${cc.id}/members`, { userId: uid }); CL(); const l = await api('GET', '/api/conversations/' + cc.id).catch(() => null); if (l) mapConv(l); drw(); renderList(); T(ids.length + ' membre(s) ajouté(s)'); }
          else { const g = mapConv(await api('POST', '/api/conversations/group', { name: n, memberIds: ids })); CL(); renderList(); openConv(g.id); T('Groupe « ' + n + ' » créé'); }
        } catch (e) { er(e.message); }
      })();
    }
    default: return _act(a, x);
  }
};
gl = function () {
  const qy = ($('#gq').value || '').trim(), ex = gx ? cv().mem : [], box = $('#gl');
  clearTimeout(gl.t); gl.t = setTimeout(async () => {
    let l = []; try { l = qy ? await api('GET', '/api/users/search?q=' + encodeURIComponent(qy)) : (await api('GET', '/api/explore/accounts')); } catch {}
    l.forEach(reg);
    box.innerHTML = l.filter((u) => u.username !== ME && !ex.includes(u.username)).map((u) => `<button class="cand ${gs.has(u.username) ? 'sel' : ''}" data-cand="${esc(u.username)}"><div class="xs">${av(u.username, col(u.username))}</div><b>${esc(u.username)}</b><i class="mc">${ic('check')}</i></button>`).join('') || '<div class="empt">Aucun résultat.</div>';
  }, 200);
};
addEventListener('error', (e) => { const v = e.target; if (v && v.tagName === 'VIDEO' && v.dataset.u && v.parentNode) v.parentNode.outerHTML = `<a class="lk" href="${esc(v.dataset.u)}" target="_blank" rel="noopener noreferrer" style="--c:linear-gradient(135deg,#8B3EF0,#0057FF)"><div class="th">${ic('play')}</div><div><small>${esc(host(v.dataset.u))}</small><b>Ouvrir la vidéo</b></div></a>`; }, true);
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-dl]'); if (!b) return; e.stopImmediatePropagation(); e.preventDefault();
  const u = b.dataset.dl;
  try { const r = await fetch(u, { credentials: 'same-origin' }); if (!r.ok) throw 0; const bl = await r.blob(), a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = 'jexchat-image.' + ((bl.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  catch { if (/^data:/.test(u)) { const a = document.createElement('a'); a.href = u; a.download = 'jexchat-image.jpg'; document.body.append(a); a.click(); a.remove(); } else window.open(u, '_blank', 'noopener'); }
}, true);
// lecteurs audio / vidéo des messages
document.addEventListener('click', (e) => {
  let x = e.target.closest('[data-au]'); if (x && x.closest('.mw')) { const m = gm(x.closest('.mw').dataset.id); if (m && m.url) { if (!x.__a) { x.__a = new Audio(m.url); x.__a.onended = () => x.classList.remove('pl'); } x.classList.contains('pl') ? x.__a.pause() : x.__a.play().catch(() => T('Lecture impossible.')); } return; }
  x = e.target.closest('[data-play]'); if (x && x.closest('.mw')) { const m = gm(x.closest('.mw').dataset.id); if (m && m.url) { e.stopImmediatePropagation(); x.outerHTML = `<div class="vd" style="cursor:default;overflow:hidden;width:min(320px,100%);aspect-ratio:16/9">${embed(m.url)}</div>`; } }
}, true);
const _mh = mh;
mh = function (c, m, p) { // photo du partage de publication + téléchargement
  let h = _mh(c, m, p); if (m.type === 'image' && !m.del && m.url) h = h.replace(/(<img [^>]*>)/, `$1<button class="chip dlb" data-dl="${esc(m.url)}"><span style="color:var(--t)">⬇ Télécharger</span></button>`); if (m.type === 'sp' && m.pimg) h = h.replace(/<img src="[^"]*" alt="">/, `<img src="${esc(m.pimg)}" alt="">`); return h;
};
document.addEventListener('input', (e) => { // « écrit… »
  if (e.target.id !== 'mi' || !SOCK || !cur) return; if (!typT) SOCK.emit('typing_start', { conversationId: cur });
  clearTimeout(typT); typT = setTimeout(() => { typT = 0; SOCK.emit('typing_stop', { conversationId: cur }); }, 2500);
});

setInterval(() => { if (!booted) return; D.forEach((c) => { if (c.type === 'private' && c.ls) c.seen = seenTxt(c.ls); }); const c = cur && cv(); if (c) { const s = $('#st'); if (s && !c.ty) s.textContent = status(c); } }, 30000);
/* ---------- Temps réel ---------- */
function connectSocket() {
  if (SOCK) SOCK.disconnect(); sockUp = false; if (typeof io === 'undefined') return;
  SOCK = io({ withCredentials: true, transports: ['websocket', 'polling'], reconnectionDelay: 500, reconnectionDelayMax: 3000 });
  const cOf = (id) => D.find((c) => c.id === String(id));
  SOCK.on('new_message', async (msg) => {
    let c = cOf(msg.conversationId);
    if (!c) { try { c = mapConv(await api('GET', '/api/conversations/' + msg.conversationId)); } catch { return; } }
    if (msg.expired || msg.type === 'expired') return; const m = mapMsg(msg), mine = m.f === 'me';
    if (c.ms.some((z) => String(z.id) === String(m.id))) return;
    if (mine) { const p = c.ms.find((z) => z.pending && z.f === 'me' && z.type === m.type && (z.x === m.x || m.type !== 'text')); if (p) { adopt(c, p, m.id); return; } }
    c.ms = c.ms.filter((z) => !z.stub); c.ms.push(m); c.ud = null;
    if (cur === c.id && !document.hidden) { appendOne(c, m); if (!mine) api('POST', `/api/conversations/${c.id}/seen`).catch(() => {}); }
    else if (!mine) { c.unread++; if (PD.msgToast !== 0) T(c.name + ' : ' + pv(m).slice(0, 40)); }
    if (!mine) { c.ty = null; if (cur === c.id) typ(false); }
    renderList();
  });
  SOCK.on('message_edited', (r) => { const c = cOf(r.conversationId), m = c && c.ms.find((z) => z.id === String(r.id)); if (m) { m.x = r.content; m.ed = 1; if (cur === c.id) th2(); renderList(); } });
  SOCK.on('message_deleted', (r) => { const c = cOf(r.conversationId), m = c && c.ms.find((z) => z.id === String(r.messageId)); if (m) { m.del = true; m.pin = false; if (cur === c.id) th2(); renderList(); } });
  SOCK.on('message_reaction', (r) => { const c = cOf(r.conversationId), m = c && c.ms.find((z) => z.id === String(r.id)); if (m) { const n = mapMsg({ ...r, sender: null }); m.r = n.r; m.me = n.me; if (cur === c.id) th2(); } });
  SOCK.on('message_pinned', (r) => { const c = cOf(r.conversationId), m = c && c.ms.find((z) => z.id === String(r.messageId)); if (m) { m.pin = !!r.pinned; if (cur === c.id) th2(); } });
  SOCK.on('messages_seen', (r) => { const c = cOf(r.conversationId); if (c && String(r.userId) !== String(MEID)) { c.ms.forEach((m) => { if (m.f === 'me') m.seen = 1; }); if (cur === c.id) th2(); } });
  SOCK.on('user_typing', (r) => { const c = cOf(r.conversationId); if (!c) return; c.ty = r.username; if (cur === c.id) typ(true); clearTimeout(c.tt); c.tt = setTimeout(() => { c.ty = null; if (cur === c.id) typ(false); }, 4000); });
  SOCK.on('user_stopped_typing', (r) => { const c = cOf(r.conversationId); if (c) { c.ty = null; if (cur === c.id) typ(false); } });
  const pres = (on) => (r) => { const u = r.username || Object.keys(UID).find((k) => String(UID[k]) === String(r.userId)); if (!u || u === ME) return; on ? ONL.add(u) : ONL.delete(u); const c = D.find((z) => z.type === 'private' && z.name === u); if (c && !on) { c.ls = r.lastSeen ? +new Date(r.lastSeen) : Date.now(); c.seen = seenTxt(c.ls); } renderList(); if (cur && cv() && cv().name === u) { const s = $('#st'); if (s) s.textContent = status(cv()); } clearTimeout(pres.t); pres.t = setTimeout(() => loadOnline().catch(() => {}), 2000); };
  SOCK.on('user_online', pres(true)); SOCK.on('user_offline', pres(false));
  const refresh = () => loadConvs().then(() => { renderList(); if (cur && !cv()) { cur = null; setCo(false); renderChat(); } }).catch(() => {});
  ['group_created', 'group_updated', 'conversation_deleted', 'removed_from_group'].forEach((ev) => SOCK.on(ev, () => { refresh().then?.(() => {}); if (cur && cv() && ev === 'group_updated') drw && $('#dr').classList.contains('on') && drw(); }));
  SOCK.on('background_changed', (r) => { const c = cOf(r.conversationId); if (c) { applyBg(c, r.background); if (cur === c.id) { $('#tr').setAttribute('style', bgc(c)); bgImg(); } } });
  SOCK.on('account_deleted', kick);
  SOCK.on('notification', () => { clearTimeout(notifT); notifT = setTimeout(() => loadNotifs().then(() => { renderNotif(true); nBadge(); }).catch(() => {}), 400); });
  SOCK.on('post_created', (r) => { if (booted && String(r.author.id) !== String(MEID)) addPost(r); });
  SOCK.on('post_liked', (r) => { document.querySelectorAll(`.post[data-id="${r.postId}"]`).forEach((a) => { const b = a.querySelector('.act[onclick^="lk("]'); if (!b) return; const on = b.classList.contains('on'); b.setAttribute('onclick', `lk(this,${r.likesCount - (on ? 1 : 0)})`); b.querySelector('span').textContent = fm(r.likesCount); }); });
  SOCK.on('post_deleted', (r) => { const a = document.querySelector(`.post[data-id="${r.postId}"]`); if (a) a.remove(); });
  SOCK.on('story_created', () => loadStories().catch(() => {})); SOCK.on('story_deleted', () => loadStories().catch(() => {}));
  SOCK.on('connect', () => { if (cur) SOCK.emit('join_conversation', cur); if (sockUp) resync(); sockUp = true; });
}

/* ---------- Notifications ---------- */
TY.post = ['cam', '#0A9ED9', 'a publié une nouvelle publication']; TY.system = ['bell', '#8B3EF0', 'vous a envoyé une notification']; TY.story[2] = 'a publié une story'; TY.msg = TY.msg || ['chat', '#0057FF', 'vous a envoyé un message'];
['post', 'system'].forEach((k) => { if (NPREF[k] === undefined) NPREF[k] = 1; });
const NMAP = { like: 'like', follow: 'follow', mention: 'mention', message: 'msg', story: 'story', post: 'post', share: 'share', comment: 'comment', system: 'system', group_invite: 'system' };
async function loadNotifs() {
  const l = await api('GET', '/api/notifs'); NT.length = 0;
  l.forEach((n) => { if (n.from) reg(n.from); const t = NMAP[n.type] || 'system'; NT.push({ id: n.id, t, who: n.from ? n.from.username : 'JexChat', ts: +new Date(n.createdAt), u: n.read ? 0 : 1, th: n.thumb || '', q: ['msg', 'mention', 'comment'].includes(t) && n.content ? n.content.slice(0, 120) : (t === 'system' ? n.content : undefined) }); });
}
document.addEventListener('click', (e) => {
  const x = e.target.closest('[data-pg]'); if (!x) return; const a = x.dataset.pg, id = x.dataset.id || (x.closest('.ni') || { dataset: {} }).dataset.id;
  if (a === 'nall') { api('POST', '/api/notifs/state', { all: true, del: true }).catch(() => {}); setTimeout(() => { NT.length = 0; renderNotif(true); nBadge(); }, 0); }
  else if (a === 'nopen' && !e.target.closest('.nm,.go')) { const n = NT.find((z) => z.id === id); if (n && n.u) api('POST', '/api/notifs/state', { ids: [id], read: true }).catch(() => {}); }
  else if (a === 'ntog') { const n = NT.find((z) => z.id === id); if (n) api('POST', '/api/notifs/state', { ids: [id], read: !!n.u }).catch(() => {}); }
  else if (a === 'ndel') api('POST', '/api/notifs/state', { ids: [id], del: true }).catch(() => {});
  else if (a === 'nfol') { const w = x.dataset.w, was = FOL.has(w); if (!UID[w]) return; api('POST', '/api/follow/' + UID[w]).catch((er) => { T(er.message); if (FOL.has(w) !== was) pgAct({ dataset: { pg: 'nfol', w } }); }); }
  else if (a === 'pvl') { const p = pvL[pvI]; if (p && p.id) api('POST', `/api/posts/${p.id}/like`).catch(() => {}); }
}, true);
sset = ((o) => (k, v) => { if (k === 'jx-notif-pref') { api('PUT', '/api/me/profile', { notifPrefs: v }).catch(() => {}); return; } if (k === 'jx-follow' || k === 'jx-profile') return; o(k, v); })(sset);

/* ---------- Profil ---------- */
function tileOf(r) {
  const img = r.mediaType === 'image' && r.mediaUrl, tx = img ? undefined : (r.content || r.description || (r.mediaType === 'video' ? 'Vidéo' : r.mediaType === 'link' ? 'Lien' : 'Publication'));
  const liked = !!r.likedByMe;
  return { id: r.id, u: img || undefined, tx, g: ['#0057FF,#8B3EF0', '#12B886,#0B7285', '#E8590C,#D6336C', '#0A9ED9,#0057FF', '#14131A,#3B2A8F', '#D6336C,#8B3EF0'][col(r.id)], l: (r.likesCount || 0) - (liked ? 1 : 0), k: liked ? 1 : 0, sh: r.sharesCount || 0, a: r.author && r.author.username ? r.author.username : (typeof r.author === 'string' ? r.author : undefined), cap: img && r.content ? r.content.slice(0, 60) : undefined, c: 0, tg: ((r.content || '').toLowerCase().match(/#[\p{L}\p{N}_]+/gu) || []).map((s) => s.slice(1)) };
}
async function loadMine() { const l = await api('GET', '/api/posts/user/' + MEID + '?limit=30'); POSTS.length = 0; l.forEach((r) => POSTS.push(tileOf(r))); }
pList = function () { return pTab === 'posts' ? POSTS : pTab === 'media' ? POSTS.filter((p) => !p.tx) : pTab === 'likes' ? LIKES : SAVED; };
pView = function (j, src) { pvL = src === 'user' ? USERP : src === 'exp' ? XL : pTab === 'posts' || src === 'posts' ? POSTS : src === 'media' ? POSTS.filter((p) => !p.tx) : src === 'likes' ? LIKES : SAVED; pvI = j; pvShow(true); };
document.addEventListener('click', async (e) => {
  const x = e.target.closest('[data-pg="ptab"]'); if (!x) return; const t = x.dataset.t; if (t !== 'likes' && t !== 'saved') return;
  try { const l = await api('GET', t === 'likes' ? '/api/me/likes' : '/api/me/saved'); const a = l.map((r) => tileOf({ ...r, author: r.author })); if (t === 'likes') { LIKES = a.map((p) => ({ ...p, k: 1, l: p.l })); } else SAVED = a; if (pTab === t) $('#pg2').innerHTML = pGrid(); } catch (er) { T(er.message); }
});
pSave = async function () {
  const n = $('#pf-n').value.trim(), h = $('#pf-h').value.trim().replace(/^@/, ''), s = $('#pf-s').value.trim(), er = (m) => { $('#pf-e').textContent = m; };
  if (n.length < 2) return er('Le nom doit contenir au moins 2 caractères.');
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{1,31}$/.test(h)) return er('Nom d’utilisateur : 2 à 32 caractères (lettres, chiffres, _ . -).');
  if (s && !/^https:\/\/[^\s/$.?#][^\s]*\.[^\s]{2,}$/i.test(s)) return er('Le site doit commencer par https://');
  try {
    if (h !== ME) { await api('PUT', '/api/settings/username', { username: h }); delete ACCS[ME]; ME = h; PD.handle = h; }
    await api('PUT', '/api/me/profile', { name: n, bio: $('#pf-b').value.trim(), loc: $('#pf-l').value.trim(), site: s });
    await loadProfile(); CL(); renderProf(); renderAcct(); T('Profil mis à jour');
  } catch (x) { er(x.message); }
};
let pT = 0; pPersist = () => { clearTimeout(pT); pT = setTimeout(() => api('PUT', '/api/me/profile', { cover: PD.cover, priv: !!PD.priv, push: !!PD.push, snd: !!PD.snd }).catch((e) => T(e.message)), 250); };
pShare = () => copy(location.origin + '/lapage/' + encodeURIComponent(ME), 'Lien du profil copié');
{ // photo de profil : redimensionnée, vérifiée côté serveur, enregistrée en base
  const f = $('#pavf'), n = f.cloneNode(true); f.replaceWith(n);
  n.addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return; if (!/^image\//.test(file.type)) return T('Choisissez une image');
    try {
      const bl = await squareAvatar(file);
      const r = await fetch('/api/me/avatar', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/jpeg' }, body: bl }); const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Envoi impossible.');
      PD.av = d.avatarUrl; paintMe(); renderProf(); if (SHT.classList.contains('on')) pEdit(); T('Photo de profil mise à jour');
    } catch (x) { T(x.message); }
  });
}
function squareAvatar(file) { // data: URL (la CSP du site refuse blob: pour les images)
  return new Promise((ok, ko) => { const rd = new FileReader(); rd.onerror = () => ko(new Error('Image illisible.')); rd.onload = () => { const im = new Image(); im.onload = () => { const s = Math.min(im.width, im.height), cn = document.createElement('canvas'); cn.width = cn.height = 320; cn.getContext('2d').drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, 320, 320); cn.toBlob((b) => (b ? ok(b) : ko(new Error('Image illisible.'))), 'image/jpeg', .86); }; im.onerror = () => ko(new Error('Image illisible.')); im.src = rd.result; }; rd.readAsDataURL(file); });
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-pg="pavrm"]')) api('DELETE', '/api/me/avatar').then(() => { AVM[ME] = ''; paintMe(); }).catch((x) => T(x.message)); }, true);

/* ---------- Profil d'un autre utilisateur ---------- */
let USERP = [];
const covOf = (c) => /^p\d$/.test(c) ? `linear-gradient(rgba(0,0,0,.05),rgba(0,0,0,.25)),url('${BGURL(c)}') center/cover` : ((PCV.find((x) => x[0] === c) || PCV[0])[1]);
async function openUser(name) {
  if (name === ME) return go('prof');
  try {
    const p = await api('GET', '/api/profile/u/' + encodeURIComponent(name)); reg({ id: p.id, username: p.username, avatarUrl: p.avatarUrl });
    let l = []; try { l = await api('GET', '/api/posts/user/' + p.id + '?limit=30'); } catch {}
    USERP = l.map(tileOf);
    const priv = p.priv && !p.following && !USERP.length;
    openS(`<div class="pgw prof" style="border:0;min-height:0;background:none"><div class="pcov" style="background:${covOf(p.cover)};border-radius:16px"></div><div class="phead"><div class="pav" style="cursor:default">${av(p.username, col(p.username))}</div><div class="pbtns"><button class="pub2 pbm" data-uf="${esc(p.username)}">${p.following ? 'Abonné' : 'Suivre'}</button><button class="chip" data-um="${esc(p.username)}"><span style="color:var(--t)">Message</span></button></div></div><div class="pinfo"><h1>${esc(p.name)}${p.priv ? `<span class="plk">${PX('lock')}</span>` : ''}</h1><div class="phd">@${esc(p.username)}</div>${p.bio ? `<p class="pbio">${esc(p.bio)}</p>` : ''}<div class="pmeta">${p.loc ? `<span>${PX('pin')}${esc(p.loc)}</span>` : ''}${p.site ? `<a href="${esc(p.site)}" target="_blank" rel="noopener noreferrer">${PX('link')}${esc(p.site.replace(/^https?:\/\//, ''))}</a>` : ''}</div></div><div class="pstats"><div><b>${p.stats.posts}</b><span>Publications</span></div><div><b>${fmtN(p.stats.likes)}</b><span>J’aime</span></div><div><b>${p.stats.followers}</b><span>Abonnés</span></div></div>${priv ? `<div class="empty2"><div class="eic">${PX('lock')}</div><b>Compte privé</b><span>Abonnez-vous pour voir ses publications.</span></div>` : USERP.length ? `<div class="pgrid">${USERP.map((x, i) => tile(x, i, 'user')).join('')}</div>` : `<div class="empty2"><b>Aucune publication</b></div>`}</div>`);
  } catch (e) { T(e.message); }
}
document.addEventListener('click', async (e) => {
  let x;
  if ((x = e.target.closest('[data-uf]'))) { e.stopImmediatePropagation(); const n = x.dataset.uf; try { const r = await api('POST', '/api/follow/' + UID[n]); r.following ? FOL.add(n) : FOL.delete(n); x.textContent = r.following ? 'Abonné' : 'Suivre'; } catch (er) { T(er.message); } return; }
  if ((x = e.target.closest('[data-um]'))) { e.stopImmediatePropagation(); CL(); dm(x.dataset.um); return; }
  const h = e.target.closest('.post .ph, .shared .ph');
  if (h && !e.target.closest('.more,.pop') && h.querySelector('b')) { e.stopImmediatePropagation(); e.preventDefault(); return openUser(h.querySelector('b').textContent.trim()); }
  if ((x = e.target.closest('.xac, .xr')) && !e.target.closest('.nf,button.go')) { const b = x.querySelector('b'); if (b) { e.stopImmediatePropagation(); e.preventDefault(); openUser(b.textContent.trim()); } }
}, true);
/* ---------- Compte ---------- */
async function loadSessions() {
  const l = await api('GET', '/api/sessions');
  ACC.dev = l.map((s) => ({ id: s.id, n: (s.deviceInfo || 'Appareil').replace(/\s*\(.*?\)\s*/, ' · ').slice(0, 50) || 'Appareil', loc: s.ipAddress || '—', cur: s.current, t: s.current ? 'Maintenant' : ago(s.lastActive) }));
}
acDev = async function () { try { await loadSessions(); } catch (e) { T(e.message); } openS(`<h3>Appareils connectés</h3><div class="flist">${ACC.dev.map((d) => `<div class="fr"><span class="dvi">${PX('dev')}</span><div style="flex:1;min-width:0"><b>${esc(d.n)}</b><br><small style="color:var(--sub)">${esc(d.loc)} · ${esc(d.t)}</small></div>${d.cur ? '<span class="chip ok" style="padding:4px 10px"><span>Actuel</span></span>' : `<button class="go" data-ac="devout" data-id="${d.id}">Déconnecter</button>`}</div>`).join('')}</div>${ACC.dev.length > 1 ? '<button class="arow dg" data-ac="devall">Déconnecter tous les autres appareils</button>' : ''}`); renderAcct(); };
document.addEventListener('click', async (e) => {
  const x = e.target.closest('[data-ac]'); if (!x) return; const a = x.dataset.ac, st = () => { e.stopImmediatePropagation(); e.preventDefault(); };
  try {
    if (a === 'devout') { st(); await api('DELETE', '/api/sessions/' + x.dataset.id); T('Appareil déconnecté'); return acDev(); }
    if (a === 'devall') { st(); for (const d of ACC.dev.filter((z) => !z.cur)) await api('DELETE', '/api/sessions/' + d.id); T('Autres appareils déconnectés'); return acDev(); }
    if (a === 'email2') { st(); const n = $('#ac-n').value.trim().toLowerCase(), o = $('#ac-o').value, er = (m) => { $('#ac-e').textContent = m; }; if (n && !EMRX.test(n)) return er('Adresse e-mail invalide.'); if (!o) return er('Entrez votre mot de passe.'); try { await api('PUT', '/api/me/profile', { email: n, password: o }); } catch (z) { return er(z.message); } ACCS[ME].email = n; sset('jx-accounts', ACCS); CL(); renderAcct(); return T(n ? 'Adresse e-mail enregistrée' : 'Adresse e-mail retirée'); }
    if (a === 'pwd2') { st(); const o = $('#ac-o').value, n = $('#ac-n').value, c = $('#ac-c').value, er = (m) => { $('#ac-e').textContent = m; }; if (n.length < 6) return er('6 caractères minimum.'); if (n === o) return er('Le nouveau mot de passe doit être différent.'); if (n !== c) return er('Les mots de passe ne correspondent pas.'); try { await api('PUT', '/api/settings/password', { currentPassword: o, newPassword: n }); } catch (z) { return er(z.message); } CL(); return T('Mot de passe modifié'); }
    if (a === 'phone2') { st(); const v = $('#ac-t').value.trim(); try { await api('PUT', '/api/me/profile', { phone: v }); } catch (z) { return ($('#ac-e').textContent = z.message); } ACC.phone = v; CL(); renderAcct(); return T(v ? 'Numéro enregistré' : 'Numéro retiré'); }
    if (a === 'msg2') { st(); await api('PUT', '/api/me/profile', { msg: x.dataset.v }); ACC.msg = x.dataset.v; CL(); return renderAcct(); }
    if (a === 'del') { st(); return openS(`<h3 style="color:#E5334B">Supprimer le compte</h3><p style="margin:0;color:var(--sub)">Toutes vos données seront effacées. Cette action est définitive. Entrez votre mot de passe et tapez <b>SUPPRIMER</b> pour confirmer.</p><input id="ac-pw" type="password" autocomplete="current-password" placeholder="Mot de passe" aria-label="Mot de passe"><input id="ac-d" autocomplete="off" aria-label="Confirmation"><p class="er" id="ac-e" role="alert"></p><div class="rw"><button class="chip" data-x>Annuler</button><button class="pub2 dgb" data-ac="del3" id="ac-db" disabled style="width:auto">Supprimer</button></div>`); }
    if (a === 'del3') { st(); try { await api('DELETE', '/api/settings/account', { password: $('#ac-pw').value }); } catch (z) { return ($('#ac-e').textContent = z.message); } CL(); delete ACCS[ME]; sset('jx-accounts', ACCS); kick(); return; }
    if (a === 'export') { st(); const p = await api('GET', '/api/me/profile'); const d = { profil: { nom: p.name, identifiant: p.username, bio: p.bio, lieu: p.loc, site: p.site }, compte: { pseudo: p.username, email: p.email || null, cree: p.createdAt, deuxEtapes: p.twofa, prive: p.priv }, statistiques: p.stats, exporteLe: new Date().toISOString() }; const l = document.createElement('a'); l.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(d, null, 2)); l.download = 'mes-donnees-jexchat.json'; document.body.append(l); l.click(); l.remove(); return T('Données exportées'); }
    if (a === 'dev') { st(); return acDev(); }
  } catch (z) { T(z.message); }
}, true);
document.addEventListener('change', (e) => {
  const t = e.target, k = t.dataset && t.dataset.acT; if (k === undefined) return;
  const v = t.checked, rb = () => { t.checked = !v; };
  if (k === 'online') api('PUT', '/api/settings', { privacy: { showOnlineStatus: v } }).catch((z) => { rb(); T(z.message); });
  else if (k === 'priv') { /* enregistré via pPersist */ }
  else api('PUT', '/api/me/profile', { [k]: v }).catch((z) => { rb(); T(z.message); });
}, true);
document.addEventListener('click', (e) => { if (e.target.closest('[data-jc="enter"],[data-jc="zone"]')) { e.stopImmediatePropagation(); location.href = '/city'; } }, true);

/* ---------- Explorer ---------- */
const CATS = { Nature: /nature|montagne|forêt|foret|arbre|paysage|mer|plage|ciel/i, Animaux: /animaux|animal|chat|chien|oiseau/i, Fleurs: /fleur|rose|tulipe|jardin/i };
function xOf(r) { const t = tileOf(r), s = (r.content || '') + ' ' + (r.description || ''); t.cat = Object.keys(CATS).find((c) => CATS[c].test(s)) || 'Pour vous'; t.a = r.author.username; reg(r.author); return t; }
async function loadExplore() {
  const [ac, tr, ps] = await Promise.all([api('GET', '/api/explore/accounts'), api('GET', '/api/explore/trends'), api('GET', '/api/posts?limit=30')]);
  ac.forEach((u) => { reg(u); XB[u.username] = u.bio || ''; if (u.following) FOL.add(u.username); });
  XT.length = 0; tr.forEach((t) => XT.push([t.tag, t.n])); XP.length = 0; ps.forEach((r) => XP.push(xOf(r)));
}
let xs = 0;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'xq') return; clearTimeout(xs); const v = e.target.value.replace(/^[#@]/, '').trim(); if (v.length < 2) return;
  xs = setTimeout(async () => { try { const [u, p] = await Promise.all([api('GET', '/api/users/search?q=' + encodeURIComponent(v)), api('GET', '/api/posts/search?q=' + encodeURIComponent(v))]); u.forEach((z) => { reg(z); if (!(z.username in XB)) XB[z.username] = ''; }); p.forEach((r) => { if (!XP.some((z) => z.id === r.id)) XP.push(xOf(r)); }); if (!$('#vx').hidden && xQ.replace(/^[#@]/, '').trim() === v) { const had = document.activeElement && document.activeElement.id === 'xq'; renderExp(); if (had) { const i = $('#xq'); i.focus(); i.setSelectionRange(xQ.length, xQ.length); } } } catch {} }, 350);
});
let lastV = 'home';
const _go = go;
go = function (v, id) { if (lastV === 'notif' && v !== 'notif' && booted) { api('POST', '/api/notifs/state', { all: true, read: true }).catch(() => {}); NT.length = 0; nBadge(); } lastV = v; _go(v, id); document.querySelectorAll('.shell>main').forEach((m) => { m.scrollTop = 0; }); if (!booted) return; if (v === 'exp' && !go.xe) { go.xe = 1; loadExplore().then(() => { if (!$('#vx').hidden) renderExp(); }).catch(() => { go.xe = 0; }); } if (v === 'prof') loadProfile().then(() => { renderProf(); }).catch(() => {}); if (v === 'notif') loadNotifs().then(() => renderNotif(true)).catch(() => {}); if (v === 'home') loadOnline().catch(() => {}); };

/* ---------- JexAi, notifications push, installation ---------- */
const jhist = [];
jask = async function (qy) {
  if (!qy.trim()) return; jadd('u', qy); jhist.push({ role: 'user', content: qy.slice(0, 4000) }); if (jhist.length > 20) jhist.splice(0, jhist.length - 20);
  const t = document.createElement('div'); t.className = 'jb a jt'; t.innerHTML = '<i></i><i></i><i></i>'; jm.append(t); jm.scrollTop = jm.scrollHeight;
  try { const r = await api('POST', '/api/jexai', { messages: jhist }); t.remove(); jadd('a', r.reply || '…'); jhist.push({ role: 'assistant', content: r.reply || '' }); }
  catch (e) { t.remove(); jhist.pop(); jadd('a', e.message); }
};
const _jr = jreset; jreset = function () { jhist.length = 0; _jr(); };
let fcm = null;
async function pushSetup(ask) {
  try {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || typeof firebase === 'undefined') return false;
    const cfg = await api('GET', '/api/firebase-config'); if (!cfg.apiKey || !cfg.vapidKey) return false;
    if (!firebase.apps.length) firebase.initializeApp(cfg); if (firebase.messaging.isSupported && !firebase.messaging.isSupported()) return false;
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js'); await navigator.serviceWorker.ready;
    if (Notification.permission === 'default' && ask) await Notification.requestPermission();
    if (Notification.permission !== 'granted') return false;
    const tk = await firebase.messaging().getToken({ vapidKey: cfg.vapidKey, serviceWorkerRegistration: reg });
    if (tk && tk !== fcm) { await api('POST', '/api/fcm/token', { token: tk }); fcm = tk; } return true;
  } catch { return false; }
}
document.addEventListener('click', async (e) => {
  const x = e.target.closest('[data-pa]'); if (!x || x.dataset.pa !== 'y') return;
  const ok = await pushSetup(true); T(ok ? 'Notifications activées' : 'Notifications indisponibles ou refusées sur cet appareil.');
}, true);
let ipr = null; addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ipr = e; });
document.addEventListener('click', (e) => { if (!e.target.closest('#inst')) return; e.stopImmediatePropagation(); e.preventDefault(); if (ipr) { ipr.prompt(); ipr = null; } else T('Utilisez « Ajouter à l’écran d’accueil » dans le menu de votre navigateur.'); }, true);
addEventListener('online', () => { if (booted) loadConvs().then(renderList).catch(() => {}); });

/* ---------- Démarrage ---------- */
(async () => {
  let me; try { me = await api('GET', '/api/auth/me'); } catch { return showAuth(); }
  ME = me.username; MEID = me.id; ACCS[ME] = ACCS[ME] || { name: ME, handle: ME, email: '', created: (me.createdAt || '').slice(0, 10) }; setSess({ u: ME }, true);
  try { await loadProfile(); } catch (e) { PD.name = PD.name || ME; PD.handle = ME; AVM[ME] = me.avatarUrl || ''; PD.av = me.avatarUrl || null; }
  $('#auth').hidden = true; booted = true;
  try { await bootData(); } catch {}
  try { connectSocket(); renderAcct(); pushSetup(false); } catch {}
  if (/^\/messages/.test(location.pathname)) go('msg'); else if (/^\/settings/.test(location.pathname)) go('acct'); else if (/^\/lapage\//.test(location.pathname)) go('prof');
})();
})();
