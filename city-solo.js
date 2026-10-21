// city-solo.js — JexCity : jeux solo (morpion contre l'ordinateur, contre-la-montre, cibles).
// Tout se passe dans le navigateur : aucun réseau, aucune écriture en base. Seuls les records personnels sont gardés sur l'appareil
// (localStorage, clés jexcity.best.*). Une seule boucle d'affichage à la fois, arrêtée à la fermeture du panneau.

const MARK = {
  X: '<svg viewBox="0 0 40 40" aria-hidden="true"><path class="stroke" d="M9 9L31 31M31 9L9 31"/></svg>',
  O: '<svg viewBox="0 0 40 40" aria-hidden="true"><circle class="stroke" cx="20" cy="20" r="11"/></svg>',
};
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
export function tttWinner(b) { for (const l of LINES) if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[0]] === b[l[2]]) return { w: b[l[0]], line: l }; return b.every(Boolean) ? { w: 'draw' } : null; }

// IA : « easy » au hasard ; « medium » gagne ou bloque sinon au hasard ; « hard » minimax (imbattable).
export function aiMove(board, level, me = 'O', foe = 'X') {
  const free = board.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  if (level === 'easy') return free[Math.floor(Math.random() * free.length)];
  const tryWin = (sym) => free.find((i) => { const b = board.slice(); b[i] = sym; return tttWinner(b)?.w === sym; });
  if (level === 'medium') { const m = tryWin(me) ?? tryWin(foe); return m ?? free[Math.floor(Math.random() * free.length)]; }
  const score = (b, turn, depth) => { const r = tttWinner(b); if (r) return r.w === me ? 10 - depth : r.w === foe ? depth - 10 : 0; const fr = b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0); const vals = fr.map((i) => { const c = b.slice(); c[i] = turn; return score(c, turn === me ? foe : me, depth + 1); }); return turn === me ? Math.max(...vals) : Math.min(...vals); };
  let best = -99, pick = free[0];
  for (const i of free) { const c = board.slice(); c[i] = me; const v = score(c, foe, 1); if (v > best) { best = v; pick = i; } }
  return pick;
}

const TRACK = { cx: 150, cy: 100, rx: 110, ry: 70, band: 0.3, laps: 2 };
const store = {
  get: (k) => { try { return Number(localStorage.getItem('jexcity.best.' + k)) || 0; } catch (_) { return 0; } },
  set: (k, v) => { try { localStorage.setItem('jexcity.best.' + k, String(v)); } catch (_) { /* stockage refusé : le record n'est pas gardé */ } },
};

