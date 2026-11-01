/* JexChat — éditeur de story (plein écran, aperçu 9:16 en direct) et rendu des mises en page.
   Même format `layout` que le serveur et l'ancienne interface : les stories restent compatibles partout. */
(() => {
'use strict';
const BGS = ['linear-gradient(160deg,#22d35b,#0a9fe8)', 'linear-gradient(160deg,#f9ce34,#ee2a7b,#6228d7)', 'linear-gradient(160deg,#ff8a00,#e52e71)', 'linear-gradient(160deg,#7f00ff,#e100ff)', 'linear-gradient(160deg,#141e30,#243b55)', 'linear-gradient(160deg,#11998e,#38ef7d)', 'linear-gradient(160deg,#fc466b,#3f5efb)', '#000'];
const FONTS = { inter: "'Inter',system-ui,sans-serif", fraunces: "'Fraunces',Georgia,serif", serif: "Georgia,'Times New Roman',serif", mono: 'ui-monospace,Menlo,Consolas,monospace', impact: "Impact,'Arial Black',sans-serif", hand: "'Comic Sans MS','Marker Felt',cursive" };
const FL = { inter: 'Moderne', fraunces: 'Élégante', serif: 'Classique', mono: 'Machine', impact: 'Impact', hand: 'Manuscrite' };
const COLORS = ['#ffffff', '#14131a', '#ffd43b', '#ff6b6b', '#ff922b', '#69db7c', '#4dabf7', '#0057ff', '#8b3ef0', '#f783ac'];
const FX = [['none', 'Aucun'], ['shadow', 'Ombre'], ['outline', 'Contour'], ['neon', 'Néon']];
const YT = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/|v\/))([\w-]{11})/;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const u = (n) => `calc(var(--u)*${n})`;
const rgba = (h, a) => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

