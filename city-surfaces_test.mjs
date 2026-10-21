// Test de city-surfaces.js : node city-surfaces_test.mjs — sans navigateur ni dépendance (three.js local, chargeur de textures simulé).
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,n){ if (s==='three') return { url: ${JSON.stringify(pathToFileURL(here + 'three.module.min.js').href)}, shortCircuit: true }; return n(s,c); }`));
const THREE = await import('three'); const { applySurfaces } = await import('./city-surfaces.js');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.error('ÉCHEC :', m); } else console.log('ok   :', m); };
const mk = () => ({ quay: new THREE.MeshStandardMaterial({ roughness: 0.8 }), terrain: new THREE.MeshStandardMaterial({ roughness: 0.9 }), road: new THREE.MeshStandardMaterial({ color: '#77746c', roughness: 0.95 }) });
const orig = THREE.TextureLoader.prototype.load; let urls = [], failRe = null;
THREE.TextureLoader.prototype.load = function (url, onLoad, p, onErr) { urls.push(url); if (failRe && failRe.test(url)) return onErr(new Error('réseau')); onLoad(new THREE.Texture()); };
{ const world = { materials: mk() }; urls = []; const s = await applySurfaces({ world, tier: { name: 'low' } }); ok(s === null && !urls.length && !world.materials.quay.map, 'niveau bas : rien n’est chargé'); }
{ const world = { materials: mk() }; urls = []; const s = await applySurfaces({ world, tier: { name: 'mid' } });
  ok(urls.length === 6 && urls.every((u) => /-512-(color|normal)\.webp$/.test(u)), `niveau moyen : 6 fichiers 512 px (couleur + relief), ${urls.length} demandés`);
  ok(!world.materials.quay.roughnessMap && world.materials.road.color.getHexString() === 'ffffff', 'moyen : pas de rugosité ; la route perd sa teinte grise (la texture porte la couleur)'); s.revert(); ok(world.materials.road.color.getHexString() === '77746c' && !world.materials.road.map, 'retour à l’état d’origine, teinte comprise'); }
{ const world = { materials: mk() }; urls = []; const s = await applySurfaces({ world, tier: { name: 'high' }, anisotropy: 8 });
  ok(urls.length === 9 && urls.every((u) => /-1024-/.test(u)), 'niveau haut : 9 fichiers 1024 px (couleur + relief + rugosité)');
  const t = world.materials.terrain; ok(t.map.anisotropy === 8 && t.map.wrapS === THREE.RepeatWrapping && t.map.colorSpace === THREE.SRGBColorSpace && t.normalMap.colorSpace === THREE.NoColorSpace, 'filtrage anisotrope, répétition, espaces colorimétriques corrects');
  s.setTier({ name: 'low' }); ok(!world.materials.terrain.map, 'qualité abaissée automatiquement → rendu d’origine'); }
{ const world = { materials: mk() }; urls = []; failRe = /gravel/; const warn = console.warn; console.warn = () => {}; const s = await applySurfaces({ world, tier: { name: 'high' } }); console.warn = warn; failRe = null;
  ok(s.applied.length === 2 && !!world.materials.quay.map && !world.materials.road.map, 'une texture introuvable ne casse pas les autres'); }
THREE.TextureLoader.prototype.load = orig;
console.log(fails ? `\n${fails} échec(s)` : '\nTous les tests passent'); process.exit(fails ? 1 : 0);
