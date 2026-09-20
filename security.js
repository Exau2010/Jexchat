'use strict';

const crypto = require('crypto');
const validator = require('validator');
const sanitizeHtml = require('sanitize-html');

// ─── Constants ─────────────────────────────────────────────────────────────────
const MAX_MESSAGE_LENGTH = 4000;
const MAX_USERNAME_LENGTH = 32;
const MIN_USERNAME_LENGTH = 2;
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 128;
const MAX_GROUP_NAME_LENGTH = 64;
const MAX_URL_LENGTH = 2048;

const ALLOWED_URL_PROTOCOLS = ['https:'];
const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
const ALLOWED_VIDEO_DOMAINS = [];
const DANGEROUS_PATTERNS = [
  /javascript:/i,
  /data:/i,
  /vbscript:/i,
  /on\w+\s*=/i,
  /<script/i,
  /&#/i,
];

// ─── Rate Limiting ─────────────────────────────────────────────────────────────
const rateLimitMap = new Map();

function rateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  const entry = rateLimitMap.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  rateLimitMap.set(key, entry);
  return entry.count <= maxRequests;
}

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap.entries()) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000);

// Express middleware factory
function createRateLimiter(maxRequests, windowMs, keyFn) {
  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : req.ip;
    if (!rateLimit(key, maxRequests, windowMs)) {
      return res.status(429).json({ error: 'Trop de requêtes. Veuillez patienter.' });
    }
    next();
  };
}

const authLimiter = createRateLimiter(10, 15 * 60 * 1000, (r) => r.ip + ':auth');
const messageLimiter = createRateLimiter(60, 60 * 1000, (r) => (r.session?.userId || r.ip) + ':msg');
const apiLimiter = createRateLimiter(200, 60 * 1000, (r) => r.ip + ':api');
const searchLimiter = createRateLimiter(30, 60 * 1000, (r) => (r.session?.userId || r.ip) + ':search');

// Socket rate limit
function socketRateLimit(socketId, action, max, windowMs) {
  const key = `${socketId}:${action}`;
  return rateLimit(key, max, windowMs);
}

// ─── Input Validation ──────────────────────────────────────────────────────────
function validateUsername(username) {
  if (typeof username !== 'string') return { valid: false, error: 'Pseudo invalide.' };
  const u = username.trim();
  if (u.length < MIN_USERNAME_LENGTH)
    return { valid: false, error: `Le pseudo doit contenir au moins ${MIN_USERNAME_LENGTH} caractères.` };
  if (u.length > MAX_USERNAME_LENGTH)
    return { valid: false, error: `Le pseudo ne peut pas dépasser ${MAX_USERNAME_LENGTH} caractères.` };
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(u))
    return { valid: false, error: 'Le pseudo ne peut contenir que des lettres, chiffres, _, - et .' };
  if (/^\.|^-/.test(u))
    return { valid: false, error: 'Le pseudo ne peut pas commencer par . ou -' };
  return { valid: true, value: u };
}