/* ---------- Rendu d'un élément (identique à l'ancienne interface) ---------- */
function apply(n, e) {
  const s = n.style;
  s.left = e.x + '%'; s.top = e.y + '%'; s.width = e.w + '%';
  s.transform = `translate(-50%,-50%) rotate(${e.rot}deg) scale(${e.sc})`;
  s.opacity = e.op; s.zIndex = e.z; s.borderRadius = u(e.br);
  const bordered = e.bw > 0 && e.bs !== 'none';
  s.border = bordered ? `${u(e.bw)} ${e.bs} ${e.bc}` : '0 none';
  s.background = e.bga > 0 ? rgba(e.bg, e.bga) : 'transparent';
  const i = e.sh / 100, box = bordered || e.bga > 0 || e.kind === 'media';
  s.boxShadow = box && i > 0 ? `0 ${u(0.6 * i)} ${u(2.4 * i)} rgba(0,0,0,${(0.2 + 0.65 * i).toFixed(2)})` : 'none';
  if (e.kind === 'media') { s.height = e.h + '%'; if (n.firstChild && n.firstChild.style) n.firstChild.style.objectFit = e.fit; return; }
  s.height = ''; s.fontFamily = FONTS[e.font] || FONTS.inter; s.fontSize = u(e.size); s.color = e.color; s.fontWeight = e.weight;
  s.fontStyle = e.italic ? 'italic' : 'normal'; s.textDecoration = e.ul ? 'underline' : 'none'; s.textAlign = e.align;
  s.letterSpacing = u(e.ls); s.lineHeight = e.lh; s.webkitTextStroke = ''; s.paintOrder = '';
  if (e.fx === 'outline') { s.webkitTextStroke = `${u(0.25)} ${e.color}`; s.color = 'transparent'; }
  const fx = e.fx === 'shadow' ? `${u(0.3)} ${u(0.3)} ${u(0.8)} rgba(0,0,0,.85)` : e.fx === 'neon' ? `0 0 ${u(1)} ${e.color},0 0 ${u(2.4)} ${e.color},0 0 ${u(4.5)} ${e.color}` : e.fx === 'glitch' ? `${u(-0.35)} 0 #ff2d55,${u(0.35)} 0 #00e5ff` : '';
  s.textShadow = fx || (!box && i > 0 ? `0 ${u(0.4 * i)} ${u(1.8 * i)} rgba(0,0,0,${(0.25 + 0.7 * i).toFixed(2)})` : 'none');
}
const def = (kind) => {
  const c = { kind, x: 50, y: 50, z: 1, w: kind === 'text' ? 80 : 100, rot: 0, sc: 1, op: 1, bw: 0, bc: '#ffffff', bs: 'solid', br: 0, sh: 0, bg: '#000000', bga: 0 };
  return kind === 'media' ? { ...c, h: 100, fit: 'cover' } : { ...c, text: '', font: 'inter', size: 8, color: '#ffffff', weight: 700, italic: false, ul: false, fx: 'shadow', align: 'center', ls: 0, lh: 1.3 };
};
function fail(el) { const d = document.createElement('div'); d.className = 'se-fail'; d.textContent = 'Média indisponible'; el.replaceWith(d); }
function mediaEl(type, url) {
  let m;
  const frame = (src) => { const f = document.createElement('iframe'); f.allow = 'autoplay; encrypted-media; picture-in-picture'; f.setAttribute('frameborder', '0'); f.referrerPolicy = 'strict-origin-when-cross-origin'; f.src = src; return f; };
  if (type === 'video') {
    if ((m = url.match(YT))) return frame(`https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1&mute=1&playsinline=1&rel=0&controls=0&loop=1&playlist=${m[1]}`);
    if ((m = url.match(/vimeo\.com\/(\d+)/))) return frame(`https://player.vimeo.com/video/${m[1]}?autoplay=1&muted=1&loop=1&playsinline=1`);
    const v = document.createElement('video'); v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'metadata'; v.onerror = () => fail(v); v.src = url; return v;
  }
  if (type === 'audio') { const w = document.createElement('div'); w.className = 'se-fail'; w.textContent = '♪'; const a = document.createElement('audio'); a.src = url; a.autoplay = true; a.loop = true; w.appendChild(a); return w; }
  const i = new Image(); i.alt = ''; i.decoding = 'async'; i.referrerPolicy = 'no-referrer'; i.onerror = () => fail(i); i.src = url; return i;
}
// Construit les nœuds d'une scène à partir d'un layout (utilisé par l'éditeur et par le lecteur de stories).
function build(stage, layout, story) {
  stage.textContent = '';
  stage.style.background = Number.isInteger(layout.bgi) && BGS[layout.bgi] ? BGS[layout.bgi] : '#000';
  const nodes = [];
  (layout.elements || []).forEach((e) => {
    const n = document.createElement('div'); n.className = 'se-el';
    if (e.kind === 'media') { if (!story || !story.mediaUrl) return; n.appendChild(mediaEl(story.mediaType, story.mediaUrl)); } else n.textContent = e.text || '';
    apply(n, e); stage.appendChild(n); nodes.push(n);
  });
  return nodes;
}

