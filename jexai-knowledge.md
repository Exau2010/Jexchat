# JexChat — documentation interne pour JexAi (vérifiée sur le dépôt)
Stack : Node.js ≥18, Express 5, Socket.IO, MongoDB (mongoose), Firebase Admin (notifications push FCM). Interface : index.html + app.js + jexchat.css (page unique). Authentification par session (cookie ou en-tête X-Session-Token). Rôles côté serveur : ADMIN, OWNER, MODERATOR.
## Fonctionnalités confirmées
- Messages : conversations privées et de groupe ; membres et nom de groupe modifiables, fond de conversation personnalisable.
- Amis / recherche : recherche d'utilisateurs, liste des utilisateurs en ligne, blocage et déblocage.
- Publications (fil d'actualité) et notifications (temps réel + push).
- Paramètres : changer le nom d'utilisateur, le mot de passe, gérer/déconnecter ses sessions, supprimer son compte (irréversible).
- Stories : éphémères, visibles 24 h ; texte, image, vidéo ou audio via un lien (https) ; jusqu'à 12 éléments par story (texte déplaçable, redimensionnable, rotation, opacité, bordure, ombre, fond, calques) ; fond coloré ; nombre de vues visible par l'auteur ; suppression par l'auteur ou un modérateur.
- JexCity : monde 3D (Three.js) accessible via /city.
## Limites connues (à ne pas inventer au-delà)
- L'envoi de fichiers photo/vidéo depuis l'appareil dans l'éditeur de stories n'est pas confirmé : les médias passent par des liens.
- Musique, sondage, localisation, stickers et dessin dans les stories : non confirmés sauf indication contraire de cette documentation.
