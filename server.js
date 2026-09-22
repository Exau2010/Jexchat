'use strict';

require('dotenv').config();

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');

const db = require('./database.js');
const sec = require('./security.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  pingTimeout: 30000,
  pingInterval: 25000,
});

const PORT = process.env.PORT || 3000;

// ─── Firebase Admin ────────────────────────────────────────────────────────────
let firebaseMessaging = null;
try {
  const admin = require('firebase-admin');
  const existingApps = admin.apps;
  if (!existingApps || existingApps.length === 0) {
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    // Only init if we have real service account credentials (PEM format)
    if (
      process.env.FIREBASE_CLIENT_EMAIL &&
      typeof process.env.FIREBASE_CLIENT_EMAIL === 'string' &&
      process.env.FIREBASE_CLIENT_EMAIL.includes('@') &&
      privateKey.includes('-----BEGIN')
    ) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey,
        }),
      });
      firebaseMessaging = admin.messaging();
      console.log('[FCM] Firebase Admin initialized');
    } else {
      console.log('[FCM] Firebase Admin skipped (no PEM private key found)');
    }
  }
} catch (err) {
  console.warn('[FCM] Firebase Admin skipped:', err.message);
}

// userId : propriétaire des tokens, pour pouvoir nettoyer en une seule
// opération groupée ($pull/$in) les tokens que Firebase signale comme
// invalides/expirés/désinscrits, sans jamais faire une requête par token.
async function sendPushNotification(userId, tokens, title, body, data = {}) {
  if (!firebaseMessaging || !tokens || tokens.length === 0) return;
  const validTokens = tokens.filter((t) => typeof t === 'string' && t.length > 10);
  if (validTokens.length === 0) return;
  try {
    const message = {
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      tokens: validTokens,
    };
    const result = await firebaseMessaging.sendEachForMulticast(message);
    if (result.failureCount > 0 && userId) {
      const deadTokens = [];
      result.responses.forEach((r, i) => {
        if (r.success) return;
        const code = r.error?.code || '';
        if (code === 'messaging/invalid-registration-token' || code === 'messaging/registration-token-not-registered') {
          deadTokens.push(validTokens[i]);
        }
      });
      if (deadTokens.length > 0) await db.removeFcmTokens(userId, deadTokens);
    }
  } catch (err) {
    console.warn('[FCM] Push error:', err.message);
  }
}

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(sec.securityHeaders);
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(cookieParser());
app.use(sec.apiLimiter);

// Serve static files (CSS, JS frontend, logo)
const staticFiles = ['/style.css', '/script.js', '/logo.png'];
staticFiles.forEach(file => {
  app.get(file, (req, res) => {
    const maxAge = file.endsWith('.png') ? 86400 : (file.endsWith('.css') || file.endsWith('.js') ? 3600 : 0);
    res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
    res.sendFile(path.join(__dirname, file));
  });
});

// ─── Firebase Messaging Service Worker (config injectée au runtime) ──────────
// Ce fichier ne peut plus être servi tel quel (fichier statique) car il a
// besoin de la config Firebase (clés publiques web, non secrètes) pour
// s'initialiser lui-même dès son démarrage — y compris quand le navigateur le
// relance en arrière-plan pour traiter un push alors qu'aucun onglet JEXCHAT
// n'est ouvert. Avant ce correctif, la config n'était transmise qu'au SW
// depuis la page cliente via postMessage, ce qui échouait silencieusement
// (SW pas encore "active", ou tout simplement aucune page ouverte) : c'était
// la cause principale de l'échec des notifications hors site.
let swFileCache = null;
app.get('/firebase-messaging-sw.js', (req, res) => {
  try {
    if (!swFileCache) swFileCache = fs.readFileSync(path.join(__dirname, 'firebase-messaging-sw.js'), 'utf8');
    const cfg = {
      apiKey: process.env.FIREBASE_WEB_API_KEY || '',
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
      projectId: process.env.FIREBASE_PROJECT_ID || '',
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
      appId: process.env.FIREBASE_APP_ID || '',
    };
    const content = swFileCache.replace('"__FIREBASE_CONFIG__"', JSON.stringify(cfg));
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    // Jamais de cache long ici : si la config change (rotation de projet
    // Firebase), le SW doit récupérer la nouvelle version rapidement.
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Service-Worker-Allowed', '/');
    return res.send(content);
  } catch (err) {
    console.error('[FCM] SW serve error:', err.message);
    return res.status(500).send('// SW load error');
  }
});

// ─── Routes: Static Pages ──────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/messages', (req, res) => res.sendFile(path.join(__dirname, 'messages.html')));
app.get('/settings', (req, res) => res.sendFile(path.join(__dirname, 'settings.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/informations', (req, res) => res.sendFile(path.join(__dirname, 'informations.html')));

// ─── Shareable Links (profile / post) ──────────────────────────────────────────
// Routes légères : la même page messages.html est servie (l'app est déjà
// authentifiée côté client), qui lit ensuite l'URL pour ouvrir directement le
// profil ou la publication visée — sans route serveur dédiée ni duplication
// de template. On y injecte seulement les balises meta Open Graph
// nécessaires pour un aperçu correct (titre/description/image) quand le
// lien est partagé sur WhatsApp/Facebook/etc., sans bibliothèque de rendu.
let messagesHtmlCache = null;
function getMessagesHtml() {
  if (!messagesHtmlCache) messagesHtmlCache = fs.readFileSync(path.join(__dirname, 'messages.html'), 'utf8');
  return messagesHtmlCache;
}

function injectOgTags(html, { title, description, image, url, type = 'website' }) {
  const tags = [
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:site_name" content="JEXCHAT">`,
    `<meta property="og:title" content="${sec.escapeHtml(title)}">`,
    `<meta property="og:description" content="${sec.escapeHtml(description)}">`,
    `<meta property="og:url" content="${sec.escapeHtml(url)}">`,
    image ? `<meta property="og:image" content="${sec.escapeHtml(image)}">` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
  ].filter(Boolean).join('\n  ');
  return html.replace('</head>', `  ${tags}\n</head>`);
}

app.get('/lapage/:pseudo', async (req, res) => {
  try {
    const uResult = sec.validateUsername(req.params.pseudo);
    const user = uResult.valid ? await db.findUserByUsername(uResult.value) : null;
    if (!user) return res.sendFile(path.join(__dirname, 'messages.html'));
    const html = injectOgTags(getMessagesHtml(), {
      title: `${user.username} sur JEXCHAT`,
      description: `Découvrez le profil de ${user.username} sur JEXCHAT.`,
      url: `${req.protocol}://${req.get('host')}/lapage/${encodeURIComponent(user.username)}`,
      type: 'profile',
    });
    res.send(html);
  } catch (err) {
    res.sendFile(path.join(__dirname, 'messages.html'));
  }
});

app.get('/lapage/:pseudo/actu/:postId', async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.postId)) return res.sendFile(path.join(__dirname, 'messages.html'));
    const post = await db.getPostById(req.params.postId);
    if (!post) return res.sendFile(path.join(__dirname, 'messages.html'));
    const author = await db.findUserById(post.authorId);
    const html = injectOgTags(getMessagesHtml(), {
      title: `Publication de ${author?.username || 'un utilisateur'} sur JEXCHAT`,
      description: (post.content || 'Voir cette publication sur JEXCHAT.').substring(0, 200),
      image: post.mediaType === 'image' ? post.mediaUrl : null,
      url: `${req.protocol}://${req.get('host')}/lapage/${encodeURIComponent(req.params.pseudo)}/actu/${post._id}`,
    });
    res.send(html);
  } catch (err) {
    res.sendFile(path.join(__dirname, 'messages.html'));
  }
});