/* ---------- Styles ---------- */
const css = document.createElement('style'); css.id = 'se-css';
css.textContent = `
.se-fit{container-type:size;display:grid;place-items:center;min-height:0;position:relative}
.se-stage{position:relative;overflow:hidden;width:min(100cqw,calc(100cqh*9/16));aspect-ratio:9/16;container-type:inline-size;--u:1cqw;border-radius:20px;touch-action:none;-webkit-user-select:none;user-select:none;background:#000}
.se-stage iframe,.se-stage video{pointer-events:none}
.se-el{position:absolute;box-sizing:border-box;cursor:grab;touch-action:none;white-space:pre-wrap;overflow-wrap:anywhere;transform-origin:center}
.se-el>img,.se-el>video,.se-el>iframe{width:100%;height:100%;display:block;border:0}
.se-fail{width:100%;height:100%;display:grid;place-items:center;color:#fff;background:rgba(0,0,0,.35);font:600 4cqw Inter,sans-serif;text-align:center}
.se.ed .se-el.on::after{content:"";position:absolute;inset:-6px;border:2px dashed #fff;border-radius:8px;box-shadow:0 0 0 1px rgba(0,0,0,.4),inset 0 0 0 1px rgba(0,0,0,.4);pointer-events:none}
.se-empty{position:absolute;inset:0;display:grid;place-content:center;gap:6px;text-align:center;color:rgba(255,255,255,.92);font:600 7cqw Fraunces,serif;pointer-events:none;padding:0 10%}
.se-empty small{font:500 3.6cqw Inter,sans-serif;opacity:.85}
.se{position:fixed;inset:0;z-index:18;height:100dvh;display:flex;flex-direction:column;background:var(--bg);color:var(--t);animation:fi .25s}
.se *{box-sizing:border-box}.se button{cursor:pointer}
.se-h{display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top,0px)) 14px 6px}
.se-h b{flex:1;text-align:center;font:600 19px Fraunces,serif}
.se-x{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:var(--chip);color:var(--t);flex:none}
.se-pub{min-width:96px;padding:10px 18px;border-radius:14px;background:var(--g);color:#fff;font-weight:600;box-shadow:0 8px 20px rgba(0,87,255,.3);flex:none}
.se-pub[disabled]{opacity:.6;cursor:default}
.se-m{flex:1;padding:4px 0 8px}
.se-m .se-stage{box-shadow:var(--shh)}
.se-err{min-height:0;margin:0;padding:0 16px;text-align:center;color:#E5334B;font-size:13.5px;font-weight:500}
.se-err:not(:empty){padding-bottom:6px}
.se-pane,.se-tabs{width:100%;max-width:560px;margin:0 auto}
.se-pane{padding:6px 14px 10px;max-height:40dvh;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:8px}
.se-tabs{display:flex;gap:6px;padding:6px 10px calc(8px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--ln);background:var(--s)}
.se-tabs button{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 4px;border-radius:14px;font-size:12px;font-weight:600;color:var(--sub);transition:.2s}
.se-tabs button.on{background:var(--chip);color:var(--b)}
.se-tabs .aa{font:700 19px/22px Fraunces,serif}
.se-l{margin:0;font-size:12.5px;font-weight:600;color:var(--sub)}
.se-s{margin:0;font-size:13px;color:var(--sub);line-height:1.45}
.se-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.se-c{padding:8px 14px;border-radius:99px;background:var(--chip);color:var(--t);font-size:13.5px;font-weight:500;transition:.2s}
.se-c.on{background:var(--g);color:#fff}.se-c.dg{color:#E5334B}
.se-c.ic{padding:8px 12px;display:grid;place-items:center}
.se-add{width:100%;padding:14px;border-radius:16px;background:var(--g);color:#fff;font-weight:600;font-size:15.5px;box-shadow:0 8px 20px rgba(0,87,255,.3)}
.se-sw{display:flex;gap:10px;flex-wrap:wrap}
.se-bgb,.se-col{border-radius:50%;border:3px solid var(--s);box-shadow:0 0 0 1.5px var(--ln);flex:none}
.se-bgb{width:44px;height:44px}.se-col{width:32px;height:32px;border-width:2px}
.se-bgb.on,.se-col.on{box-shadow:0 0 0 3px var(--b)}
.se-colp{position:relative;width:32px;height:32px;border-radius:50%;background:conic-gradient(#f66,#fd4,#6d7,#4af,#a5f,#f66);border:2px solid var(--s);box-shadow:0 0 0 1.5px var(--ln);overflow:hidden;flex:none}
.se-colp input{position:absolute;inset:-8px;width:50px;height:50px;opacity:0;cursor:pointer}
.se-fonts{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}.se-fonts::-webkit-scrollbar{display:none}.se-fonts button{flex:none;font-size:15px}
.se-top{display:flex;gap:8px;align-items:stretch}.se-top .se-in{flex:1;min-width:0;padding:10px 12px}
.se-side{display:flex;flex-direction:column;gap:6px;flex:none}.se-side button{width:44px;flex:1;border-radius:12px;background:var(--chip);color:var(--t);display:grid;place-items:center}.se-side .dg{color:#E5334B}
.se-go{flex:none;padding:0 18px;border-radius:14px}
.se-scroll{display:flex;gap:8px;align-items:center;overflow-x:auto;scrollbar-width:none;padding:3px 2px;flex:none}.se-scroll::-webkit-scrollbar{display:none}.se-scroll>*{flex:none}
.se-in{width:100%;border-radius:14px;border:1.5px solid var(--ln);background:var(--s);color:var(--t);padding:12px 14px;font:inherit;font-size:16px;resize:none;outline:0}
.se-in:focus{border-color:var(--b)}
.se-g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:none}.se-g2 label{display:flex;flex-direction:column;gap:0;font-size:12.5px;font-weight:600;color:var(--sub)}
.se input[type=range]{width:100%;height:24px;accent-color:#0057FF;margin:0}
@media(max-height:620px){.se-pane{max-height:46dvh}}
.se-open .bn,.se-open .ai,.se-open .aip{display:none!important}
.sv .pg{margin:0;padding:0}
`;
document.head.appendChild(css);

