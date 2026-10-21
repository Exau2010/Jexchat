# JexCity — intégration à JexChat

JexCity est servie par le même serveur que JexChat, sous `/city` (page) ; les fichiers `city-*.js` et `city.css` sont servis depuis la racine par une liste blanche (même origine : le cookie de session HttpOnly `jexchat_session` existant est utilisé tel quel, rien dans l'URL).

## Lancer
```bash
npm install
npm start            # variables existantes : MONGODB_URI, PORT, FIREBASE_* (aucune nouvelle variable)
# puis ouvrir http://localhost:3000  → « Découvrir JexCity » dans la navigation, ou directement /city
npm run test:city    # tests de géométrie + tests du module serveur
```
Three.js r160 (MIT, licence dans `THREE_LICENSE.txt`) est servi localement depuis la racine (liste blanche dans `city-server.js`) : plus aucun CDN.

## Tester sur téléphone
1. Déployer en HTTPS (le cookie est `secure` en production) ou, en local, lancer sans `NODE_ENV=production` et ouvrir `http://IP-DE-L-ORDINATEUR:3000` sur le même Wi-Fi.
2. Se connecter à JexChat, toucher « Découvrir JexCity ».
3. Toucher le sol pour marcher ; glisser dans la zone « glisser ici » (bas droite) pour tourner ; pincer pour zoomer.
4. Ouvrir la console (`window.__jexcityFps`, `window.__jexcity.tier()`) pour lire le FPS et le niveau de qualité. Réglages → « Mode graphique léger » si besoin.
5. Pour voir la présence : second compte sur un autre appareil.

## Fichiers
**Créés** : `city-server.js`, `city-server_test.js`, `JEXCITY.md`, tous à la racine : `city.html`, `city.css`, `city-main.js`, `city-api.js`, `city-social.js`, `city-posts.js`, `city-ui.js`, `city-geo.js`, `city-world.js`, `city-controls.js`, `city-avatar.js`, `city-geo_test.mjs`.
**Modifiés (ajouts uniquement, 0 ligne retirée)** : `server.js` (+6 lignes : require/mount), `index.html` (+2 liens : navigation desktop et mobile), `package.json` (+1 script `test:city`). `city-world.js` : pause individuelle des bateaux ajoutée à `updateBoats`.

## Routes et événements ajoutés
`GET /api/city/config`, `POST|DELETE /api/city/mute/:id`, `POST /api/city/invite`. Socket.IO : `city:join|move|mood|ping|leave` (client) ; `city:appear|moved|mood|left` (serveur). Donnée persistante ajoutée : collection `CityMute` (références vers `User`). La présence n'est jamais écrite en base.
Réutilisé tel quel : `/api/auth/me`, `/api/users/*`, `/api/posts*`, `/api/conversations*`, `/api/notifications*`, `/api/reports`, `/api/users/block`.

## Vie privée / sécurité
- Positions diffusées uniquement aux présents visibles : rien à travers un blocage (dans les deux sens), rien pour les comptes qui masquent leur statut en ligne (ils voient sans être vus).
- Invitation = notification privée à la seule personne invitée (jamais à la ville) ; limites : 1 par personne / 30 min, 5 par 10 min ; sourdine : succès apparent sans notification.
- Texte réseau inséré en `textContent` ; médias et liens limités à https ; coordonnées et humeur validées côté serveur ; débit des événements limité.

## État
**Vérifié (exécuté)** : géométrie/déplacement (13 contrôles) ; module serveur avec dépendances simulées (présence, blocages, ghost, invitations, quotas, sourdine) ; interface (recherche, carte, profil, téléphone, conversation, invitation, notifications, réglages) dans Chromium avec API simulée, en 390×844 tactile et 1280×800 : sans erreur console ; syntaxe de tous les fichiers.
**Non vérifié** : le rendu 3D (Three.js indisponible dans l'environnement de développement), les FPS réels, l'intégration avec une vraie base MongoDB et un vrai Socket.IO, le comportement sur un vrai téléphone. Tout cela reste à tester par vous.
**Partiel** : publications portées par les bateaux + publications d'un profil (pas encore de publications ancrées à des lieux) ; « Navigateur » ouvre les sites https dans un nouvel onglet (la CSP interdit l'intégration) ; blocage pris en compte par la présence à la reconnexion ; pas d'interface d'administration JexCity ; pas encore de maisons de profil, d'événements ni de mémoire collective (architecture prête : zone `main`, module serveur séparé).
**Connu** : la scène est limitée à une zone (≈ 128 × 392 m) ; 60 avatars maximum par zone ; qualité à ajuster d'après vos captures.

## Lot 1 (publications avec médias)
`city-ui.js` : une publication de type vidéo (https) se lit dans la carte (contrôles, `playsinline`) ; image ou vidéo en erreur → repli sur le lien « Ouvrir le média ». `city.css` : style `.card video`. Vérifié dans Chromium (1280×800 et 390×844 tactile) avec API et médias simulés. Non touché : rendu 3D, backend, API, autorisations.

## Lot 2 (rendu 3D plus réaliste) — vérifié par captures dans Chromium (WebGL logiciel)
- `three.module.min.js`, `GLTFLoader.js`, `BufferGeometryUtils.js` : Three.js r160 minifié + add-ons (prêts pour des modèles GLB ; dossier `city-assets/` autorisé côté serveur, noms simples `.glb/.jpg/.png/.webp`).
- `city-textures.js` (nouveau) : façades, rez-de-chaussée, tuiles, pavés, sol — albédo + relief (normales) + rugosité + fenêtres allumées, alignés.
- `city-world.js` : matériaux physiques (niveaux mid/high), éclairage par image du ciel, pentes rocheuses du terrain, ciel (nuages, soleil, étoiles), eau à six ondes avec Fresnel. Niveau « low » : matériaux Lambert comme avant.
- `city-avatar.js` : personnage humain articulé (visage, cheveux, capuche, jean, baskets, marche avec genoux et coudes).
- `city-main.js` : tonalité cinéma (ACES), ombres douces en « high », `camera`/`controls` ajoutés au diagnostic.
**Non fait / non vérifié** : vrais modèles GLB et textures photographiques, bâtiment avec intérieur, photo de publication dans la scène, collisions verticales et pentes, commandes clavier/joystick, FPS sur vrai téléphone, serveur réel + MongoDB. Le rendu a été vu en logiciel (SwiftShader), pas sur GPU mobile.

## Lot 3 (bugs, monde ouvert, jeux, personnalisation)
Nouveaux fichiers : `city-media.js` (lecteur vidéo direct/YouTube/Vimeo), `city-look.js` (palettes de personnalisation), `city-games.js` (morpion + chat de partie). Modifiés : `city-ui.js`, `city-api.js`, `city-main.js`, `city-social.js`, `city-posts.js` (réécrit : bateaux + panneaux), `city-world.js` (relief cliquable, routes), `city-geo.js` (monde praticable), `city-avatar.js`, `city-server.js`, `city.css`, `city.html`, tests.
Nouvelles routes : `GET /api/city/search`, `POST /api/city/hide-refresh/:id`, `PUT /api/city/look` ; collection `CityLook` (une ligne d'indices par joueur). Événements : `game:*`, `city:look`. Les parties sont en mémoire (rien en base).
**Tests** : `npm run test:city` (géométrie + serveur, 59 contrôles serveur) ; interface testée dans Chromium (390×844 tactile et 1280×800), API et socket simulés, WebGL logiciel.
**Jeux d'action** (course 2 tours, tir arcade 3 vies / 60 s / 5 points) : vue de dessus en canvas, positions annoncées à ~10/s puis bornées par le serveur, touches et chrono décidés par le serveur, rien en base. **Limites** : navigateur intégré = YouTube/Vimeo seulement (CSP + protections des sites), autres sites ouverts à côté ; pas de chargement par zones (visibilité par distance, textures des panneaux à la demande) ; non vérifié sur vrai téléphone, vraie base MongoDB, vrai Socket.IO.

**Lot 5** : personnalisation étendue (haut, pantalon, chaussures, yeux, barbe, 8 coiffures, 6 accessoires, aléatoire/réinitialiser ; indices validés côté serveur) et jeux solo dans `city-solo.js` (morpion contre l'ordinateur 3 niveaux, contre-la-montre, cibles ; aucun réseau, records dans localStorage `jexcity.best.*`).