// ─── Auth Routes ───────────────────────────────────────────────────────────────
app.post('/api/auth/register', sec.authLimiter, async (req, res) => {
  try {
    const uResult = sec.validateUsername(req.body.username);
    if (!uResult.valid) return res.status(400).json({ error: uResult.error });
    const pResult = sec.validatePassword(req.body.password);
    if (!pResult.valid) return res.status(400).json({ error: pResult.error });

    const existing = await db.findUserByUsername(uResult.value);
    if (existing) return res.status(409).json({ error: 'Ce pseudo est déjà utilisé.' });

    const passwordHash = await bcrypt.hash(req.body.password, 12);
    const user = await db.createUser(uResult.value, passwordHash, {});
    const identity = db.generateIdentity(user._id.toString());
    await db.User.updateOne({ _id: user._id }, { identity });

    const token = sec.generateSecureToken();
    const deviceInfo = sec.sanitizeText(req.headers['user-agent'] || '').substring(0, 200);
    await db.createSession(user._id, token, deviceInfo, req.ip || '');

    res.cookie('jexchat_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return res.status(201).json({
      user: {
        id: user._id,
        username: user.username,
        identity: { ...identity },
        roles: user.roles,
      },
      token,
    });
  } catch (err) {
    console.error('[Auth] Register error:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la création du compte.' });
  }
});