function validatePassword(password) {
  if (typeof password !== 'string')
    return { valid: false, error: 'Mot de passe invalide.' };
  if (password.length < MIN_PASSWORD_LENGTH)
    return { valid: false, error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.` };
  if (password.length > MAX_PASSWORD_LENGTH)
    return { valid: false, error: `Le mot de passe est trop long.` };
  return { valid: true };
}

function validateMessage(content) {
  if (typeof content !== 'string') return { valid: false, error: 'Message invalide.' };
  const c = content.trim();
  if (c.length === 0) return { valid: false, error: 'Le message ne peut pas être vide.' };
  if (c.length > MAX_MESSAGE_LENGTH)
    return { valid: false, error: `Le message ne peut pas dépasser ${MAX_MESSAGE_LENGTH} caractères.` };
  return { valid: true, value: c };
}

function validateGroupName(name) {
  if (typeof name !== 'string') return { valid: false, error: 'Nom invalide.' };
  const n = name.trim();
  if (n.length < 1) return { valid: false, error: 'Le nom du groupe ne peut pas être vide.' };
  if (n.length > MAX_GROUP_NAME_LENGTH)
    return { valid: false, error: `Le nom ne peut pas dépasser ${MAX_GROUP_NAME_LENGTH} caractères.` };
  return { valid: true, value: n };
}

function validateUrl(url) {
  if (typeof url !== 'string') return { valid: false, error: 'URL invalide.' };
  const u = url.trim();
  if (u.length > MAX_URL_LENGTH) return { valid: false, error: 'URL trop longue.' };

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(u)) return { valid: false, error: 'URL non autorisée.' };
  }

  try {
    const parsed = new URL(u);
    if (!ALLOWED_URL_PROTOCOLS.includes(parsed.protocol)) {
      return { valid: false, error: 'Seules les URLs HTTPS sont autorisées.' };
    }
    if (!parsed.hostname || parsed.hostname.length < 3) {
      return { valid: false, error: 'URL invalide.' };
    }
    return { valid: true, value: u };
  } catch {
    return { valid: false, error: 'URL malformée.' };
  }
}

function validateImageUrl(url) {
  const base = validateUrl(url);
  if (!base.valid) return base;
  return base;
}

function validateReactionType(type) {
  const allowed = ['heart', 'thumbsup', 'thumbsdown', 'laugh', 'wow', 'sad', 'angry'];
  if (!allowed.includes(type)) return { valid: false, error: 'Réaction invalide.' };
  return { valid: true };
}

function validateMessageType(type) {
  const allowed = ['text', 'link', 'image', 'video', 'audio', 'sticker', 'note', 'shared_post'];
  if (!allowed.includes(type)) return { valid: false, error: 'Type de message invalide.' };
  return { valid: true };
}

function validateReportReason(reason) {
  if (typeof reason !== 'string') return { valid: false, error: 'Raison invalide.' };
  const r = reason.trim();
  if (r.length < 5) return { valid: false, error: 'Veuillez préciser la raison.' };
  if (r.length > 500) return { valid: false, error: 'Raison trop longue.' };
  return { valid: true, value: r };
}

function validatePostContent(content) {
  if (content === undefined || content === null) return { valid: true, value: '' };
  if (typeof content !== 'string') return { valid: false, error: 'Contenu invalide.' };
  const c = sanitizeText(content).trim();
  if (c.length > 2000) return { valid: false, error: 'Le texte de la publication est trop long (2000 caractères max).' };
  return { valid: true, value: c };
}

function validatePostDescription(description) {
  if (description === undefined || description === null) return { valid: true, value: '' };
  if (typeof description !== 'string') return { valid: false, error: 'Description invalide.' };
  const d = sanitizeText(description).trim();
  if (d.length > 300) return { valid: false, error: 'La description ne peut pas dépasser 300 caractères.' };
  return { valid: true, value: d };
}

function validatePostMediaType(type) {
  const allowed = ['none', 'image', 'video', 'link'];
  if (!allowed.includes(type)) return { valid: false, error: 'Type de publication invalide.' };
  return { valid: true };
}

// ─── XSS / Sanitization ────────────────────────────────────────────────────────
function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return sanitizeHtml(str, { allowedTags: [], allowedAttributes: {} }).trim();
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Token Generation ──────────────────────────────────────────────────────────
function generateSecureToken() {
  return crypto.randomBytes(48).toString('hex');
}

function generateShortToken() {
  return crypto.randomBytes(16).toString('hex');
}

// ─── Security Headers Middleware ───────────────────────────────────────────────
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://cdn.jsdelivr.net https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://unpkg.com",
      "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
      "img-src 'self' data: https:",
      "media-src 'self' https:",
      "connect-src 'self' wss: ws: https://www.googleapis.com",
      "worker-src 'self'",
      "frame-src 'none'",
    ].join('; ')
  );
  next();
}

// ─── Auth Middleware ───────────────────────────────────────────────────────────
const db = require('./database.js');

async function requireAuth(req, res, next) {
  const token = req.cookies?.jexchat_session || req.headers['x-session-token'];
  if (!token) return res.status(401).json({ error: 'Non authentifié.' });

  const session = await db.findSession(token);
  if (!session) return res.status(401).json({ error: 'Session expirée ou invalide.' });

  const user = await db.findUserById(session.userId);
  if (!user) return res.status(401).json({ error: 'Utilisateur introuvable.' });
  if (user.isBanned) return res.status(403).json({ error: 'Compte banni.' });
  if (user.isSuspended) return res.status(403).json({ error: 'Compte suspendu.' });

  req.session = { userId: user._id.toString(), username: user.username, roles: user.roles, token };
  req.user = user;
  await db.touchSession(token);
  next();
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié.' });
    const userRoles = req.user.roles || [];
    const allowed = Array.isArray(roles) ? roles : [roles];
    const hasRole = userRoles.some((r) => allowed.includes(r));
    if (!hasRole) return res.status(403).json({ error: 'Accès non autorisé.' });
    next();
  };
}

async function authenticateSocket(socket, token) {
  if (!token) return null;
  const session = await db.findSession(token);
  if (!session) return null;
  const user = await db.findUserById(session.userId);
  if (!user || user.isBanned || user.isSuspended) return null;
  return user;
}

// ─── MongoDB ID Validation ─────────────────────────────────────────────────────
function isValidObjectId(id) {
  return /^[a-f\d]{24}$/i.test(String(id));
}

module.exports = {
  validateUsername,
  validatePassword,
  validateMessage,
  validateGroupName,
  validateUrl,
  validateImageUrl,
  validateReactionType,
  validateMessageType,
  validateReportReason,
  validatePostContent,
  validatePostDescription,
  validatePostMediaType,
  sanitizeText,
  escapeHtml,
  generateSecureToken,
  generateShortToken,
  rateLimit,
  socketRateLimit,
  createRateLimiter,
  authLimiter,
  messageLimiter,
  apiLimiter,
  searchLimiter,
  securityHeaders,
  requireAuth,
  requireRole,
  authenticateSocket,
  isValidObjectId,
  MAX_MESSAGE_LENGTH,
};