export function createSolo({ h, toast }) {
  let panel = null, stopFn = null;
  function close() { stopFn?.(); stopFn = null; panel?.remove(); panel = null; }
  function shell(title, extra) {
    close(); panel = h('section', { class: 'gpanel', 'aria-label': title });
    const status = h('div', { class: 'gstatus', role: 'status', 'aria-live': 'polite' }), body = h('div', null), acts = h('div', { class: 'actions', style: 'margin:8px 0;justify-content:center' });
    panel.append(h('header', null, h('b', { text: title }), h('span', { class: 'sub', text: extra || 'Solo' }), h('button', { class: 'fab', 'aria-label': 'Fermer le jeu', onclick: close, text: '✕' })), status, body, acts);
    document.body.append(panel); return { status, body, acts };
  }
  const setResult = (cls) => { panel.className = 'gpanel' + (cls ? ' ' + cls : ''); };
  const bestLine = (k, fmt) => { const v = store.get(k); return v ? `Record : ${fmt(v)}` : 'Pas encore de record'; };

  // ── Morpion contre l'ordinateur ──
  function ttt(level = 'hard', humanFirst = true) {
    const { status, body, acts } = shell('Morpion — contre l’ordinateur', { easy: 'Facile', medium: 'Moyen', hard: 'Imbattable' }[level]);
    let board = Array(9).fill(''), over = false, turn = humanFirst ? 'X' : 'O', timer = 0, res = null;
    const grid = h('div', { class: 'gboard mine', role: 'grid', 'aria-label': 'Grille' }); body.append(grid);
    const draw = () => {
      const line = new Set(res?.line || []);
      grid.replaceChildren(...board.map((v, i) => { const c = h('button', { class: 'cell' + (v ? ' full ' + v : '') + (line.has(i) ? ' hit' : ''), 'aria-label': `Case ${i + 1}${v ? ' : ' + v : ''}`, disabled: over || turn !== 'X' || v ? true : null, onclick: () => play(i) }); if (v) c.innerHTML = MARK[v]; return c; }));
      status.textContent = over ? (res.w === 'X' ? 'Victoire ! 🎉' : res.w === 'O' ? 'Défaite… l’ordinateur gagne.' : 'Match nul.') : turn === 'X' ? 'À vous (X)' : 'L’ordinateur réfléchit…';
      setResult(over ? (res.w === 'X' ? 'win' : res.w === 'O' ? 'lose' : 'draw') : '');
    };
    const check = () => { res = tttWinner(board); if (res) { over = true; acts.replaceChildren(...endButtons()); } };
    const ai = () => { if (over) return; board[aiMove(board, level)] = 'O'; check(); turn = 'X'; draw(); };
    function play(i) { if (over || turn !== 'X' || board[i]) return; board[i] = 'X'; check(); turn = 'O'; draw(); if (!over) timer = setTimeout(ai, 380); }
    const endButtons = () => [h('button', { class: 'btn small primary', onclick: () => ttt(level, !humanFirst), text: 'Rejouer' }),
      ...['easy', 'medium', 'hard'].filter((l) => l !== level).map((l) => h('button', { class: 'btn small', onclick: () => ttt(l), text: { easy: 'Facile', medium: 'Moyen', hard: 'Imbattable' }[l] }))];
    acts.append(...['easy', 'medium', 'hard'].map((l) => h('button', { class: 'btn small' + (l === level ? ' primary' : ''), onclick: () => ttt(l), text: { easy: 'Facile', medium: 'Moyen', hard: 'Imbattable' }[l] })));
    draw(); if (turn === 'O') timer = setTimeout(ai, 500);
    stopFn = () => clearTimeout(timer);
  }

  // ── Contre-la-montre : 2 tours, chrono local, record gardé sur l'appareil ──
  function race() {
    const { status, body, acts } = shell('Contre-la-montre', bestLine('race', (v) => (v / 1000).toFixed(2) + ' s'));
    const cv = h('canvas', { class: 'gcanvas', width: 300, height: 200, 'aria-label': 'Circuit' });
    const keys = { l: 0, r: 0, d: 0 };
    const hold = (label, k, aria) => { const b = h('button', { class: 'btn pad', 'aria-label': aria, text: label }); const on = (v) => (e) => { e.preventDefault(); keys[k] = v; }; b.addEventListener('pointerdown', on(1)); b.addEventListener('pointerup', on(0)); b.addEventListener('pointerleave', on(0)); b.addEventListener('pointercancel', on(0)); return b; };
    body.append(cv, h('div', { class: 'gpad' }, hold('◀', 'l', 'Gauche'), hold('▼', 'd', 'Freiner'), hold('▶', 'r', 'Droite')));
    const map = { ArrowLeft: 'l', a: 'l', q: 'l', ArrowRight: 'r', d: 'r', ArrowDown: 'd', s: 'd' };
    const kd = (e) => { const m = map[e.key]; if (m) { keys[m] = 1; e.preventDefault(); } }, ku = (e) => { const m = map[e.key]; if (m) keys[m] = 0; };
    addEventListener('keydown', kd); addEventListener('keyup', ku);
    const c = cv.getContext('2d'); const car = { x: 40, y: 100, a: -Math.PI / 2, v: 0, th: Math.PI, acc: 0, p: 0 };
    // Véhicules en vraies vues du dessus (modèles GLB Kenney) : chargés seulement ici, au moment d'ouvrir la course.
    let sprite = null;
    import('./city-sprites.js').then((m) => {
      let pick = 0; try { pick = Math.max(0, m.VEHICLES.findIndex((v) => v.id === localStorage.getItem('jexcity.vehicle'))); } catch (_) { /* défaut */ }
      const imgs = m.VEHICLES.map((v) => Object.assign(new Image(), { src: v.src })), row = h('div', { class: 'chips', style: 'justify-content:center' });
      const sel = (i) => { pick = i; sprite = imgs[i]; try { localStorage.setItem('jexcity.vehicle', m.VEHICLES[i].id); } catch (_) { /* ignoré */ } [...row.children].forEach((b, k) => b.classList.toggle('on', k === i)); };
      m.VEHICLES.forEach((v, i) => row.append(h('button', { class: 'chip', onclick: () => sel(i), text: v.name })));
      body.insertBefore(row, cv); sel(pick);
    }).catch(() => { /* sans sprites : le carré bleu d'origine reste utilisé */ });
    const info = (x, y) => { const nx = (x - TRACK.cx) / TRACK.rx, ny = (y - TRACK.cy) / TRACK.ry; return { on: Math.abs(Math.hypot(nx, ny) - 1) < TRACK.band, th: Math.atan2(ny, nx) }; };
    let start = performance.now() + 3000, done = 0, raf = 0, last = performance.now();
    function again() { Object.assign(car, { x: 40, y: 100, a: -Math.PI / 2, v: 0, th: Math.PI, acc: 0, p: 0 }); start = performance.now() + 3000; done = 0; acts.replaceChildren(); setResult(''); }
    function loop(now) {
      raf = requestAnimationFrame(loop); const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (now >= start && !done) {
        car.a += (keys.r - keys.l) * 2.7 * dt; const on = info(car.x, car.y).on, vmax = on ? 100 : 40;
        car.v += ((keys.d ? 0 : vmax) - car.v) * Math.min(1, dt * (keys.d ? 3 : 1.6)); if (car.v > vmax) car.v += (vmax - car.v) * Math.min(1, dt * 5);
        car.x = Math.min(300, Math.max(0, car.x + Math.cos(car.a) * car.v * dt)); car.y = Math.min(200, Math.max(0, car.y + Math.sin(car.a) * car.v * dt));
        let d = info(car.x, car.y).th - car.th; d = Math.atan2(Math.sin(d), Math.cos(d)); car.th += d; car.acc += d; car.p = Math.max(car.p, Math.min(1, Math.max(0, car.acc) / (Math.PI * 2 * TRACK.laps)));
        if (car.p >= 1) { done = now - start; finish(done); }
      }
      c.fillStyle = '#2f5a3a'; c.fillRect(0, 0, 300, 200); c.strokeStyle = '#5b5a58'; c.lineWidth = TRACK.band * 2 * 70 * 0.9; c.beginPath(); c.ellipse(TRACK.cx, TRACK.cy, TRACK.rx, TRACK.ry, 0, 0, 7); c.stroke();
      c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.moveTo(18, 100); c.lineTo(62, 100); c.stroke();
      c.save(); c.translate(car.x, car.y); c.rotate(car.a); if (sprite && sprite.complete && sprite.naturalWidth) c.drawImage(sprite, -14, -7.5, 28, 15); else { c.fillStyle = '#6aa9ff'; c.fillRect(-9, -5, 18, 10); } c.restore();
      const t = now < start ? 0 : (done || now - start); c.font = '700 14px system-ui,sans-serif'; c.lineWidth = 3; c.textAlign = 'left'; c.strokeStyle = 'rgba(0,0,0,.8)';
      const hud = `${(t / 1000).toFixed(2)} s · ${Math.round(car.p * 100)} %`; c.strokeText(hud, 6, 16); c.fillStyle = '#fff'; c.fillText(hud, 6, 16);
      if (now < start) { c.textAlign = 'center'; c.font = '700 26px system-ui,sans-serif'; c.lineWidth = 4; const n = String(Math.ceil((start - now) / 1000)); c.strokeText(n, 150, 100); c.fillText(n, 150, 100); }
      if (!done) status.textContent = now < start ? 'Préparez-vous…' : 'Gauche/droite pour tourner, ▼ pour freiner';
    }
    function finish(ms) {
      const prev = store.get('race'), rec = !prev || ms < prev; if (rec) store.set('race', Math.round(ms));
      status.textContent = rec ? `Nouveau record : ${(ms / 1000).toFixed(2)} s ! 🎉` : `${(ms / 1000).toFixed(2)} s (record ${(prev / 1000).toFixed(2)} s)`; setResult(rec ? 'win' : 'draw');
      acts.replaceChildren(h('button', { class: 'btn small primary', onclick: again, text: 'Rejouer' }));
    }
    raf = requestAnimationFrame(loop);
    stopFn = () => { cancelAnimationFrame(raf); removeEventListener('keydown', kd); removeEventListener('keyup', ku); };
  }

  // ── Cibles : 30 s, touchez les cibles avant qu'elles disparaissent ──
  function targets() {
    const { status, body, acts } = shell('Cibles', bestLine('targets', (v) => v + ' pts'));
    const cv = h('canvas', { class: 'gcanvas', width: 300, height: 200, 'aria-label': 'Aire de jeu : touchez les cibles' }); body.append(cv);
    const c = cv.getContext('2d'); let list = [], score = 0, combo = 0, misses = 0, t0 = performance.now() + 1500, spawnT = 0, raf = 0, last = performance.now(), over = false, flash = null; const DUR = 30000;
    function again() { list = []; score = 0; combo = 0; misses = 0; t0 = performance.now() + 1500; over = false; acts.replaceChildren(); setResult(''); }
    cv.addEventListener('pointerdown', (e) => {
      if (over || performance.now() < t0) return; const r = cv.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * 300, y = ((e.clientY - r.top) / r.height) * 200;
      const i = list.findIndex((o) => Math.hypot(o.x - x, o.y - y) < o.r + 6);
      if (i >= 0) { const o = list[i]; combo++; score += 1 + Math.min(4, Math.floor(combo / 3)) + (o.life > o.max * 0.6 ? 1 : 0); flash = { x: o.x, y: o.y, t: performance.now() }; list.splice(i, 1); } else { combo = 0; misses++; }
    });
    function loop(now) {
      raf = requestAnimationFrame(loop); const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const el = now - t0;
      if (el >= 0 && !over) {
        spawnT -= dt; if (spawnT <= 0 && list.length < 3) { const max = Math.max(0.9, 1.7 - el / 30000 * 0.7); list.push({ x: 25 + Math.random() * 250, y: 30 + Math.random() * 145, r: 12 + Math.random() * 6, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, life: max, max }); spawnT = 0.45; }
        for (const o of list) { o.life -= dt; o.x += o.vx * dt; o.y += o.vy * dt; if (o.x < 15 || o.x > 285) o.vx *= -1; if (o.y < 25 || o.y > 185) o.vy *= -1; }
        const before = list.length; list = list.filter((o) => o.life > 0); if (list.length < before) combo = 0;
        if (el >= DUR) end();
      }
      c.fillStyle = '#26324a'; c.fillRect(0, 0, 300, 200);
      for (const o of list) { const k = o.life / o.max; c.fillStyle = '#fff'; c.beginPath(); c.arc(o.x, o.y, o.r, 0, 7); c.fill(); c.fillStyle = '#ef6b6b'; c.beginPath(); c.arc(o.x, o.y, o.r * 0.72, 0, 7); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(o.x, o.y, o.r * 0.4, 0, 7); c.fill(); c.strokeStyle = '#f0b463'; c.lineWidth = 3; c.beginPath(); c.arc(o.x, o.y, o.r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); c.stroke(); }
      if (flash && now - flash.t < 200) { c.strokeStyle = `rgba(111,207,151,${1 - (now - flash.t) / 200})`; c.lineWidth = 3; c.beginPath(); c.arc(flash.x, flash.y, 14 + (now - flash.t) / 8, 0, 7); c.stroke(); }
      c.font = '700 13px system-ui,sans-serif'; c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.8)'; c.textAlign = 'left'; const hud = `${score} pts · série ${combo}`; c.strokeText(hud, 6, 15); c.fillStyle = '#fff'; c.fillText(hud, 6, 15);
      c.textAlign = 'right'; const left = over ? '0 s' : `${Math.max(0, Math.ceil((DUR - Math.max(0, el)) / 1000))} s`; c.strokeText(left, 294, 15); c.fillText(left, 294, 15);
      if (el < 0) { c.textAlign = 'center'; c.font = '700 22px system-ui,sans-serif'; c.lineWidth = 4; c.strokeText('Prêt ?', 150, 100); c.fillText('Prêt ?', 150, 100); }
      if (!over) status.textContent = el < 0 ? 'Préparez-vous…' : 'Touchez les cibles : enchaînez pour gagner plus';
    }
    function end() {
      over = true; list = []; const prev = store.get('targets'), rec = score > prev; if (rec) store.set('targets', score);
      status.textContent = rec ? `Nouveau record : ${score} pts ! 🎉` : `${score} pts (record ${prev})`; setResult(rec ? 'win' : 'draw');
      acts.replaceChildren(h('button', { class: 'btn small primary', onclick: again, text: 'Rejouer' }));
    }
    raf = requestAnimationFrame(loop); stopFn = () => cancelAnimationFrame(raf);
  }

  return { ttt, race, targets, close, get open() { return !!panel; } };
}
