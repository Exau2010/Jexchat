(function () {
  'use strict';
  const sheet = document.querySelector('#storymodal .sheet.sted');
  if (!sheet || typeof sted === 'undefined') return;
  const $ = (id) => document.getElementById(id);
  const fonts = [['inter', 'Aa', 'font-weight:600'], ['fraunces', 'Aa', 'font-style:italic;font-family:Georgia,serif'], ['impact', 'Aa', 'font-family:Impact,sans-serif'], ['mono', 'Aa', 'font-family:monospace'], ['serif', 'Aa', 'font-family:Georgia,serif;font-weight:700']];
  const colors = ['#ffffff', '#000000', '#ffd400', '#ff3b30', '#34c759', '#0a84ff', '#a855f7', '#ff2d92'];
  const fxs = [['none', 'Aucun', ''], ['shadow', 'Ombre', 'text-shadow:2px 2px 4px #000'], ['outline', 'Contour', '-webkit-text-stroke:1px #e8eefc;color:transparent'], ['neon', 'Neon', 'color:#e9d5ff;text-shadow:0 0 8px #a855f7,0 0 16px #a855f7'], ['glitch', 'Glitch', 'text-shadow:-2px 0 #f43,2px 0 #0cf']];
  const emojis = ['😀', '😍', '🔥', '💙', '🎉', '✨', '👍', '🌅', '🌴', '🎶', '⭐', '❤️'];
  const tools = [['🖼️', 'Média', 'Photos / Vidéos', 'media'], ['T', 'Texte', 'Ajouter du texte', 'text'], ['😊', 'Stickers', 'Autocollants', 'stickers'], ['✨', 'Effets', 'Fonds animés & couleurs', 'fx'], ['♪', 'Musique', 'Lien audio (mp3…)', 'music'], ['🔗', 'Lien', 'Ajouter un lien', 'link'], ['📍', 'Localisation', 'Partager un lieu', 'loc']];
  const left = document.createElement('aside'); left.id = 'sd-left'; left.setAttribute('aria-label', 'Créer une story');
  left.innerHTML = '<h2>Créer une story<button type="button" class="sd-x" aria-label="Fermer">✕</button></h2>' + tools.map(([ic, t, s, k]) => `<button type="button" class="sd-it" data-t="${k}"><i>${ic}</i><span><b>${t}</b><small>${s}</small></span></button>` + (k === 'stickers' ? `<div class="sd-pop" id="sd-pop-st">${emojis.map((e) => `<button type="button" data-e="${e}" aria-label="Sticker ${e}">${e}</button>`).join('')}</div>` : '') + (k === 'fx' ? '<div class="sd-pop" id="sd-pop-fx"></div>' : '')).join('');
  const right = document.createElement('aside'); right.id = 'sd-right'; right.setAttribute('aria-label', 'Personnalisation du texte');
  right.innerHTML = '<h3>Style du texte</h3><div class="sd-row" data-g="font">' + fonts.map(([k, t, s]) => `<button type="button" class="sd-b" data-v="${k}" style="${s}" aria-label="Police ${k}">${t}</button>`).join('') + '</div>' +
    '<h3>Couleur du texte</h3><div class="sd-row" data-g="color" style="gap:10px;flex-wrap:wrap">' + colors.map((c) => `<button type="button" class="sd-c" data-v="${c}" style="background:${c}" aria-label="Couleur ${c}"></button>`).join('') + '</div>' +
    '<h3>Position</h3><div class="sd-row" data-g="align">' + [['left', 'Gauche'], ['center', 'Centre'], ['right', 'Droite']].map(([k, t]) => `<button type="button" class="sd-b" data-v="${k}" style="font-size:14px">${t}</button>`).join('') + '</div>' +
    '<h3>Fond du texte</h3><div class="sd-row" data-g="bg">' + [['0', 'Aucun'], ['0.55', 'Semi'], ['1', 'Plein']].map(([k, t]) => `<button type="button" class="sd-b" data-v="${k}" style="font-size:14px">${t}</button>`).join('') + '</div>' +
    '<h3>Effets</h3><div class="sd-row" data-g="fx">' + fxs.map(([k, t, s]) => `<button type="button" class="sd-b" data-v="${k}" aria-label="Effet ${t}"><span style="font-size:19px;${s}">Aa</span><small>${t}</small></button>`).join('') + '</div>' +
    '<div class="sd-dur"><div><span>Durée de la story</span><output id="sd-durv">Auto</output></div><input type="range" id="sd-dur" min="3" max="30" step="1" value="5" aria-label="Durée de la story"></div>' +
    '<button type="button" class="sd-adv" id="sd-adv">Options avancées <span>▾</span></button>';
  sheet.append(left, right);

  function curText() { const el = sted.els[sted.sel]; if (!el || el.kind !== 'text') { toast('Sélectionnez d’abord un texte dans l’aperçu.'); return null; } return el; }
  function mark() {
    const el = sted.els[sted.sel]; const t = el && el.kind === 'text' ? el : null;
    const cur = { font: t && t.font, color: t && t.color, align: t && t.align, fx: t && (t.fx || 'none'), bg: t && String(t.bga >= 1 ? 1 : t.bga > 0 ? 0.55 : 0) };
    right.querySelectorAll('[data-g]').forEach((g) => g.querySelectorAll('[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === cur[g.dataset.g])));
  }
  right.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    const el = curText(); if (!el) return;
    const g = b.parentElement.dataset.g, v = b.dataset.v;
    if (g === 'bg') { const a = Number(v); if (a > 0) stedSet('bg', el.color === '#000000' ? '#ffffff' : '#000000'); stedSet('bga', a); }
    else stedSet(g, v);
    stedSync(); mark();
  });
  $('sd-dur').addEventListener('input', (e) => { sted.dur = Number(e.target.value); $('sd-durv').textContent = sted.dur + ' secondes'; });
  $('sd-adv').addEventListener('click', () => $('sted-adv').classList.toggle('open'));
  sheet.addEventListener('pointerup', () => setTimeout(mark, 0));
  new MutationObserver(() => { if ($('storymodal').classList.contains('on')) { sted.dur = 0; $('sd-durv').textContent = 'Auto'; $('sd-dur').value = 5; setTimeout(mark, 0); } }).observe($('storymodal'), { attributes: true, attributeFilter: ['class'] });

  function addText(txt, size) {
    stedAddText(); const el = sted.els[sted.sel]; if (!el) return;
    el.text = txt; el.size = size || 6; sted.nodes[sted.sel].textContent = txt; sfApply(sted.nodes[sted.sel], el);
    $('story-content').value = txt; stedLayers(); stedSync(); mark();
  }
  const fxPop = $('sd-pop-fx');
  fxPop.innerHTML = SF_BGS.map((c, i) => `<button type="button" class="sw" data-bg="${i}" style="background:${c}" aria-label="Fond ${i + 1}"></button>`).join('');
  left.addEventListener('click', (e) => {
    if (e.target.closest('.sd-x')) { closeOverlay('storymodal'); return; }
    const em = e.target.closest('[data-e]'); if (em) { addText(em.dataset.e, 16); return; }
    const bg = e.target.closest('[data-bg]'); if (bg) { sted.bgi = Number(bg.dataset.bg); sfBg($('sted-stage'), sted.bgi); stedBgDot(); return; }
    const it = e.target.closest('.sd-it'); if (!it) return;
    left.querySelectorAll('.sd-it').forEach((x) => x.classList.toggle('on', x === it));
    const k = it.dataset.t, box = $('sted-mediabox');
    $('sd-pop-st').classList.toggle('on', k === 'stickers'); fxPop.classList.toggle('on', k === 'fx');
    if (k === 'media' || k === 'music') { box.classList.remove('hidden'); const u = $('story-url'); u.placeholder = k === 'music' ? 'Collez le lien (https://…) d’un fichier audio (.mp3, .m4a…)' : 'Collez le lien (https://…) de votre photo ou vidéo'; u.focus(); }
    else if (k === 'text') addText('', 6);
    else if (k === 'link') { const u = (prompt('Adresse du lien (https://…)') || '').trim(); if (/^https?:\/\/\S+$/i.test(u)) addText('🔗 ' + u.replace(/^https?:\/\//i, '').slice(0, 60), 5); else if (u) toast('Lien invalide (https:// requis).'); }
    else if (k === 'loc') { const p = (prompt('Nom du lieu') || '').trim().slice(0, 60); if (p) addText('📍 ' + p, 6); }
  });
  mark();
})();
