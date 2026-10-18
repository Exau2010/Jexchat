// city-look.js — JexCity : palettes et options de personnalisation (partagées par l'avatar et le menu).
// Seuls des indices circulent sur le réseau (validés côté serveur) ; les couleurs sont définies ici.
export const SKIN = ['#f5d5bd', '#eac1a0', '#d9a27c', '#c98f6b', '#a9714f', '#8a5a3c', '#6b4429', '#4a2f1e'];
export const HAIR = ['#1d1612', '#3b2a1d', '#6b4a2b', '#a8742f', '#d9b45a', '#b5472b', '#8d8d95', '#e8e4dc'];
export const HAIR_NAMES = ['Noir', 'Brun', 'Châtain', 'Cuivré', 'Blond', 'Roux', 'Gris', 'Blanc'];
export const SKIN_NAMES = ['Très clair', 'Clair', 'Hâlé', 'Mat', 'Caramel', 'Brun', 'Foncé', 'Très foncé'];
export const STYLES = ['Courts', 'Longs', 'Queue de cheval', 'Bouclés', 'Rasés', 'Chauve'];
export const ACCESSORIES = ['Aucun', 'Lunettes', 'Casquette', 'Bandeau'];
export const LOOK_MAX = { s: 1, h: 5, hc: 7, sk: 7, ac: 3 };
export const DEFAULT_LOOK = { s: 0, h: 0, hc: 0, sk: 3, ac: 0 };
export function cleanLook(v) {
  const out = { ...DEFAULT_LOOK };
  if (!v || typeof v !== 'object') return out;
  for (const k of Object.keys(LOOK_MAX)) { const n = Number(v[k]); if (Number.isInteger(n) && n >= 0 && n <= LOOK_MAX[k]) out[k] = n; }
  return out;
}
const KEY = 'jexcity.look';
export function loadLocalLook() { try { return cleanLook(JSON.parse(localStorage.getItem(KEY))); } catch (_) { return { ...DEFAULT_LOOK }; } }
export function saveLocalLook(look) { try { localStorage.setItem(KEY, JSON.stringify(look)); } catch (_) { /* stockage plein ou refusé : le serveur garde la valeur */ } }
