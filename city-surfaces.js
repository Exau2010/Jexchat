// city-surfaces.js — JexCity : vraies textures photo (PBR) posées sur les quais, le relief et les routes.
// Chargé APRÈS l'affichage de la ville (jamais pendant le démarrage). Ne touche que des propriétés standard des matériaux
// (map, normalMap, roughnessMap) : aucun shader modifié, donc rien à compiler et aucun risque d'écran cassé.
// Sources (CC0) : PavingStones098 et Moss002 d'ambientCG ; Sandy_gravel_01 de cgbookcase. Normales converties en OpenGL.
//   - niveau bas  : rien (le rendu léger d'origine est conservé) ;
//   - niveau moyen : 512 px, couleur + relief ;
//   - niveau haut : 1024 px, couleur + relief + rugosité.
import * as THREE from 'three';

const SURFACES = {
  quay:    { set: 'paving', repeat: 1 },   // pavés en chevrons : 1 motif = 3 m (déjà l'échelle des UV du quai)
  terrain: { set: 'grass',  repeat: 2.6 }, // herbe : 1 motif ≈ 2,7 m ; la teinte reste donnée par les sommets (herbe, roche, neige)
  road:    { set: 'gravel', repeat: 1 },   // gravier : 1 motif = 2,6 m (UV posées dans city-world.js)
};

export async function applySurfaces({ world, tier, anisotropy = 4 }) {
  if (!tier || tier.name === 'low' || !world?.materials) return null;
  const res = tier.name === 'high' ? 1024 : 512, withRough = tier.name === 'high', loader = new THREE.TextureLoader();
  const load = (url, srgb, repeat) => new Promise((ok, ko) => loader.load(url, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = anisotropy;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; ok(t);
  }, undefined, ko));
  const saved = new Map();
  const jobs = Object.entries(SURFACES).map(async ([key, { set, repeat }]) => {
    const m = world.materials[key]; if (!m) return;
    const [map, normalMap, roughnessMap] = await Promise.all([
      load(`/tex-${set}-${res}-color.webp`, true, repeat), load(`/tex-${set}-${res}-normal.webp`, false, repeat),
      withRough ? load(`/tex-${set}-${res}-rough.webp`, false, repeat) : null]);
    saved.set(key, { map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap, roughness: m.roughness, color: m.color && m.color.clone() });
    m.map = map; m.normalMap = normalMap; m.roughnessMap = roughnessMap || null; m.roughness = roughnessMap ? 1 : 0.92;
    if (m.normalScale) m.normalScale.set(0.9, 0.9);
    if (key === 'road' && m.color) m.color.set('#ffffff'); // la couleur grise d'origine ne sert plus : la texture porte la couleur
    m.needsUpdate = true;
  });
  const results = await Promise.allSettled(jobs); // une texture qui échoue ne casse pas les autres
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed) console.warn(`[JexCity] ${failed} surface(s) photo non chargée(s) : rendu d'origine conservé pour celles-ci`);
  return {
    applied: [...saved.keys()],
    revert() { // retour au rendu d'origine (qualité abaissée automatiquement)
      for (const [key, o] of saved) { const m = world.materials[key]; m.map = o.map; m.normalMap = o.normalMap; m.roughnessMap = o.roughnessMap; m.roughness = o.roughness; if (o.color) m.color.copy(o.color); m.needsUpdate = true; }
      saved.clear();
    },
    setTier(t) { if (t.name === 'low') this.revert(); },
  };
}