app.post('/api/auth/login', sec.authLimiter, async (req, res) => {
  try {
    const uResult = sec.validateUsername(req.body.username);
    if (!uResult.valid) return res.status(400).json({ error: uResult.error });
    if (!req.body.password) return res.status(400).json({ error: 'Mot de passe requis.' });

    const user = await db.findUserByUsername(uResult.value);
    if (!user) return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect.' });
    if (user.isBanned) return res.status(403).json({ error: 'Compte banni.' });
    if (user.isSuspended) return res.status(403).json({ error: 'Compte suspendu.' });

    const match = await bcrypt.compare(req.body.password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect.' });

    const token = sec.generateSecureToken();
    const deviceInfo = sec.sanitizeText(req.headers['user-agent'] || '').substring(0, 200);
    await db.createSession(user._id, token, deviceInfo, req.ip || '');

    res.cookie('jexchat_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    const freshUser = await db.findUserById(user._id);
    return res.json({
      user: {
        id: freshUser._id,
        username: freshUser.username,
        identity: freshUser.identity,
        roles: freshUser.roles,
        settings: freshUser.settings,
      },
      token,
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    return res.status(500).json({ error: 'Erreur de connexion.' });
  }
});

app.post('/api/auth/logout', sec.requireAuth, async (req, res) => {
  try {
    const token = req.cookies?.jexchat_session || req.headers['x-session-token'];
    await db.deleteSession(token);
    res.clearCookie('jexchat_session');
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur de déconnexion.' });
  }
});

app.get('/api/auth/me', sec.requireAuth, async (req, res) => {
  const user = req.user;
  return res.json({
    id: user._id,
    username: user.username,
    identity: user.identity,
    roles: user.roles,
    settings: user.settings,
    createdAt: user.createdAt,
  });
});

// ─── Session Routes ────────────────────────────────────────────────────────────
app.get('/api/sessions', sec.requireAuth, async (req, res) => {
  try {
    const sessions = await db.getUserSessions(req.user._id);
    const currentToken = req.cookies?.jexchat_session || req.headers['x-session-token'];
    return res.json(
      sessions.map((s) => ({
        id: s._id,
        deviceInfo: s.deviceInfo,
        ipAddress: s.ipAddress,
        createdAt: s.createdAt,
        lastActive: s.lastActive,
        current: s.token === currentToken,
      }))
    );
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.delete('/api/sessions/:id', sec.requireAuth, async (req, res) => {
  try {
    const session = await db.Session.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ error: 'Session introuvable.' });
    await db.deleteSession(session.token);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.delete('/api/sessions', sec.requireAuth, async (req, res) => {
  try {
    await db.deleteAllUserSessions(req.user._id);
    res.clearCookie('jexchat_session');
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

// ─── User Routes ───────────────────────────────────────────────────────────────
app.get('/api/users/online', sec.requireAuth, async (req, res) => {
  try {
    const users = await db.getOnlineUsers(30);
    return res.json(users.map(safeUser));
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.get('/api/users/search', sec.requireAuth, sec.searchLimiter, async (req, res) => {
  try {
    const q = sec.sanitizeText(req.query.q || '');
    if (q.length < 1) return res.json([]);
    const users = await db.searchUsers(q, 20);
    return res.json(users.map(safeUser));
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

// Résolution pseudo -> profil, utilisée par les liens de profil partageables
// (/lapage/pseudo). Distincte de /api/users/:id (ObjectId Mongo).
// Route publique : accessible sans connexion pour qu'un lien de profil
// partagé (/lapage/pseudo) affiche réellement son contenu à un visiteur non
// connecté. Personnalisée (likedByMe, etc.) seulement si connecté.
app.get('/api/users/by-username/:username', sec.optionalAuth, async (req, res) => {
  try {
    const uResult = sec.validateUsername(req.params.username);
    if (!uResult.valid) return res.status(400).json({ error: 'Pseudo invalide.' });
    const user = await db.findUserByUsername(uResult.value);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    return res.json(safeUser(user));
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

// Publique : nécessaire pour qu'un profil ouvert depuis un lien /lapage/pseudo
// partagé s'affiche aussi pour un visiteur non connecté.
app.get('/api/users/:id', sec.optionalAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const user = await db.findUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    return res.json(safeUser(user));
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.post('/api/users/block/:id', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    if (req.params.id === req.user._id.toString()) return res.status(400).json({ error: 'Action invalide.' });
    await db.blockUser(req.user._id, req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.post('/api/users/unblock/:id', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    await db.unblockUser(req.user._id, req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.get('/api/users/blocked/list', sec.requireAuth, async (req, res) => {
  try {
    const user = await db.findUserById(req.user._id);
    if (!user.blockedUsers?.length) return res.json([]);
    const blocked = await db.findUsersByIds(user.blockedUsers);
    return res.json(blocked.map(safeUser));
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

// ─── Settings Routes ───────────────────────────────────────────────────────────
app.put('/api/settings', sec.requireAuth, async (req, res) => {
  try {
    const { theme, accentColor, notifications, messageFont, privacy } = req.body;
    const settings = {};
    if (theme !== undefined) settings['settings.theme'] = ['light', 'dark'].includes(theme) ? theme : 'light';
    if (accentColor !== undefined && /^#[0-9a-f]{6}$/i.test(accentColor)) {
      settings['settings.accentColor'] = accentColor;
    }
    if (notifications !== undefined) settings['settings.notifications'] = Boolean(notifications);
    if (messageFont !== undefined) settings['settings.messageFont'] = ['default', 'rounded', 'mono'].includes(messageFont) ? messageFont : 'default';
    if (privacy !== undefined && typeof privacy === 'object') {
      if (privacy.showOnlineStatus !== undefined) settings['settings.privacy.showOnlineStatus'] = Boolean(privacy.showOnlineStatus);
      if (privacy.showLastSeen !== undefined) settings['settings.privacy.showLastSeen'] = Boolean(privacy.showLastSeen);
    }
    await db.User.updateOne({ _id: req.user._id }, { $set: settings });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.put('/api/settings/password', sec.requireAuth, sec.authLimiter, async (req, res) => {
  try {
    const user = await db.findUserByUsername(req.user.username);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    const match = await bcrypt.compare(req.body.currentPassword || '', user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
    const pResult = sec.validatePassword(req.body.newPassword || '');
    if (!pResult.valid) return res.status(400).json({ error: pResult.error });
    const hash = await bcrypt.hash(req.body.newPassword, 12);
    await db.updateUserPassword(req.user._id, hash);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.put('/api/settings/username', sec.requireAuth, sec.authLimiter, async (req, res) => {
  try {
    const uResult = sec.validateUsername(req.body.username);
    if (!uResult.valid) return res.status(400).json({ error: uResult.error });
    const existing = await db.findUserByUsername(uResult.value);
    if (existing && existing._id.toString() !== req.user._id.toString()) {
      return res.status(409).json({ error: 'Ce pseudo est déjà utilisé.' });
    }
    await db.updateUsername(req.user._id, uResult.value);
    return res.json({ ok: true, username: uResult.value });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.delete('/api/settings/account', sec.requireAuth, sec.authLimiter, async (req, res) => {
  try {
    const user = await db.findUserByUsername(req.user.username);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    const match = await bcrypt.compare(req.body.password || '', user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Mot de passe incorrect.' });

    const userId = req.user._id.toString();
    const { affectedGroupIds, deletedPrivateConvIds, notifyOtherUserIds } = await db.deleteUserAccount(req.user._id);

    // Notifie en temps réel les groupes restants (nouvelle liste de membres)
    for (const convId of affectedGroupIds) {
      const updated = await db.getConversationById(convId);
      if (!updated) continue;
      const enriched = await enrichConversations([updated], '');
      for (const m of updated.members) {
        io.to(`user:${m.toString()}`).emit('group_updated', enriched[0]);
      }
    }
    // Notifie les interlocuteurs des conversations privées supprimées
    for (let i = 0; i < deletedPrivateConvIds.length; i++) {
      io.to(`user:${notifyOtherUserIds[i]}`).emit('conversation_deleted', { conversationId: deletedPrivateConvIds[i] });
    }
    // Informe le compte lui-même (autres onglets/appareils) puis coupe ses sockets
    io.to(`user:${userId}`).emit('account_deleted', {});
    io.in(`user:${userId}`).disconnectSockets(true);
    io.emit('user_offline', { userId, lastSeen: new Date() });
    onlineUsers.delete(userId);

    res.clearCookie('jexchat_session');
    return res.json({ ok: true });
  } catch (err) {
    console.error('[Account] Delete error:', err.message);
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.post('/api/fcm/token', sec.requireAuth, async (req, res) => {
  try {
    const token = req.body.token;
    if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Token invalide.' });
    await db.addFcmToken(req.user._id, token);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.delete('/api/fcm/token', sec.requireAuth, async (req, res) => {
  try {
    const token = req.body.token;
    if (token) await db.removeFcmToken(req.user._id, token);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

// ─── Conversation Routes ───────────────────────────────────────────────────────
app.get('/api/conversations', sec.requireAuth, async (req, res) => {
  try {
    const skip = parseInt(req.query.skip) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 30, 50);
    const convs = await db.getUserConversations(req.user._id, skip, limit);
    const enriched = await enrichConversations(convs, req.user._id.toString());
    return res.json(enriched);
  } catch (err) {
    console.error('[Conversations]', err.message);
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.post('/api/conversations/private', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.body.userId)) return res.status(400).json({ error: 'ID invalide.' });
    if (req.body.userId === req.user._id.toString()) return res.status(400).json({ error: 'Action invalide.' });

    const target = await db.findUserById(req.body.userId);
    if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    const me = await db.findUserById(req.user._id);
    if (me.blockedUsers?.map(String).includes(req.body.userId)) {
      return res.status(403).json({ error: 'Vous avez bloqué cet utilisateur.' });
    }
    if (target.blockedUsers?.map(String).includes(req.user._id.toString())) {
      return res.status(403).json({ error: 'Action non autorisée.' });
    }

    const conv = await db.findOrCreatePrivateConversation(req.user._id, req.body.userId);
    const enriched = await enrichConversations([conv], req.user._id.toString());
    return res.json(enriched[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.post('/api/conversations/group', sec.requireAuth, async (req, res) => {
  try {
    const nameResult = sec.validateGroupName(req.body.name);
    if (!nameResult.valid) return res.status(400).json({ error: nameResult.error });

    const memberIds = req.body.memberIds;
    if (!Array.isArray(memberIds) || memberIds.length < 1) {
      return res.status(400).json({ error: 'Sélectionnez au moins un membre.' });
    }
    if (memberIds.length > 50) return res.status(400).json({ error: 'Trop de membres.' });

    const validIds = memberIds.filter((id) => sec.isValidObjectId(id) && id !== req.user._id.toString());
    if (validIds.length === 0) return res.status(400).json({ error: 'Membres invalides.' });

    const conv = await db.createGroupConversation(nameResult.value, req.user._id, validIds);
    const enriched = await enrichConversations([conv], req.user._id.toString());
    const result = enriched[0];

    // Notify members
    for (const memberId of validIds) {
      io.to(`user:${memberId}`).emit('group_created', result);
    }
    io.to(`user:${req.user._id}`).emit('group_created', result);

    return res.status(201).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.get('/api/conversations/:id', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const conv = await db.getConversationById(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation introuvable.' });
    if (!conv.members.map(String).includes(req.user._id.toString())) {
      return res.status(403).json({ error: 'Accès non autorisé.' });
    }
    const enriched = await enrichConversations([conv], req.user._id.toString());
    return res.json(enriched[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.put('/api/conversations/:id/background', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const conv = await db.getConversationById(req.params.id);
    if (!conv || !conv.members.map(String).includes(req.user._id.toString())) {
      return res.status(403).json({ error: 'Accès non autorisé.' });
    }
    const { type, value } = req.body;
    const allowedTypes = ['color', 'gradient', 'image', 'pattern', 'none'];
    if (!allowedTypes.includes(type)) return res.status(400).json({ error: 'Type invalide.' });

    let safeValue = '';
    if (type === 'image') {
      const urlResult = sec.validateImageUrl(value);
      if (!urlResult.valid) return res.status(400).json({ error: urlResult.error });
      safeValue = urlResult.value;
    } else if (type === 'color' || type === 'gradient') {
      safeValue = sec.sanitizeText(value).substring(0, 100);
    } else if (type === 'pattern') {
      safeValue = ['dots', 'lines', 'grid', 'waves', 'bubbles'].includes(value) ? value : 'none';
    }

    const background = { type, value: safeValue };
    await db.updateConversationBackground(req.params.id, background);

    // Notify members
    for (const memberId of conv.members) {
      io.to(`user:${memberId.toString()}`).emit('background_changed', {
        conversationId: req.params.id,
        background,
      });
    }
    return res.json({ ok: true, background });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.post('/api/conversations/:id/members', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const conv = await db.getConversationById(req.params.id);
    if (!conv || conv.type !== 'group') return res.status(404).json({ error: 'Groupe introuvable.' });
    // Tous les membres du groupe peuvent ajouter des membres (règle appliquée
    // côté serveur, pas seulement dans l'interface) — seule la suppression
    // d'un membre reste réservée aux administrateurs (voir route DELETE ci-dessous).
    const isMember = conv.members?.map(String).includes(req.user._id.toString());
    if (!isMember) return res.status(403).json({ error: 'Droits insuffisants.' });
    if (!sec.isValidObjectId(req.body.userId)) return res.status(400).json({ error: 'ID invalide.' });
    await db.addMemberToGroup(req.params.id, req.body.userId);
    const updated = await db.getConversationById(req.params.id);
    const enriched = await enrichConversations([updated], req.user._id.toString());
    for (const m of updated.members) io.to(`user:${m.toString()}`).emit('group_updated', enriched[0]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.delete('/api/conversations/:id/members/:userId', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id) || !sec.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'ID invalide.' });
    }
    const conv = await db.getConversationById(req.params.id);
    if (!conv || conv.type !== 'group') return res.status(404).json({ error: 'Groupe introuvable.' });
    const isAdmin = conv.admins?.map(String).includes(req.user._id.toString());
    const isSelf = req.params.userId === req.user._id.toString();
    const isOwner = conv.owner?.toString() === req.user._id.toString();
    if (!isAdmin && !isSelf) return res.status(403).json({ error: 'Droits insuffisants.' });
    if (!isOwner && !isSelf && conv.owner?.toString() === req.params.userId) {
      return res.status(403).json({ error: 'Impossible de retirer le propriétaire.' });
    }
    await db.removeMemberFromGroup(req.params.id, req.params.userId);
    const updated = await db.getConversationById(req.params.id);
    const enriched = await enrichConversations([updated], req.user._id.toString());
    for (const m of updated.members) io.to(`user:${m.toString()}`).emit('group_updated', enriched[0]);
    io.to(`user:${req.params.userId}`).emit('removed_from_group', { conversationId: req.params.id });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.put('/api/conversations/:id/name', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const conv = await db.getConversationById(req.params.id);
    if (!conv || conv.type !== 'group') return res.status(404).json({ error: 'Groupe introuvable.' });
    const isAdmin = conv.admins?.map(String).includes(req.user._id.toString());
    if (!isAdmin) return res.status(403).json({ error: 'Droits insuffisants.' });
    const nameResult = sec.validateGroupName(req.body.name);
    if (!nameResult.valid) return res.status(400).json({ error: nameResult.error });
    await db.updateGroupName(req.params.id, nameResult.value);
    for (const m of conv.members) {
      io.to(`user:${m.toString()}`).emit('group_updated', { conversationId: req.params.id, name: nameResult.value });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

// Suppression complète et définitive d'un groupe (distinct de "quitter le
// groupe", qui ne retire que l'utilisateur courant — voir la route DELETE
// members/:userId ci-dessus). Réservé au propriétaire du groupe.
app.delete('/api/conversations/:id', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const conv = await db.getConversationById(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation introuvable.' });
    const isOwner = conv.type === 'group' && conv.owner?.toString() === req.user._id.toString();
    // Contrôle total pour la modération : un admin/owner (et le modérateur,
    // au même niveau que pour les messages/publications) peut supprimer
    // n'importe quelle conversation, privée ou de groupe, pas seulement le
    // propriétaire d'un groupe.
    const isAdmin = req.user.roles?.some((r) => ['ADMIN', 'OWNER', 'MODERATOR'].includes(r));
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Seul le propriétaire ou un administrateur peut supprimer cette conversation.' });

    const memberIds = conv.members.map((m) => m.toString());
    await db.deleteGroupConversation(req.params.id);

    // Informe tous les membres immédiatement, sans refresh (réutilise le même
    // événement que la suppression de conversation privée lors de la
    // suppression de compte, déjà géré côté client).
    for (const mid of memberIds) {
      io.to(`user:${mid}`).emit('conversation_deleted', { conversationId: req.params.id });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[Conversations] delete group', err.message);
    return res.status(500).json({ error: 'Erreur.' });
  }
});

// ─── Message Routes ────────────────────────────────────────────────────────────
app.get('/api/conversations/:id/messages', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const conv = await db.getConversationById(req.params.id);
    if (!conv || !conv.members.map(String).includes(req.user._id.toString())) {
      return res.status(403).json({ error: 'Accès non autorisé.' });
    }
    const before = req.query.before || null;
    const limit = Math.min(parseInt(req.query.limit) || 30, 50);
    const messages = await db.getMessages(req.params.id, before, limit);
    return res.json(await enrichMessages(messages));
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.post('/api/conversations/:id/messages', sec.requireAuth, sec.messageLimiter, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const conv = await db.getConversationById(req.params.id);
    if (!conv || !conv.members.map(String).includes(req.user._id.toString())) {
      return res.status(403).json({ error: 'Accès non autorisé.' });
    }

    const { content, type, url, replyTo, sharedPostId } = req.body;
    const msgType = type || 'text';
    const typeResult = sec.validateMessageType(msgType);
    if (!typeResult.valid) return res.status(400).json({ error: typeResult.error });

    let safeContent = '';
    let safeUrl = '';
    let safeSharedPostId = null;

    if (msgType === 'text') {
      const contentResult = sec.validateMessage(content);
      if (!contentResult.valid) return res.status(400).json({ error: contentResult.error });
      safeContent = contentResult.value;
    } else if (['image', 'video', 'audio', 'link', 'sticker'].includes(msgType)) {
      const urlResult = sec.validateUrl(url || content);
      if (!urlResult.valid) return res.status(400).json({ error: urlResult.error });
      safeUrl = urlResult.value;
      safeContent = sec.sanitizeText(content || '').substring(0, 200);
    } else if (msgType === 'note') {
      const contentResult = sec.validateMessage(content);
      if (!contentResult.valid) return res.status(400).json({ error: contentResult.error });
      safeContent = contentResult.value;
    } else if (msgType === 'shared_post') {
      // Partage référencé uniquement : jamais de duplication du contenu ou du
      // média de la publication d'origine, seulement son identifiant.
      if (!sec.isValidObjectId(sharedPostId)) return res.status(400).json({ error: 'Publication invalide.' });
      const post = await db.getPostById(sharedPostId);
      if (!post) return res.status(404).json({ error: 'Publication introuvable.' });
      // Toujours référencer la publication racine (jamais un partage d'un partage).
      safeSharedPostId = post.sharedFrom ? post.sharedFrom.toString() : post._id.toString();
      safeContent = sec.sanitizeText(content || '').substring(0, 300);
    }

    let replyToId = null;
    if (replyTo && sec.isValidObjectId(replyTo)) {
      const replyMsg = await db.getMessageById(replyTo);
      if (replyMsg && replyMsg.conversationId.toString() === req.params.id) {
        replyToId = replyTo;
      }
    }

    const msgData = {
      conversationId: req.params.id,
      senderId: req.user._id,
      content: safeContent,
      type: msgType,
      url: safeUrl,
      sharedPostId: safeSharedPostId,
      replyTo: replyToId,
      seenBy: [req.user._id],
    };

    const message = await db.createMessage(msgData);
    if (safeSharedPostId) await db.incrementPostShares(safeSharedPostId);
    await db.updateConversationLastMessage(req.params.id, {
      content: msgType === 'shared_post' ? (safeContent || 'a partagé une publication') : (safeContent || safeUrl || msgType),
      senderId: req.user._id,
      type: msgType,
      createdAt: message.createdAt,
    });

    const sender = await db.findUserById(req.user._id);
    const [msgOutBase] = (safeSharedPostId || replyToId) ? await enrichMessages([message]) : [safeMessage(message)];
    const msgOut = {
      ...msgOutBase,
      sender: safeUser(sender),
    };

    // Emit to all members
    for (const memberId of conv.members) {
      const mid = memberId.toString();
      io.to(`user:${mid}`).emit('new_message', msgOut);
      if (mid !== req.user._id.toString()) {
        await db.incrementUnread(req.params.id, mid);
        // Notification (sauf si le destinataire a déjà cette conversation
        // ouverte : il voit le message arriver en direct via 'new_message').
        const member = await db.findUserById(mid);
        if (member && member.settings?.notifications !== false && !isMemberViewingConv(mid, req.params.id)) {
          await db.createNotification({
            userId: mid,
            type: 'message',
            fromUserId: req.user._id,
            conversationId: req.params.id,
            messageId: message._id,
            content: `${req.user.username}: ${safeContent || msgType}`.substring(0, 100),
          });
          io.to(`user:${mid}`).emit('notification', { count: 1 });
          // Push notification
          if (member.fcmTokens?.length) {
            await sendPushNotification(
              mid,
              member.fcmTokens,
              req.user.username,
              safeContent || `Nouveau ${msgType}`,
              { conversationId: req.params.id }
            );
          }
        }
      }
    }

    return res.status(201).json(msgOut);
  } catch (err) {
    console.error('[Message]', err.message);
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.put('/api/messages/:id', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const message = await db.getMessageById(req.params.id);
    if (!message) return res.status(404).json({ error: 'Message introuvable.' });
    if (message.senderId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Vous ne pouvez modifier que vos propres messages.' });
    }
    if (new Date(message.expiresAt) < new Date()) {
      return res.status(403).json({ error: 'Ce message a expiré.' });
    }
    const contentResult = sec.validateMessage(req.body.content);
    if (!contentResult.valid) return res.status(400).json({ error: contentResult.error });
    await db.editMessage(req.params.id, contentResult.value);
    const updated = await db.getMessageById(req.params.id);
    const conv = await db.getConversationById(message.conversationId);
    if (conv) {
      for (const m of conv.members) {
        io.to(`user:${m.toString()}`).emit('message_edited', safeMessage(updated));
      }
    }
    return res.json(safeMessage(updated));
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.delete('/api/messages/:id', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const message = await db.getMessageById(req.params.id);
    if (!message) return res.status(404).json({ error: 'Message introuvable.' });
    const conv = await db.getConversationById(message.conversationId);
    if (!conv) return res.status(404).json({ error: 'Conversation introuvable.' });
    const isOwner = message.senderId.toString() === req.user._id.toString();
    const isAdmin = req.user.roles?.some((r) => ['ADMIN', 'MODERATOR', 'OWNER'].includes(r));
    const isGroupAdmin = conv.type === 'group' && conv.admins?.map(String).includes(req.user._id.toString());
    if (!isOwner && !isAdmin && !isGroupAdmin) {
      return res.status(403).json({ error: 'Accès non autorisé.' });
    }
    await db.deleteMessage(req.params.id);
    for (const m of conv.members) {
      io.to(`user:${m.toString()}`).emit('message_deleted', { messageId: req.params.id, conversationId: message.conversationId });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.post('/api/messages/:id/react', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const message = await db.getMessageById(req.params.id);
    if (!message) return res.status(404).json({ error: 'Message introuvable.' });
    if (new Date(message.expiresAt) < new Date()) return res.status(403).json({ error: 'Message expiré.' });
    const typeResult = sec.validateReactionType(req.body.type);
    if (!typeResult.valid) return res.status(400).json({ error: typeResult.error });
    const existing = message.reactions?.find((r) => r.userId.toString() === req.user._id.toString());
    if (existing && existing.type === req.body.type) {
      await db.removeReaction(req.params.id, req.user._id);
    } else {
      await db.addReaction(req.params.id, req.user._id, req.body.type);
    }
    const updated = await db.getMessageById(req.params.id);
    const conv = await db.getConversationById(message.conversationId);
    if (conv) {
      for (const m of conv.members) {
        io.to(`user:${m.toString()}`).emit('message_reaction', safeMessage(updated));
      }
    }
    return res.json(safeMessage(updated));
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.post('/api/messages/:id/pin', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const message = await db.getMessageById(req.params.id);
    if (!message) return res.status(404).json({ error: 'Message introuvable.' });
    const conv = await db.getConversationById(message.conversationId);
    if (!conv || !conv.members.map(String).includes(req.user._id.toString())) {
      return res.status(403).json({ error: 'Accès non autorisé.' });
    }
    const pinned = !message.pinned;
    await db.pinMessage(req.params.id, pinned);
    for (const m of conv.members) {
      io.to(`user:${m.toString()}`).emit('message_pinned', { messageId: req.params.id, pinned, conversationId: message.conversationId });
    }
    return res.json({ ok: true, pinned });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.post('/api/conversations/:id/seen', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const conv = await db.getConversationById(req.params.id);
    if (!conv || !conv.members.map(String).includes(req.user._id.toString())) {
      return res.status(403).json({ error: 'Accès non autorisé.' });
    }
    await db.markMessagesSeen(req.params.id, req.user._id, new Date());
    await db.resetUnread(req.params.id, req.user._id);
    for (const m of conv.members) {
      io.to(`user:${m.toString()}`).emit('messages_seen', {
        conversationId: req.params.id,
        userId: req.user._id,
        seenAt: new Date(),
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.get('/api/conversations/:id/pinned', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const conv = await db.getConversationById(req.params.id);
    if (!conv || !conv.members.map(String).includes(req.user._id.toString())) {
      return res.status(403).json({ error: 'Accès non autorisé.' });
    }
    const pinned = await db.getPinnedMessages(req.params.id);
    return res.json(pinned.map(safeMessage));
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

// ─── Notification Routes ───────────────────────────────────────────────────────
app.get('/api/notifications', sec.requireAuth, async (req, res) => {
  try {
    const skip = parseInt(req.query.skip) || 0;
    const notifs = await db.getUserNotifications(req.user._id, skip, 20);
    return res.json(notifs.map(safeNotification));
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.get('/api/notifications/count', sec.requireAuth, async (req, res) => {
  try {
    const count = await db.getUnreadNotificationCount(req.user._id);
    return res.json({ count });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.post('/api/notifications/:id/read', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    await db.markNotificationRead(req.params.id, req.user._id);
    const count = await db.getUnreadNotificationCount(req.user._id);
    // Synchronise tous les onglets/appareils de l'utilisateur sans refresh.
    io.to(`user:${req.user._id}`).emit('notifications_read', { notificationId: req.params.id, count });
    return res.json({ ok: true, count });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.post('/api/notifications/read-all', sec.requireAuth, async (req, res) => {
  try {
    await db.markAllNotificationsRead(req.user._id);
    io.to(`user:${req.user._id}`).emit('notifications_read', { all: true, count: 0 });
    return res.json({ ok: true, count: 0 });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

// Corbeille : suppression définitive (deleteMany groupé) de toutes les
// notifications de l'utilisateur authentifié — jamais un userId venant du
// frontend. Opération distincte de "read-all" : supprimer n'est jamais
// déclenché par un marquage comme lu, et inversement.
app.post('/api/notifications/delete-all', sec.requireAuth, async (req, res) => {
  try {
    await db.deleteAllNotifications(req.user._id);
    io.to(`user:${req.user._id}`).emit('notifications_deleted', { all: true });
    return res.json({ ok: true, count: 0 });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

// ─── Report Routes ─────────────────────────────────────────────────────────────
app.post('/api/reports', sec.requireAuth, async (req, res) => {
  try {
    const { targetType, targetId, reason } = req.body;
    const allowedTypes = ['user', 'message', 'conversation'];
    if (!allowedTypes.includes(targetType)) return res.status(400).json({ error: 'Type invalide.' });
    if (!sec.isValidObjectId(targetId)) return res.status(400).json({ error: 'ID invalide.' });
    const reasonResult = sec.validateReportReason(reason);
    if (!reasonResult.valid) return res.status(400).json({ error: reasonResult.error });
    await db.createReport({
      reporterId: req.user._id,
      targetType,
      targetId,
      reason: reasonResult.value,
    });
    return res.status(201).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

// ─── Posts (Publications) Routes ───────────────────────────────────────────────
// Chargement de l'auteur + like de chaque post par lots (jamais N+1, jamais la
// liste complète des likes) pour rester léger même avec beaucoup de posts.
async function enrichPosts(posts, currentUserId) {
  if (posts.length === 0) return [];
  const authorIds = [...new Set(posts.map((p) => p.authorId.toString()))];
  const sharedIds = [...new Set(posts.filter((p) => p.sharedFrom).map((p) => p.sharedFrom.toString()))];
  const [authors, sharedPosts, likedSet] = await Promise.all([
    db.findUsersByIds(authorIds),
    sharedIds.length ? db.getPostsByIds(sharedIds) : Promise.resolve([]),
    currentUserId ? db.getLikedPostIds(currentUserId, posts.map((p) => p._id)) : Promise.resolve(new Set()),
  ]);
  const authorMap = new Map(authors.map((a) => [a._id.toString(), a]));
  const sharedAuthorIds = [...new Set(sharedPosts.map((p) => p.authorId.toString()))];
  const sharedAuthors = sharedAuthorIds.length ? await db.findUsersByIds(sharedAuthorIds) : [];
  const sharedAuthorMap = new Map(sharedAuthors.map((a) => [a._id.toString(), a]));
  const sharedMap = new Map(sharedPosts.map((p) => [p._id.toString(), p]));

  return posts.map((p) => {
    const original = p.sharedFrom ? sharedMap.get(p.sharedFrom.toString()) : null;
    return {
      id: p._id,
      author: safeUser(authorMap.get(p.authorId.toString())),
      content: p.content,
      mediaType: p.mediaType,
      mediaUrl: p.mediaUrl,
      description: p.description,
      likesCount: p.likesCount || 0,
      sharesCount: p.sharesCount || 0,
      likedByMe: likedSet.has(p._id.toString()),
      createdAt: p.createdAt,
      sharedFrom: original ? {
        id: original._id,
        author: safeUser(sharedAuthorMap.get(original.authorId.toString())),
        content: original.content,
        mediaType: original.mediaType,
        mediaUrl: original.mediaUrl,
        description: original.description,
        createdAt: original.createdAt,
        deleted: original.deleted || false,
      } : null,
    };
  });
}

app.get('/api/posts', sec.requireAuth, async (req, res) => {
  try {
    const skip = parseInt(req.query.skip) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 20, 30);
    const posts = await db.getPosts(skip, limit);
    return res.json(await enrichPosts(posts, req.user._id.toString()));
  } catch (err) {
    console.error('[Posts]', err.message);
    return res.status(500).json({ error: 'Erreur.' });
  }
});

// Route publique : la liste des publications d'un profil doit s'afficher
// pour un lien /lapage/pseudo partagé même sans connexion.
app.get('/api/posts/user/:id', sec.optionalAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const skip = parseInt(req.query.skip) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 20, 30);
    const posts = await db.getPostsByAuthor(req.params.id, skip, limit);
    return res.json(await enrichPosts(posts, req.user?._id?.toString()));
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

// Publication unique (lien direct /lapage/pseudo/actu/ID) : ne charge que
// cette publication, jamais tout le fil. Publique afin qu'un visiteur non
// connecté puisse ouvrir le lien et voir la publication.
app.get('/api/posts/:id', sec.optionalAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const post = await db.getPostById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Publication introuvable.' });
    const [enriched] = await enrichPosts([post], req.user?._id?.toString());
    return res.json(enriched);
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.post('/api/posts', sec.requireAuth, sec.messageLimiter, async (req, res) => {
  try {
    const mediaType = req.body.mediaType || 'none';
    const typeResult = sec.validatePostMediaType(mediaType);
    if (!typeResult.valid) return res.status(400).json({ error: typeResult.error });

    const contentResult = sec.validatePostContent(req.body.content);
    if (!contentResult.valid) return res.status(400).json({ error: contentResult.error });

    const descResult = sec.validatePostDescription(req.body.description);
    if (!descResult.valid) return res.status(400).json({ error: descResult.error });

    let mediaUrl = '';
    if (mediaType !== 'none') {
      const urlResult = mediaType === 'image' ? sec.validateImageUrl(req.body.mediaUrl) : sec.validateUrl(req.body.mediaUrl);
      if (!urlResult.valid) return res.status(400).json({ error: urlResult.error });
      mediaUrl = urlResult.value;
    }

    if (!contentResult.value && !mediaUrl) {
      return res.status(400).json({ error: 'La publication ne peut pas être vide.' });
    }

    const post = await db.createPost({
      authorId: req.user._id,
      content: contentResult.value,
      mediaType,
      mediaUrl,
      description: descResult.value,
    });
    const [enriched] = await enrichPosts([post], req.user._id.toString());
    io.emit('post_created', enriched);
    return res.status(201).json(enriched);
  } catch (err) {
    console.error('[Posts] create', err.message);
    return res.status(500).json({ error: 'Erreur.' });
  }
});

// Partage d'une publication dans une discussion (jamais de republication dans
// le fil : seule une référence à la publication d'origine est envoyée comme
// message, jamais son contenu ou son média dupliqué).
app.post('/api/posts/:id/share', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    if (!sec.isValidObjectId(req.body.conversationId)) return res.status(400).json({ error: 'Discussion invalide.' });

    const post = await db.getPostById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Publication introuvable.' });

    const conv = await db.getConversationById(req.body.conversationId);
    if (!conv || !conv.members.map(String).includes(req.user._id.toString())) {
      return res.status(403).json({ error: 'Accès non autorisé.' });
    }

    const descResult = sec.validatePostDescription(req.body.description);
    if (!descResult.valid) return res.status(400).json({ error: descResult.error });

    // Toujours la publication racine (jamais un partage d'un partage).
    const rootId = post.sharedFrom ? post.sharedFrom.toString() : post._id.toString();

    const message = await db.createMessage({
      conversationId: req.body.conversationId,
      senderId: req.user._id,
      content: descResult.value,
      type: 'shared_post',
      sharedPostId: rootId,
      seenBy: [req.user._id],
    });
    await db.incrementPostShares(rootId);
    await db.updateConversationLastMessage(req.body.conversationId, {
      content: descResult.value || 'a partagé une publication',
      senderId: req.user._id,
      type: 'shared_post',
      createdAt: message.createdAt,
    });

    const sender = await db.findUserById(req.user._id);
    const [msgOutBase] = await enrichMessages([message]);
    const msgOut = { ...msgOutBase, sender: safeUser(sender) };

    for (const memberId of conv.members) {
      const mid = memberId.toString();
      io.to(`user:${mid}`).emit('new_message', msgOut);
      if (mid !== req.user._id.toString()) {
        await db.incrementUnread(req.body.conversationId, mid);
        const member = await db.findUserById(mid);
        if (member && member.settings?.notifications !== false && !isMemberViewingConv(mid, req.body.conversationId)) {
          await db.createNotification({
            userId: mid,
            type: 'message',
            fromUserId: req.user._id,
            conversationId: req.body.conversationId,
            messageId: message._id,
            content: `${req.user.username} a partagé une publication`.substring(0, 100),
          });
          io.to(`user:${mid}`).emit('notification', { count: 1 });
          // Push notification (manquait ici : même chaîne que pour un message
          // texte classique, pour que le partage d'une publication en
          // conversation déclenche aussi une notification hors site).
          if (member.fcmTokens?.length) {
            await sendPushNotification(
              mid,
              member.fcmTokens,
              req.user.username,
              descResult.value || 'a partagé une publication',
              { conversationId: req.body.conversationId }
            );
          }
        }
      }
    }

    return res.status(201).json(msgOut);
  } catch (err) {
    console.error('[Posts] share', err.message);
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.post('/api/posts/:id/like', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const post = await db.getPostById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Publication introuvable.' });
    const result = await db.togglePostLike(req.params.id, req.user._id);
    io.emit('post_liked', { postId: req.params.id, likesCount: result.likesCount });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.delete('/api/posts/:id', sec.requireAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const post = await db.getPostById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Publication introuvable.' });
    const isOwner = post.authorId.toString() === req.user._id.toString();
    const isAdmin = req.user.roles?.some((r) => ['ADMIN', 'MODERATOR', 'OWNER'].includes(r));
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Accès non autorisé.' });
    await db.deletePost(req.params.id);
    io.emit('post_deleted', { postId: req.params.id });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

// ─── Admin Routes ──────────────────────────────────────────────────────────────
const adminAuth = [sec.requireAuth, sec.requireRole(['ADMIN', 'OWNER', 'MODERATOR'])];

app.get('/api/admin/users', ...adminAuth, async (req, res) => {
  try {
    const skip = parseInt(req.query.skip) || 0;
    const users = await db.getAllUsersAdmin(skip, 50);
    return res.json(users);
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.get('/api/admin/reports', ...adminAuth, async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const skip = parseInt(req.query.skip) || 0;
    const reports = await db.getReports(status, skip, 30);
    return res.json(reports);
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.put('/api/admin/reports/:id', ...adminAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const status = req.body.status;
    if (!['reviewed', 'resolved', 'dismissed'].includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
    await db.updateReportStatus(req.params.id, status, req.user._id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.put('/api/admin/users/:id/suspend', ...adminAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const target = await db.findUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    if (target.roles?.includes('OWNER') || target.roles?.includes('ADMIN')) {
      const isOwner = req.user.roles?.includes('OWNER');
      if (!isOwner) return res.status(403).json({ error: 'Droits insuffisants.' });
    }
    await db.suspendUser(req.params.id, Boolean(req.body.value));
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.put('/api/admin/users/:id/ban', ...adminAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const target = await db.findUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    if (target.roles?.includes('OWNER')) return res.status(403).json({ error: 'Droits insuffisants.' });
    await db.banUser(req.params.id, Boolean(req.body.value));
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.put('/api/admin/users/:id/role', sec.requireAuth, sec.requireRole(['OWNER']), async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const allowedRoles = ['USER', 'MODERATOR', 'ADMIN'];
    const roles = req.body.roles;
    if (!Array.isArray(roles) || roles.some((r) => !allowedRoles.includes(r))) {
      return res.status(400).json({ error: 'Rôles invalides.' });
    }
    await db.updateUserRole(req.params.id, roles);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

// Suppression totale et définitive d'un compte par un administrateur ou le
// propriétaire (contrairement à la suspension/au bannissement, qui sont
// réversibles). Reprend exactement le nettoyage de données utilisé pour
// l'auto-suppression (db.deleteUserAccount), sans exiger le mot de passe de
// la cible puisque c'est un admin qui agit. Un MODERATOR ne peut pas
// déclencher cette action, réservée à ADMIN/OWNER.
app.delete('/api/admin/users/:id', sec.requireAuth, sec.requireRole(['ADMIN', 'OWNER']), async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ error: 'Utilisez la suppression de compte dans les paramètres pour votre propre compte.' });
    }
    const target = await db.findUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    if (target.roles?.includes('OWNER')) return res.status(403).json({ error: 'Droits insuffisants.' });
    if (target.roles?.includes('ADMIN') && !req.user.roles?.includes('OWNER')) {
      return res.status(403).json({ error: 'Droits insuffisants.' });
    }

    const userId = req.params.id;
    const { affectedGroupIds, deletedPrivateConvIds, notifyOtherUserIds } = await db.deleteUserAccount(userId);

    // Notifie en temps réel les groupes restants (nouvelle liste de membres)
    for (const convId of affectedGroupIds) {
      const updated = await db.getConversationById(convId);
      if (!updated) continue;
      const enriched = await enrichConversations([updated], '');
      for (const m of updated.members) {
        io.to(`user:${m.toString()}`).emit('group_updated', enriched[0]);
      }
    }
    // Notifie les interlocuteurs des conversations privées supprimées
    for (let i = 0; i < deletedPrivateConvIds.length; i++) {
      io.to(`user:${notifyOtherUserIds[i]}`).emit('conversation_deleted', { conversationId: deletedPrivateConvIds[i] });
    }
    // Informe le compte supprimé (autres onglets/appareils) puis coupe ses sockets
    io.to(`user:${userId}`).emit('account_deleted', {});
    io.in(`user:${userId}`).disconnectSockets(true);
    io.emit('user_offline', { userId, lastSeen: new Date() });
    onlineUsers.delete(userId);

    return res.json({ ok: true });
  } catch (err) {
    console.error('[Admin] Delete user error:', err.message);
    return res.status(500).json({ error: 'Erreur.' });
  }
});

app.delete('/api/admin/messages/:id', ...adminAuth, async (req, res) => {
  try {
    if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
    const message = await db.getMessageById(req.params.id);
    if (!message) return res.status(404).json({ error: 'Message introuvable.' });
    await db.deleteMessage(req.params.id);
    const conv = await db.getConversationById(message.conversationId);
    if (conv) {
      for (const m of conv.members) {
        io.to(`user:${m.toString()}`).emit('message_deleted', { messageId: req.params.id, conversationId: message.conversationId });
      }
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur.' });
  }
});

// ─── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'jexchat' }));

// ─── Firebase Config (public, safe) ───────────────────────────────────────────
app.get('/api/firebase-config', (req, res) => {
  res.json({
    apiKey: process.env.FIREBASE_WEB_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    vapidKey: process.env.VAPID_PUBLIC_KEY,
  });
});

// ─── Socket.IO ─────────────────────────────────────────────────────────────────
const onlineUsers = new Map(); // userId -> Set of socketIds

// Vérifie si un membre a actuellement un socket dans la room de cette
// conversation (c.-à-d. qu'il l'a ouverte), pour éviter de créer une
// notification interne ou un push inutile alors qu'il voit déjà le message
// s'afficher en direct.
function isMemberViewingConv(memberId, conversationId) {
  const room = io.sockets.adapter.rooms.get(`conv:${conversationId}`);
  if (!room || room.size === 0) return false;
  const sockets = onlineUsers.get(memberId);
  if (!sockets) return false;
  for (const sid of sockets) {
    if (room.has(sid)) return true;
  }
  return false;
}

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.cookie
    ?.split(';').find(c => c.trim().startsWith('jexchat_session='))?.split('=')[1];
  if (!token) return next(new Error('Non authentifié'));
  const user = await sec.authenticateSocket(socket, token);
  if (!user) return next(new Error('Session invalide'));
  socket.userId = user._id.toString();
  socket.username = user.username;
  socket.user = user;
  next();
});

io.on('connection', async (socket) => {
  const userId = socket.userId;
  socket.join(`user:${userId}`);

  // Track online
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socket.id);
  await db.updateUserOnlineStatus(userId, true);
  io.emit('user_online', { userId, username: socket.username });

  // ── Heartbeat ──
  const heartbeatInterval = setInterval(async () => {
    await db.updateUserLastSeen(userId, true);
  }, 30000);

  // ── Typing ──
  socket.on('typing_start', async (data) => {
    if (!sec.socketRateLimit(socket.id, 'typing', 30, 60000)) return;
    if (!data?.conversationId || !sec.isValidObjectId(data.conversationId)) return;
    const conv = await db.getConversationById(data.conversationId);
    if (!conv || !conv.members.map(String).includes(userId)) return;
    socket.to(`conv:${data.conversationId}`).emit('user_typing', { userId, username: socket.username, conversationId: data.conversationId });
  });

  socket.on('typing_stop', async (data) => {
    if (!data?.conversationId || !sec.isValidObjectId(data.conversationId)) return;
    const conv = await db.getConversationById(data.conversationId);
    if (!conv || !conv.members.map(String).includes(userId)) return;
    socket.to(`conv:${data.conversationId}`).emit('user_stopped_typing', { userId, conversationId: data.conversationId });
  });

  // ── Join conversation room ──
  socket.on('join_conversation', async (conversationId) => {
    if (!sec.isValidObjectId(conversationId)) return;
    const conv = await db.getConversationById(conversationId);
    if (!conv || !conv.members.map(String).includes(userId)) return;
    socket.join(`conv:${conversationId}`);
  });

  socket.on('leave_conversation', (conversationId) => {
    if (conversationId) socket.leave(`conv:${conversationId}`);
  });

  // ── Disconnect ──
  socket.on('disconnect', async () => {
    clearInterval(heartbeatInterval);
    const sockets = onlineUsers.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        onlineUsers.delete(userId);
        const lastSeen = new Date();
        await db.updateUserOnlineStatus(userId, false);
        io.emit('user_offline', { userId, lastSeen });
      }
    }
  });
});

// ─── Helpers ───────────────────────────────────────────────────────────────────
function safeUser(user) {
  if (!user) return null;
  return {
    id: user._id,
    username: user.username,
    identity: user.identity,
    isOnline: user.isOnline,
    lastSeen: user.lastSeen,
    roles: user.roles,
    settings: user.settings ? { theme: user.settings.theme, accentColor: user.settings.accentColor } : undefined,
  };
}

function safeNotification(n) {
  if (!n) return null;
  return {
    id: n._id,
    type: n.type,
    fromUserId: n.fromUserId,
    conversationId: n.conversationId,
    messageId: n.messageId,
    content: n.content,
    read: n.read,
    createdAt: n.createdAt,
  };
}

function safeMessage(msg) {
  if (!msg) return null;
  const now = new Date();
  const expired = msg.expiresAt && new Date(msg.expiresAt) < now;
  return {
    id: msg._id,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    content: expired ? '' : (msg.deleted ? '' : msg.content),
    type: expired ? 'expired' : (msg.deleted ? 'deleted' : msg.type),
    url: expired ? '' : msg.url,
    sharedPostId: msg.sharedPostId || null,
    replyTo: msg.replyTo,
    reactions: msg.reactions || [],
    pinned: msg.pinned,
    editedAt: msg.editedAt,
    seenBy: msg.seenBy || [],
    deleted: msg.deleted,
    expired,
    createdAt: msg.createdAt,
    expiresAt: msg.expiresAt,
  };
}

// Enrichit une liste de messages avec la publication référencée (jamais son
// contenu dupliqué) pour les messages de type "shared_post", et avec un
// aperçu du message original pour les réponses ("replyTo" reste un simple
// ID en base, jamais dupliqué), le tout par lot afin d'éviter toute requête
// N+1 (une seule requête groupée pour tous les posts/messages/auteurs de la
// page, quel que soit le nombre de réponses/partages qu'elle contient).
async function enrichMessages(messages) {
  const base = messages.map(safeMessage);

  const sharedIds = [...new Set(base.filter((m) => m.sharedPostId).map((m) => m.sharedPostId.toString()))];
  const replyIds = [...new Set(base.filter((m) => m.replyTo).map((m) => m.replyTo.toString()))];

  const [posts, replySources] = await Promise.all([
    sharedIds.length ? db.getPostsByIds(sharedIds) : Promise.resolve([]),
    replyIds.length ? db.getMessagesByIds(replyIds) : Promise.resolve([]),
  ]);

  const authorIds = new Set(posts.map((p) => p.authorId.toString()));
  replySources.forEach((r) => authorIds.add(r.senderId.toString()));
  const authors = authorIds.size ? await db.findUsersByIds([...authorIds]) : [];
  const authorMap = new Map(authors.map((a) => [a._id.toString(), a]));

  const postMap = new Map(posts.map((p) => [p._id.toString(), p]));
  const replyMap = new Map(replySources.map((r) => [r._id.toString(), r]));

  return base.map((m) => {
    let out = m;
    if (m.sharedPostId) {
      const post = postMap.get(m.sharedPostId.toString());
      out = {
        ...out,
        sharedPost: post ? {
          id: post._id,
          author: safeUser(authorMap.get(post.authorId.toString())),
          content: post.content,
          mediaType: post.mediaType,
          mediaUrl: post.mediaUrl,
          deleted: post.deleted || false,
          createdAt: post.createdAt,
        } : { deleted: true },
      };
    }
    if (m.replyTo) {
      const original = replyMap.get(m.replyTo.toString());
      const expired = original?.expiresAt && new Date(original.expiresAt) < new Date();
      out = {
        ...out,
        replyPreview: original ? {
          id: original._id,
          author: safeUser(authorMap.get(original.senderId.toString())),
          content: expired || original.deleted ? '' : original.content,
          type: expired ? 'expired' : (original.deleted ? 'deleted' : original.type),
        } : { deleted: true },
      };
    }
    return out;
  });
}

async function enrichConversations(convs, currentUserId) {
  const results = [];
  for (const conv of convs) {
    const memberIds = conv.members.map(String);
    const members = await db.findUsersByIds(conv.members);
    const otherMembers = members.filter((m) => m._id.toString() !== currentUserId);
    const unreadCount = conv.unreadCounts?.get ? (conv.unreadCounts.get(currentUserId) || 0) : (conv.unreadCounts?.[currentUserId] || 0);
    results.push({
      id: conv._id,
      type: conv.type,
      name: conv.type === 'private' ? (otherMembers[0]?.username || 'Utilisateur') : conv.name,
      members: members.map(safeUser),
      admins: conv.admins?.map(String) || [],
      owner: conv.owner?.toString(),
      lastMessage: conv.lastMessage,
      background: conv.background || { type: 'none', value: '' },
      updatedAt: conv.updatedAt,
      createdAt: conv.createdAt,
      unreadCount,
      otherUser: conv.type === 'private' ? safeUser(otherMembers[0]) : null,
    });
  }
  return results;
}

// ─── Cleanup Jobs ──────────────────────────────────────────────────────────────
setInterval(async () => {
  try {
    const count = await db.cleanupExpiredMessages();
    if (count > 0) console.log(`[Cleanup] ${count} expired messages cleaned`);
  } catch (err) {
    console.warn('[Cleanup] Error:', err.message);
  }
}, 15 * 60 * 1000); // Toutes les 15 min : contenu expiré vidé au plus près des 5 jours

// ─── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  // Connect to MongoDB (non-fatal if it fails)
  try {
    await db.connect();
  } catch (err) {
    console.warn('[Start] DB connection failed, running in degraded mode:', err.message);
  }
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[JEXCHAT] Server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('[Start] Fatal error:', err.message);
  // Still try to start server for health check
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[JEXCHAT] Server running (degraded) on port ${PORT}`);
  });
});
