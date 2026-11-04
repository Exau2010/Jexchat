(function () {
  'use strict';
  const KEY = 'jexai:history';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let hist = []; try { hist = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (_) {}
  let ctl = null, busy = false;
  const fab = document.createElement('button');
  fab.id = 'jexai-fab'; fab.type = 'button'; fab.setAttribute('aria-label', 'Ouvrir JexAi'); fab.setAttribute('aria-expanded', 'false');
  fab.innerHTML = '<img src="/jexai-logo.png" alt="" width="38" height="38">';
  const panel = document.createElement('section');
  panel.id = 'jexai-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'JexAi');
  panel.innerHTML = '<div class="jxa-h"><img src="/jexai-logo.png" alt=""><b>JexAi</b><button type="button" id="jxa-new">Nouvelle</button><button type="button" id="jxa-x" aria-label="Fermer">✕</button></div><div id="jexai-log" aria-live="polite"></div><form class="jxa-f"><textarea id="jxa-in" maxlength="4000" rows="1" placeholder="Posez une question à JexAi…" aria-label="Votre message"></textarea><button type="submit" id="jxa-go">Envoyer</button></form>';
  document.body.append(fab, panel);
  const log = panel.querySelector('#jexai-log'), inp = panel.querySelector('#jxa-in'), go = panel.querySelector('#jxa-go');

  function fmt(t) { // texte échappé ; blocs ``` rendus en <pre><code>
    return esc(t).replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_, c) => '<pre><code>' + c + '</code></pre>');
  }
  function add(role, text) {
    const d = document.createElement('div'); d.className = 'jxa-m ' + role; d.innerHTML = fmt(text);
    if (role === 'a') {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'jxa-cp'; b.textContent = 'Copier';
      b.onclick = () => navigator.clipboard?.writeText(text).then(() => { b.textContent = 'Copié ✓'; setTimeout(() => (b.textContent = 'Copier'), 1500); });
      d.appendChild(b);
    }
    log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
  }
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(hist.slice(-20))); } catch (_) {} };
  function render() {
    log.innerHTML = '';
    if (!hist.length) add('a', 'Bonjour ! Je suis JexAi. Je peux vous aider à utiliser JexChat et à créer vos stories.');
    hist.forEach((m) => add(m.role === 'user' ? 'u' : 'a', m.content));
  }
  function setBusy(b) { busy = b; go.textContent = b ? 'Arrêter' : 'Envoyer'; }
  function open(v) {
    panel.classList.toggle('open', v); fab.setAttribute('aria-expanded', String(v));
    if (v) { render(); inp.focus(); } else fab.focus();
  }
  fab.onclick = () => open(!panel.classList.contains('open'));
  panel.querySelector('#jxa-x').onclick = () => open(false);
  panel.querySelector('#jxa-new').onclick = () => { hist = []; save(); render(); };
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); panel.querySelector('form').requestSubmit(); } });
  panel.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) { ctl && ctl.abort(); return; }
    const text = inp.value.trim(); if (!text) return;
    inp.value = ''; hist.push({ role: 'user', content: text }); add('u', text); setBusy(true);
    const wait = document.createElement('div'); wait.className = 'jxa-dots'; wait.innerHTML = '<img src="/jexai-logo.png" alt=""><i></i><i></i><i></i>'; log.appendChild(wait); log.scrollTop = log.scrollHeight;
    ctl = new AbortController();
    try {
      const h = { 'Content-Type': 'application/json' };
      if (typeof state !== 'undefined' && state.token) h['X-Session-Token'] = state.token;
      const r = await fetch('/api/jexai', { method: 'POST', headers: h, credentials: 'include', signal: ctl.signal, body: JSON.stringify({ messages: hist.slice(-20) }) });
      const j = await r.json().catch(() => ({}));
      wait.remove();
      if (!r.ok) { hist.pop(); add('e', j.error || 'JexAi est indisponible.'); }
      else if (j.redact) { hist.pop(); add('a', j.reply); }
      else { hist.push({ role: 'assistant', content: j.reply }); add('a', j.reply); }
    } catch (err) {
      wait.remove(); hist.pop();
      add('e', err.name === 'AbortError' ? 'Génération arrêtée.' : 'Connexion impossible. Vérifiez votre réseau.');
    } finally { setBusy(false); save(); inp.focus(); }
  });
  // Visible uniquement une fois connecté ; masquée si un écran plein écran (éditeur de story…) est ouvert.
  setInterval(() => {
    const logged = typeof state !== 'undefined' && state.me;
    const fullscreen = document.querySelector('.overlay.on');
    fab.classList.toggle('on', !!logged && !fullscreen);
    if ((!logged || fullscreen) && panel.classList.contains('open')) open(false);
    if (!logged && hist.length) { hist = []; save(); }
  }, 800);
})();
