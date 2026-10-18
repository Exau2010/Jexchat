// city-media.js — JexCity : lecteur vidéo intégré (même règles que JexChat : fichier direct, YouTube, Vimeo).
// Cause du bug « vidéo vide » : un lien YouTube/Vimeo était passé tel quel à <video>, qui ne sait pas le lire.
// Ici : détection du type, aperçu léger, iframe créée seulement au clic (rien ne se charge avant), repli en lien.
// Seules les URL https sont acceptées ; les hôtes d'intégration sont ceux autorisés par la CSP du serveur.

export function parseVideo(url) {
  if (typeof url !== 'string') return { type: 'unknown' };
  let u; try { u = new URL(url.trim()); } catch (_) { return { type: 'unknown' }; }
  if (u.protocol !== 'https:') return { type: 'unknown' };
  const host = u.hostname.replace(/^www\./, ''), path = u.pathname;
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    let id = '';
    if (host === 'youtu.be') id = path.slice(1);
    else if (path === '/watch') id = u.searchParams.get('v') || '';
    else if (path.startsWith('/embed/')) id = path.split('/embed/')[1];
    else if (path.startsWith('/shorts/')) id = path.split('/shorts/')[1];
    id = (id || '').split(/[?&/]/)[0];
    if (/^[a-zA-Z0-9_-]{6,15}$/.test(id)) return { type: 'youtube', embed: `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1`, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, vertical: path.startsWith('/shorts/'), url: u.href };
    return { type: 'unknown', url: u.href };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = path.match(/(\d{4,})/);
    if (m) return { type: 'vimeo', embed: `https://player.vimeo.com/video/${m[1]}`, url: u.href };
    return { type: 'unknown', url: u.href };
  }
  // Fichier direct : extension, ou chemin d'un hébergeur de médias sans extension (essai <video>, repli en lien si erreur)
  if (/\.(mp4|webm|ogv|ogg|m4v|mov)$/i.test(path)) return { type: 'direct', url: u.href };
  return { type: 'unknown', url: u.href };
}

const el = (tag, css, attrs) => { const e = document.createElement(tag); if (css) e.style.cssText = css; for (const k in attrs || {}) e.setAttribute(k, attrs[k]); return e; };

// Construit le lecteur. `onFallback` : lien « Ouvrir la vidéo » si lecture impossible.
export function buildPlayer(url) {
  const info = parseVideo(url);
  const wrap = el('div', 'margin-top:8px;max-width:100%');
  const link = () => { const a = el('a', 'display:inline-block;margin-top:6px;color:#f0b463'); a.href = info.url || url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Ouvrir la vidéo'; return a; };
  if (info.type === 'direct' || info.type === 'unknown') {
    // Même un format inconnu est essayé une fois dans <video> ; si le navigateur refuse, on affiche le lien.
    const v = el('video', 'width:100%;max-height:50vh;border-radius:10px;background:#000;display:block', { controls: '', playsinline: '', preload: 'metadata' });
    v.setAttribute('referrerpolicy', 'no-referrer'); v.setAttribute('aria-label', 'Vidéo de la publication');
    v.src = info.url || url;
    v.addEventListener('error', () => { if (v.parentNode) { v.replaceWith(link()); } }, { once: true });
    wrap.append(v); return wrap;
  }
  const box = el('div', `position:relative;cursor:pointer;border-radius:10px;overflow:hidden;background:#000;aspect-ratio:${info.vertical ? '9/16' : '16/9'};display:grid;place-items:center;max-height:55vh;${info.vertical ? 'max-width:240px;margin:0 auto' : 'width:100%'}`, { role: 'button', tabindex: '0', 'aria-label': 'Lire la vidéo' });
  if (info.thumb) { const im = el('img', 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.85', { alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }); im.src = info.thumb; im.addEventListener('error', () => { im.style.display = 'none'; }, { once: true }); box.append(im); }
  const play = el('div', 'position:relative;width:58px;height:58px;border-radius:50%;background:rgba(0,0,0,.65);display:grid;place-items:center;color:#fff'); play.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'; box.append(play);
  const start = () => {
    const f = el('iframe', 'position:absolute;inset:0;width:100%;height:100%;border:0', { allow: 'encrypted-media; picture-in-picture; fullscreen', allowfullscreen: '', title: 'Lecteur vidéo', referrerpolicy: 'strict-origin-when-cross-origin' });
    f.src = info.embed + (info.type === 'youtube' ? '&autoplay=1' : '?autoplay=1'); box.replaceChildren(f); box.style.cursor = 'default';
  };
  box.addEventListener('click', start, { once: true }); box.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); } });
  wrap.append(box); wrap.append(link()); return wrap;
}

// Hôtes que le navigateur intégré peut réellement afficher (CSP frame-src du serveur) ; le reste s'ouvre à part.
export function embeddable(url) { const p = parseVideo(url); return p.type === 'youtube' || p.type === 'vimeo' ? p : null; }
