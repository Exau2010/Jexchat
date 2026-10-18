// city-look.js — JexCity : palettes et options de personnalisation (partagées par l'avatar et le menu).
// Seuls des indices circulent sur le réseau (validés côté serveur) ; les couleurs sont définies ici.
export const SKIN = ['#f5d5bd', '#eac1a0', '#d9a27c', '#c98f6b', '#a9714f', '#8a5a3c', '#6b4429', '#4a2f1e'];
export const HAIR = ['#1d1612', '#3b2a1d', '#6b4a2b', '#a8742f', '#d9b45a', '#b5472b', '#8d8d95', '#e8e4dc'];
export const HAIR_NAMES = ['Noir', 'Brun', 'Châtain', 'Cuivré', 'Blond', 'Roux', 'Gris', 'Blanc'];
export const SKIN_NAMES = ['Très clair', 'Clair', 'Hâlé', 'Mat', 'Caramel', 'Brun', 'Foncé', 'Très foncé'];
export const STYLES = ['Courts', 'Longs', 'Queue de cheval', 'Bouclés', 'Rasés', 'Chauve', 'Carré', 'Afro'];
export const ACCESSORIES = ['Aucun', 'Lunettes', 'Casquette', 'Bandeau', 'Bonnet', 'Couronne'];
export const TOPS = ['#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#16a085', '#2980b9', '#8e44ad', '#2c3e50']; // tc 0 = couleur du profil JexChat
export const TOP_NAMES = ['Couleur du profil', 'Rouge', 'Orange', 'Jaune', 'Vert', 'Turquoise', 'Bleu', 'Violet', 'Marine'];
export const PANTS = ['#27324a', '#1d1d22', '#6b5a43', '#7a8a9c', '#8f2f3a', '#2f5a3a', '#d9d3c4'];
export const PANT_NAMES = ['Jean', 'Noir', 'Marron', 'Gris-bleu', 'Bordeaux', 'Vert', 'Beige'];
export const SHOES = ['#d9d6cf', '#1b1b22', '#c0392b', '#2980b9', '#f1c40f', '#27ae60'];
export const SHOE_NAMES = ['Blanches', 'Noires', 'Rouges', 'Bleues', 'Jaunes', 'Vertes'];
export const EYES = ['#1a1410', '#3b6fb5', '#3f8f5a', '#7a5230', '#7d8791'];
export const EYE_NAMES = ['Marron foncé', 'Bleus', 'Verts', 'Noisette', 'Gris'];
export const BEARDS = ['Aucune', 'Barbe courte', 'Barbe', 'Moustache'];
export const LOOK_MAX = { s: 1, h: 7, hc: 7, sk: 7, ac: 5, tc: 8, pc: 6, sc: 5, ey: 4, bd: 3 };
export const DEFAULT_LOOK = { s: 0, h: 0, hc: 0, sk: 3, ac: 0, tc: 0, pc: 0, sc: 0, ey: 0, bd: 0 };
export function cleanLook(v) {
  const out = { ...DEFAULT_LOOK };
  if (!v || typeof v !== 'object') return out;
  for (const k of Object.keys(LOOK_MAX)) { const n = Number(v[k]); if (Number.isInteger(n) && n >= 0 && n <= LOOK_MAX[k]) out[k] = n; }
  return out;
}
const KEY = 'jexcity.look';
export function loadLocalLook() { try { return cleanLook(JSON.parse(localStorage.getItem(KEY))); } catch (_) { return { ...DEFAULT_LOOK }; } }
export function saveLocalLook(look) { try { localStorage.setItem(KEY, JSON.stringify(look)); } catch (_) { /* stockage plein ou refusé : le serveur garde la valeur */ } }