const SVG = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  x: '<path d="M6 6l12 12M18 6L6 18"/>', bg: '<path d="M12 3c4 5 7 8 7 11a7 7 0 0 1-14 0c0-3 3-6 7-11z"/>',
  img: '<rect x="3.5" y="4.5" width="17" height="15" rx="3.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/>',
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.8 1.8M9.5 2.5h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
  l: '<path d="M4 6h16M4 12h10M4 18h14"/>', c: '<path d="M4 6h16M7 12h10M5 18h14"/>', r: '<path d="M4 6h16M10 12h10M6 18h14"/>',
};

/* ---------- Éditeur ---------- */
function open(opt) {
  if (document.getElementById('se')) return;
  opt = opt || {};
  const S = { els: [], nodes: [], sel: -1, bgi: 0, dur: 7, tab: 'texte', mtype: 'image', url: '', busy: false };
  const root = document.createElement('div');
  root.id = 'se'; root.className = 'se ed'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Créer une story');
  root.innerHTML = `<div class="se-h"><button class="se-x" data-se="close" aria-label="Fermer">${SVG(IC.x)}</button><b>Nouvelle story</b><button class="se-pub" data-se="pub">Publier</button></div><div class="se-m se-fit"><div class="se-stage" id="se-stage"></div></div><p class="se-err" id="se-err" role="alert"></p><div class="se-pane" id="se-pane"></div><nav class="se-tabs" id="se-tabs" aria-label="Outils"></nav>`;
  document.body.appendChild(root);
  const prevOv = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden'; document.documentElement.classList.add('se-open');
  const stage = root.querySelector('#se-stage'), paneEl = root.querySelector('#se-pane'), tabsEl = root.querySelector('#se-tabs'), errEl = root.querySelector('#se-err');
  const cur = () => S.els[S.sel];
  const err = (m) => { errEl.textContent = m || ''; };
  const T = [['fond', 'Fond', SVG(IC.bg)], ['texte', 'Texte', '<span class="aa">Aa</span>'], ['media', 'Média', SVG(IC.img)], ['duree', 'Durée', SVG(IC.clock)]];
  const renderTabs = () => { tabsEl.innerHTML = T.map((t) => `<button data-se="tab" data-v="${t[0]}" class="${S.tab === t[0] ? 'on' : ''}" aria-pressed="${S.tab === t[0]}">${t[2]}<span>${t[1]}</span></button>`).join(''); };
  const mIdx = () => S.els.findIndex((e) => e.kind === 'media');
  const rebuild = () => {
    S.els.forEach((e, k) => { e.z = k + 1; });
    S.nodes = build(stage, { bgi: S.bgi, elements: S.els }, { mediaType: S.mtype, mediaUrl: S.url });
    S.nodes.forEach((n, k) => n.classList.toggle('on', k === S.sel));
    if (!S.els.length) stage.insertAdjacentHTML('beforeend', '<div class="se-empty">Votre story commence ici<small>Ajoutez un texte ou une photo</small></div>');
  };
  const sw = (a, b, l, v, extra) => `<label>${l}<input type="range" data-r="${v}" min="${a}" max="${b}" ${extra}></label>`;
  function paneHtml() {
    const e = cur();
    if (S.tab === 'fond') return `<p class="se-l">Choisissez un fond</p><div class="se-sw">${BGS.map((b, i) => `<button class="se-bgb ${i === S.bgi ? 'on' : ''}" data-se="bg" data-v="${i}" style="background:${b}" aria-label="Fond ${i + 1}" aria-pressed="${i === S.bgi}"></button>`).join('')}</div>`;
    if (S.tab === 'duree') return `<p class="se-l">Durée d’affichage</p><div class="se-row">${[5, 7, 10, 15].map((d) => `<button class="se-c ${S.dur === d ? 'on' : ''}" data-se="dur" data-v="${d}">${d} s</button>`).join('')}</div><p class="se-s">C’est le temps pendant lequel chaque personne voit votre story. Elle reste visible 24 h.</p>`;
    if (S.tab === 'texte') {
      if (!e || e.kind !== 'text') return `<button class="se-add" data-se="addt">+ Ajouter un texte</button><p class="se-s">${S.els.some((x) => x.kind === 'text') ? 'Touchez un texte sur la story pour le modifier. Glissez-le pour le déplacer.' : 'Écrivez votre message, puis glissez-le où vous voulez.'}</p>`;
      return `<div class="se-top"><textarea class="se-in" id="se-t" rows="2" maxlength="200" placeholder="Votre texte" aria-label="Texte">${esc(e.text)}</textarea><div class="se-side"><button data-se="addt" aria-label="Ajouter un autre texte" title="Ajouter un autre texte">${SVG(IC.plus)}</button><button class="dg" data-se="del" aria-label="Supprimer ce texte" title="Supprimer ce texte">${SVG(IC.trash)}</button></div></div>
<div class="se-scroll" role="group" aria-label="Police">${Object.keys(FONTS).map((f) => `<button class="se-c ${e.font === f ? 'on' : ''}" data-se="font" data-v="${f}" style="font-family:${FONTS[f]}">${FL[f]}</button>`).join('')}</div>
<div class="se-scroll" role="group" aria-label="Couleur">${COLORS.map((c) => `<button class="se-col ${e.color === c ? 'on' : ''}" data-se="col" data-v="${c}" style="background:${c}" aria-label="Couleur ${c}"></button>`).join('')}<label class="se-colp" aria-label="Autre couleur"><input type="color" id="se-cp" value="${e.color}"></label></div>
<div class="se-scroll">${['l', 'c', 'r'].map((a, i) => `<button class="se-c ic ${e.align === ['left', 'center', 'right'][i] ? 'on' : ''}" data-se="al" data-v="${['left', 'center', 'right'][i]}" aria-label="Alignement ${['gauche', 'centre', 'droite'][i]}">${SVG(IC[a])}</button>`).join('')}${FX.map((f) => `<button class="se-c ${e.fx === f[0] ? 'on' : ''}" data-se="fx" data-v="${f[0]}">${f[1]}</button>`).join('')}<button class="se-c ${e.bga > 0 ? 'on' : ''}" data-se="box">Encadré</button></div>
<div class="se-g2">${sw(2, 30, 'Taille', 'size', 'step="0.5" value="' + e.size + '"')}${sw(-45, 45, 'Rotation', 'rot', 'step="1" value="' + e.rot + '"')}</div>`;
    }
    const mi = mIdx(), m = S.els[mi];
    return `<div class="se-row" role="group" aria-label="Type de média"><button class="se-c ${S.mtype === 'image' ? 'on' : ''}" data-se="mt" data-v="image">Photo</button><button class="se-c ${S.mtype === 'video' ? 'on' : ''}" data-se="mt" data-v="video">Vidéo</button></div>
<div class="se-top"><input class="se-in" id="se-u" type="url" inputmode="url" autocomplete="off" placeholder="https://… lien de la ${S.mtype === 'video' ? 'vidéo' : 'photo'}" value="${esc(S.draft !== undefined ? S.draft : S.url)}" aria-label="Lien du média"><button class="se-c on se-go" data-se="addm">${m ? 'Remplacer' : 'Ajouter'}</button></div>
${m ? `<div class="se-scroll"><button class="se-c ${m.fit === 'cover' ? 'on' : ''}" data-se="fit" data-v="cover">Remplir</button><button class="se-c ${m.fit === 'contain' ? 'on' : ''}" data-se="fit" data-v="contain">Contenir</button><button class="se-c dg" data-se="rmm">Retirer</button></div><div class="se-g2">${sw(0.3, 3, 'Taille', 'sc', 'step="0.05" value="' + m.sc + '"')}</div>` : `<p class="se-s">${S.mtype === 'video' ? 'Lien YouTube, Vimeo ou fichier .mp4 (https).' : 'Collez le lien (https) d’une photo.'}</p>`}`;
  }
  const renderPane = () => { paneEl.innerHTML = paneHtml(); };
  function select(i) {
    S.sel = i; S.nodes.forEach((n, k) => n.classList.toggle('on', k === i));
    const e = cur(); if (e) { S.tab = e.kind === 'text' ? 'texte' : 'media'; renderTabs(); }
    renderPane();
  }
  function addText() {
    if (S.els.length >= 12) return err('12 éléments au maximum.');
    err(''); const n = S.els.filter((x) => x.kind === 'text').length;
    S.els.push({ ...def('text'), text: '', y: clamp(34 + n * 14, 10, 90) });
    S.sel = S.els.length - 1; S.tab = 'texte'; rebuild(); renderTabs(); renderPane();
    const ta = paneEl.querySelector('#se-t'); if (ta) ta.focus();
  }
  function addMedia() {
    const v = (paneEl.querySelector('#se-u').value || '').trim();
    try { if (new URL(v).protocol !== 'https:') throw 0; } catch { return err('Entrez un lien HTTPS valide.'); }
    err(''); S.url = v; S.draft = undefined; const mi = mIdx();
    if (mi < 0) { if (S.els.length >= 12) return err('12 éléments au maximum.'); S.els.unshift(def('media')); }
    S.sel = 0; S.tab = 'media'; rebuild(); renderTabs(); renderPane();
  }
  function remove() {
    const e = cur(); if (!e) return; S.els.splice(S.sel, 1); if (e.kind === 'media') S.url = '';
    S.sel = -1; rebuild(); renderPane();
  }
  const touch = () => { const e = cur(); if (e && S.nodes[S.sel]) apply(S.nodes[S.sel], e); };
  function close(force) {
    const go = () => { document.removeEventListener('keydown', onKey); document.documentElement.style.overflow = prevOv; document.documentElement.classList.remove('se-open'); root.remove(); };
    if (!force && S.els.length && typeof ask === 'function') return ask('Abandonner cette story ?', 'Abandonner', go);
    go();
  }
  const onKey = (ev) => { if (ev.key === 'Escape' && !document.querySelector('.ov.on')) close(); };
  document.addEventListener('keydown', onKey);
  async function publish() {
    const texts = S.els.filter((e) => e.kind === 'text' && e.text.trim()), hasM = mIdx() > -1;
    if (!texts.length && !hasM) return err('Ajoutez un texte ou une photo pour publier.');
    err('');
    const elements = S.els.filter((e) => e.kind === 'media' || e.text.trim()).map((e, k) => ({ ...e, z: k + 1 }));
    const body = { mediaType: hasM ? S.mtype : 'text', mediaUrl: hasM ? S.url : '', content: texts.map((e) => e.text.trim()).join(' ').slice(0, 300), layout: { v: 1, bgi: S.bgi, dur: S.dur, elements } };
    const b = root.querySelector('.se-pub'); b.disabled = true; b.textContent = 'Publication…';
    try { await opt.post(body); close(true); if (opt.done) opt.done(); }
    catch (x) { err(x.message || 'Publication impossible.'); b.disabled = false; b.textContent = 'Publier'; }
  }

  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-se]'); if (!b) return; const a = b.dataset.se, v = b.dataset.v, e = cur();
    if (a === 'close') return close();
    if (a === 'pub') return publish();
    if (a === 'tab') { S.tab = v; renderTabs(); return renderPane(); }
    if (a === 'bg') { S.bgi = +v; stage.style.background = BGS[S.bgi]; return renderPane(); }
    if (a === 'dur') { S.dur = +v; return renderPane(); }
    if (a === 'addt') return addText();
    if (a === 'addm') return addMedia();
    if (a === 'rmm') { S.sel = mIdx(); return remove(); }
    if (a === 'del') return remove();
    if (a === 'mt') { S.mtype = v; return renderPane(); }
    if (!e) return;
    if (a === 'font') e.font = v; else if (a === 'col') e.color = v; else if (a === 'al') e.align = v; else if (a === 'fx') e.fx = v;
    else if (a === 'box') { e.bga = e.bga > 0 ? 0 : 0.55; e.bg = '#000000'; e.br = e.bga ? 2 : 0; }
    else if (a === 'fit') e.fit = v; else return;
    touch(); renderPane();
  });
  root.addEventListener('input', (ev) => {
    const t = ev.target, e = cur();
    if (t.id === 'se-u') { S.draft = t.value; return; }
    if (!e) return;
    if (t.id === 'se-t') { e.text = t.value; touch(); if (S.nodes[S.sel]) S.nodes[S.sel].textContent = e.text; return; }
    if (t.id === 'se-cp') { e.color = t.value; touch(); return; }
    if (t.dataset.r) { e[t.dataset.r] = +t.value; touch(); }
  });
  root.addEventListener('change', (ev) => { if (ev.target.id === 'se-cp') renderPane(); });
  // Glisser pour déplacer ; toucher le fond de la scène pour désélectionner.
  stage.addEventListener('pointerdown', (ev) => {
    const n = ev.target.closest('.se-el'), i = n ? S.nodes.indexOf(n) : -1;
    if (i < 0) { if (S.sel !== -1) select(-1); return; }
    ev.preventDefault(); if (S.sel !== i) select(i);
    const e = S.els[i], r = stage.getBoundingClientRect(), sx = ev.clientX, sy = ev.clientY, ox = e.x, oy = e.y;
    try { stage.setPointerCapture(ev.pointerId); } catch {}
    const mv = (m) => { e.x = clamp(ox + (m.clientX - sx) / r.width * 100, 0, 100); e.y = clamp(oy + (m.clientY - sy) / r.height * 100, 0, 100); apply(S.nodes[i], e); };
    const up = () => { stage.removeEventListener('pointermove', mv); stage.removeEventListener('pointerup', up); stage.removeEventListener('pointercancel', up); };
    stage.addEventListener('pointermove', mv); stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  });
  rebuild(); renderTabs(); renderPane(); root.querySelector('.se-x').focus();
}

window.JXStory = { open, build };
})();
