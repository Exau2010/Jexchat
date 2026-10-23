// city-tour.js — JexCity : visite guidée de la PREMIÈRE connexion (une fois par compte et par appareil ; rejouable avec le bouton ❔).
// Cartes courtes en bas de l'écran, avec mise en surbrillance des boutons concernés et possibilité d'y aller directement.
// Rien n'est envoyé au serveur : l'état « visite faite » est gardé dans localStorage (jexcity.tour.<id>).
const STEPS = (lm) => [
  { t: '👋 Bienvenue à JexCity !', d: 'Une ville 3D où vous retrouvez les gens de JexChat. Cette visite de 1 minute vous montre l’essentiel.' },
  { t: '🚶 Se déplacer', d: 'Touchez le sol pour marcher jusque-là. Touchez un immeuble pour rejoindre sa façade. Glissez dans la zone « glisser ici » (bas droite) pour tourner la caméra, pincez pour zoomer.' },
  { t: '🗺️ La carte', d: 'Le bouton carte montre toute la ville et ses lieux : touchez un lieu pour y aller en marchant.', hi: '[data-act="map"]' },
  { t: '🎬 Le cinéma', d: 'Le grand cinéma est sur la Grande Avenue, côté ouest. Au guichet, collez l’adresse d’un film (comme pour une publication) : regardez seul(e) ou invitez un ami présent. Asseyez-vous sur un fauteuil, levez-vous quand vous voulez.', go: ['Aller au cinéma', lm.cinema] },
  { t: '🏙️ Des lieux partout', d: 'Cafétéria (humeur), musée technologique, supermarché (tenue) et stade sont répartis dans la ville : cherchez les enseignes lumineuses.', go: ['Voir la cafétéria', lm.cafe] },
  { t: '🎮 Mini-jeux entre amis', d: 'L’Arène réunit jusqu’à 4 joueurs, chacun sur SON appareil : invitez les personnes présentes dans la ville. Les places libres sont jouées par des robots. Une seule touche suffit !', hi: '#b-arena' },
  { t: '👤 Vous & les autres', d: 'Touchez un habitant pour voir son profil et l’inviter. Réglages : apparence, heure de la journée, mode graphique léger si la ville est lente.', hi: '[data-act="settings"]' },
  { t: '✅ C’est parti !', d: 'Bonne balade ! Le bouton ❔ rejoue cette visite à tout moment.' },
];
export function startTour({ hud, walkTo, landmarks, done = () => {} }) {
  const steps = STEPS(landmarks()); let i = 0, card = null, lit = null;
  const el = (tag, css, txt) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; return e; };
  const unlit = () => { if (lit) { lit.style.outline = ''; lit.style.boxShadow = ''; lit = null; } };
  function end() { unlit(); card?.remove(); card = null; done(); }
  function show() {
    unlit(); card?.remove(); const s = steps[i];
    card = el('div', 'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 18px);transform:translateX(-50%);z-index:90;width:min(94vw,440px);padding:16px 18px;border-radius:20px;color:#fff;font-family:system-ui,sans-serif;background:rgba(18,24,44,.94);border:1px solid rgba(255,255,255,.4);backdrop-filter:blur(14px);box-shadow:0 10px 40px rgba(0,0,0,.55)');
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Visite guidée');
    card.append(el('div', 'font:800 19px system-ui;margin-bottom:6px', s.t), el('div', 'font-size:15px;line-height:1.45;opacity:.95', s.d), el('div', 'font-size:12px;opacity:.65;margin-top:6px', `${i + 1} / ${steps.length}`));
    const row = el('div', 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap');
    const b = (txt, bg, fg, fn) => { const x = el('button', `flex:1;min-width:90px;padding:11px;border-radius:13px;border:1px solid rgba(255,255,255,.35);font:700 15px system-ui;background:${bg};color:${fg}`, txt); x.onclick = fn; return x; };
    if (i < steps.length - 1) row.append(b('Passer', 'rgba(255,255,255,.12)', '#fff', end));
    if (s.go) row.append(b(s.go[0], 'rgba(255,255,255,.2)', '#fff', () => { walkTo(s.go[1].x, s.go[1].z); }));
    row.append(b(i < steps.length - 1 ? 'Suivant' : 'Terminer', '#ffd23d', '#231a00', () => { if (++i >= steps.length) end(); else show(); }));
    card.append(row); document.body.append(card);
    if (s.hi) { const t = document.querySelector(s.hi); if (t) { lit = t; t.style.outline = '3px solid #ffd23d'; t.style.boxShadow = '0 0 18px 4px rgba(255,210,61,.8)'; } }
  }
  show();
}
export function startTourIfFirst({ me, hud, walkTo, landmarks }) {
  const key = `jexcity.tour.${me.id}`; let seen = false; try { seen = !!localStorage.getItem(key); } catch (_) { /* stockage indisponible : on montre la visite */ }
  const mark = () => { try { localStorage.setItem(key, '1'); } catch (_) { /* non bloquant */ } };
  const run = () => startTour({ hud, walkTo, landmarks, done: mark });
  if (!document.getElementById('b-tour')) { // bouton pour rejouer la visite
    const b = document.createElement('button'); b.id = 'b-tour'; b.className = 'fab'; b.textContent = '❔'; b.setAttribute('aria-label', 'Revoir la visite guidée'); b.style.cssText = 'font-size:18px'; b.onclick = run; hud.querySelector('#hud-right')?.append(b);
  }
  if (!seen) setTimeout(run, 1500);
}
