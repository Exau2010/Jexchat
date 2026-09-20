'use strict';

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

// ─── Connection ────────────────────────────────────────────────────────────────
async function connect() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000,
      connectTimeoutMS: 5000,
    });
    console.log('[DB] Connected to MongoDB');
    await ensureIndexes();
  } catch (err) {
    console.error('[DB] Connection error:', err.message);
    console.warn('[DB] Running in degraded mode - database unavailable');
    // Don't exit - allow health check to pass
  }
}

mongoose.connection.on('disconnected', () => {
  console.warn('[DB] MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  console.info('[DB] MongoDB reconnected');
});

// ─── Schemas ───────────────────────────────────────────────────────────────────

// --- User ---
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, minlength: 2, maxlength: 32 },
  passwordHash: { type: String, required: true, select: false },
  identity: {
    colorA: String,
    colorB: String,
    shape: String,
    pattern: String,
  },
  roles: { type: [String], default: ['USER'], enum: ['USER', 'MODERATOR', 'ADMIN', 'OWNER'] },
  createdAt: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
  isOnline: { type: Boolean, default: false },
  isSuspended: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  fcmTokens: [{ type: String }],
  settings: {
    theme: { type: String, default: 'light' },
    accentColor: { type: String, default: '#6C63FF' },
    notifications: { type: Boolean, default: true },
    messageFont: { type: String, default: 'default' },
    privacy: {
      showOnlineStatus: { type: Boolean, default: true },
      showLastSeen: { type: Boolean, default: true },
    },
  },
}, { timestamps: false });

userSchema.index({ username: 1 });
userSchema.index({ lastSeen: -1 });
userSchema.index({ isOnline: 1, lastSeen: -1 });

// --- Session ---
const sessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  token: { type: String, required: true, unique: true },
  deviceInfo: { type: String, default: '' },
  ipAddress: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  lastActive: { type: Date, default: Date.now },
});

sessionSchema.index({ token: 1 });
sessionSchema.index({ userId: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// --- Conversation ---
// Sous-schéma dédié pour lastMessage : évite l'ambiguïté Mongoose où un champ
// interne nommé "type" est confondu avec le descripteur de type du champ parent
// (ce qui faisait interpréter lastMessage comme un simple String -> "Cast to
// string failed ... at path lastMessage" lors de l'enregistrement d'un message).
const lastMessageSchema = new mongoose.Schema({
  content: String,
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: String,
  createdAt: Date,
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  type: { type: String, enum: ['private', 'group'], required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: { type: String, maxlength: 64 },
  lastMessage: lastMessageSchema,
  background: {
    type: { type: String, enum: ['color', 'gradient', 'image', 'pattern', 'none'], default: 'none' },
    value: { type: String, default: '' },
  },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  unreadCounts: { type: Map, of: Number, default: {} },
});

conversationSchema.index({ members: 1 });
conversationSchema.index({ updatedAt: -1 });

// --- Message ---
const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, default: '' },
  type: {
    type: String,
    enum: ['text', 'link', 'image', 'video', 'audio', 'sticker', 'note', 'shared_post', 'expired'],
    default: 'text',
  },
  url: { type: String, default: '' },
  // Partage d'une publication dans une discussion : référence uniquement,
  // jamais de duplication du contenu original (média/texte) en base.
  sharedPostId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  reactions: [
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      type: { type: String },
    },
  ],
  pinned: { type: Boolean, default: false },
  editedAt: { type: Date, default: null },
  seenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  deleted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
});

messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1 });
messageSchema.index({ expiresAt: 1 });
messageSchema.index({ pinned: 1, conversationId: 1 });

// --- Notification ---
const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['message', 'group_invite', 'mention', 'system'], default: 'message' },
  fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
  messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  content: { type: String, default: '' },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

// --- Report ---
const reportSchema = new mongoose.Schema({
  reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetType: { type: String, enum: ['user', 'message', 'conversation'], required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  reason: { type: String, maxlength: 500 },
  status: { type: String, enum: ['pending', 'reviewed', 'resolved', 'dismissed'], default: 'pending' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ reporterId: 1 });

// --- Post (Publications) ---
// sharedFrom référence toujours le post ORIGINAL (jamais un autre partage) afin
// d'éviter les chaînes de partages et de ne jamais dupliquer le contenu/média.
const postSchema = new mongoose.Schema({
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, default: '', maxlength: 2000 },
  mediaType: { type: String, enum: ['none', 'image', 'video', 'link'], default: 'none' },
  mediaUrl: { type: String, default: '' },
  description: { type: String, default: '', maxlength: 300 },
  sharedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },
  likesCount: { type: Number, default: 0 },
  sharesCount: { type: Number, default: 0 },
  deleted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});
postSchema.index({ createdAt: -1 });
postSchema.index({ authorId: 1, createdAt: -1 });
postSchema.index({ sharedFrom: 1 });

// --- PostLike ---
// Compteur léger sur Post + enregistrement minimal indexé ici : on ne charge
// jamais un gros tableau de likes dans un document Post.
const postLikeSchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
});
postLikeSchema.index({ postId: 1, userId: 1 }, { unique: true });
postLikeSchema.index({ userId: 1 });

// ─── Models ────────────────────────────────────────────────────────────────────
const User = mongoose.model('User', userSchema);
const Session = mongoose.model('Session', sessionSchema);
const Conversation = mongoose.model('Conversation', conversationSchema);
const Message = mongoose.model('Message', messageSchema);
const Notification = mongoose.model('Notification', notificationSchema);
const Report = mongoose.model('Report', reportSchema);
const Post = mongoose.model('Post', postSchema);
const PostLike = mongoose.model('PostLike', postLikeSchema);

// ─── Index Helpers ─────────────────────────────────────────────────────────────
async function ensureIndexes() {
  try {
    await Promise.all([
      User.ensureIndexes(),
      Session.ensureIndexes(),
      Conversation.ensureIndexes(),
      Message.ensureIndexes(),
      Notification.ensureIndexes(),
      Report.ensureIndexes(),
      Post.ensureIndexes(),
      PostLike.ensureIndexes(),
    ]);
    console.log('[DB] Indexes ensured');
  } catch (err) {
    console.warn('[DB] Index warning:', err.message);
  }
}

// ─── DB Operations ─────────────────────────────────────────────────────────────

// Users
async function createUser(username, passwordHash, identity) {
  const user = new User({ username, passwordHash, identity });
  await user.save();
  return user;
}

async function findUserByUsername(username) {
  return User.findOne({ username }).select('+passwordHash').lean();
}

async function findUserById(id) {
  return User.findById(id).lean();
}

async function findUsersByIds(ids) {
  return User.find({ _id: { $in: ids } }).lean();
}

async function updateUserLastSeen(userId, isOnline = false) {
  return User.updateOne({ _id: userId }, { lastSeen: new Date(), isOnline });
}

async function updateUserOnlineStatus(userId, isOnline) {
  return User.updateOne({ _id: userId }, { isOnline, lastSeen: new Date() });
}

async function updateUserSettings(userId, settings) {
  return User.updateOne({ _id: userId }, { $set: { settings } });
}

async function updateUserPassword(userId, passwordHash) {
  return User.updateOne({ _id: userId }, { passwordHash });
}

async function updateUsername(userId, username) {
  return User.updateOne({ _id: userId }, { username });
}

async function blockUser(userId, targetId) {
  return User.updateOne({ _id: userId }, { $addToSet: { blockedUsers: targetId } });
}

async function unblockUser(userId, targetId) {
  return User.updateOne({ _id: userId }, { $pull: { blockedUsers: targetId } });
}

async function addFcmToken(userId, token) {
  return User.updateOne({ _id: userId }, { $addToSet: { fcmTokens: token } });
}

async function removeFcmToken(userId, token) {
  return User.updateOne({ _id: userId }, { $pull: { fcmTokens: token } });
}

// Suppression réelle et complète du compte + toutes les données personnelles
// associées : sessions, notifications, messages/conversations privées,
// appartenance aux groupes (avec transfert de propriété si nécessaire),
// publications et likes. Retourne les infos nécessaires à la couche
// Socket.IO pour prévenir les utilisateurs concernés en temps réel.
async function deleteUserAccount(userId) {
  const uid = new mongoose.Types.ObjectId(userId);

  // --- Groupes : on retire le membre, on transfère la propriété si besoin ---
  const groupConvs = await Conversation.find({ type: 'group', members: uid }).lean();
  const affectedGroupIds = [];
  for (const conv of groupConvs) {
    const remaining = conv.members.map(String).filter((id) => id !== uid.toString());
    if (remaining.length === 0) {
      await Message.deleteMany({ conversationId: conv._id });
      await Conversation.deleteOne({ _id: conv._id });
      continue;
    }
    const update = { $pull: { members: uid, admins: uid } };
    if (conv.owner && conv.owner.toString() === uid.toString()) {
      const remainingAdmins = (conv.admins || []).map(String).filter((id) => id !== uid.toString());
      const newOwnerId = remainingAdmins[0] || remaining[0];
      update.$set = { owner: newOwnerId };
    }
    await Conversation.updateOne({ _id: conv._id }, update);
    if (update.$set?.owner) {
      await Conversation.updateOne({ _id: conv._id }, { $addToSet: { admins: update.$set.owner } });
    }
    affectedGroupIds.push(conv._id.toString());
  }

  // --- Conversations privées : supprimées entièrement avec leurs messages ---
  const privateConvs = await Conversation.find({ type: 'private', members: uid }).lean();
  const deletedPrivateConvIds = privateConvs.map((c) => c._id.toString());
  const notifyOtherUserIds = privateConvs
    .map((c) => c.members.map(String).find((id) => id !== uid.toString()))
    .filter(Boolean);
  if (deletedPrivateConvIds.length) {
    await Message.deleteMany({ conversationId: { $in: privateConvs.map((c) => c._id) } });
    await Conversation.deleteMany({ _id: { $in: privateConvs.map((c) => c._id) } });
  }

  // --- Messages restants envoyés par l'utilisateur (dans les groupes qui subsistent) ---
  await Message.deleteMany({ senderId: uid });
  // --- Traces laissées sur les messages d'autrui (réactions, accusés de lecture) ---
  await Message.updateMany(
    { $or: [{ 'reactions.userId': uid }, { seenBy: uid }] },
    { $pull: { reactions: { userId: uid }, seenBy: uid } }
  );

  // --- Publications et likes ---
  const posts = await Post.find({ authorId: uid }).select('_id').lean();
  const postIds = posts.map((p) => p._id);
  if (postIds.length) await PostLike.deleteMany({ postId: { $in: postIds } });
  await Post.deleteMany({ authorId: uid });
  await PostLike.deleteMany({ userId: uid });

  // --- Références chez les autres utilisateurs ---
  await User.updateMany({}, { $pull: { blockedUsers: uid } });
  await Notification.deleteMany({ $or: [{ userId: uid }, { fromUserId: uid }] });
  await Session.deleteMany({ userId: uid });

  // --- Le compte lui-même : ne doit plus jamais apparaître comme utilisateur ---
  await User.deleteOne({ _id: uid });

  return { affectedGroupIds, deletedPrivateConvIds, notifyOtherUserIds };
}

async function searchUsers(query, limit = 20, skip = 0) {
  const regex = new RegExp('^' + escapeRegex(query), 'i');
  return User.find({ username: regex, isBanned: { $ne: true } })
    .select('username identity isOnline lastSeen')
    .sort({ isOnline: -1, lastSeen: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
}

async function getOnlineUsers(limit = 30) {
  // On se base sur le flag isOnline (maintenu en temps réel par Socket.IO à la
  // connexion/déconnexion), pas sur un simple délai depuis lastSeen : un délai
  // faisait apparaître un utilisateur comme "en ligne" jusqu'à 2 minutes après
  // sa déconnexion réelle, en désaccord avec les événements user_online/user_offline.
  return User.find({ isOnline: true, isBanned: { $ne: true } })
    .select('username identity isOnline lastSeen')
    .sort({ lastSeen: -1 })
    .limit(limit)
    .lean();
}

async function getAllUsersAdmin(skip = 0, limit = 50) {
  return User.find()
    .select('username roles createdAt lastSeen isSuspended isBanned isOnline')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
}

async function updateUserRole(userId, roles) {
  return User.updateOne({ _id: userId }, { roles });
}

async function suspendUser(userId, val) {
  return User.updateOne({ _id: userId }, { isSuspended: val });
}

async function banUser(userId, val) {
  return User.updateOne({ _id: userId }, { isBanned: val });
}

// Sessions
async function createSession(userId, token, deviceInfo, ipAddress) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  const session = new Session({ userId, token, deviceInfo, ipAddress, expiresAt });
  await session.save();
  return session;
}

async function findSession(token) {
  return Session.findOne({ token, expiresAt: { $gt: new Date() } }).lean();
}

async function touchSession(token) {
  return Session.updateOne({ token }, { lastActive: new Date() });
}

async function deleteSession(token) {
  return Session.deleteOne({ token });
}

async function deleteAllUserSessions(userId) {
  return Session.deleteMany({ userId });
}

async function getUserSessions(userId) {
  return Session.find({ userId, expiresAt: { $gt: new Date() } })
    .sort({ lastActive: -1 })
    .lean();
}

// Conversations
async function findOrCreatePrivateConversation(userA, userB) {
  let conv = await Conversation.findOne({
    type: 'private',
    members: { $all: [userA, userB], $size: 2 },
  }).lean();
  if (!conv) {
    const c = new Conversation({ type: 'private', members: [userA, userB] });
    await c.save();
    conv = c.toObject();
  }
  return conv;
}

async function createGroupConversation(name, ownerId, memberIds) {
  const members = [...new Set([ownerId.toString(), ...memberIds.map(String)])].map(
    (id) => new mongoose.Types.ObjectId(id)
  );
  const c = new Conversation({
    type: 'group',
    name,
    owner: ownerId,
    admins: [ownerId],
    members,
  });
  await c.save();
  return c.toObject();
}

async function getUserConversations(userId, skip = 0, limit = 30) {
  return Conversation.find({ members: userId })
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
}

async function getConversationById(id) {
  return Conversation.findById(id).lean();
}

async function updateConversationLastMessage(convId, messageData) {
  return Conversation.updateOne(
    { _id: convId },
    { lastMessage: messageData, updatedAt: new Date() }
  );
}

async function updateConversationBackground(convId, background) {
  return Conversation.updateOne({ _id: convId }, { background, updatedAt: new Date() });
}

async function addMemberToGroup(convId, userId) {
  return Conversation.updateOne({ _id: convId }, { $addToSet: { members: userId } });
}

async function removeMemberFromGroup(convId, userId) {
  return Conversation.updateOne(
    { _id: convId },
    { $pull: { members: userId, admins: userId } }
  );
}

async function promoteGroupAdmin(convId, userId) {
  return Conversation.updateOne({ _id: convId }, { $addToSet: { admins: userId } });
}

async function demoteGroupAdmin(convId, userId) {
  return Conversation.updateOne({ _id: convId }, { $pull: { admins: userId } });
}

async function updateGroupName(convId, name) {
  return Conversation.updateOne({ _id: convId }, { name, updatedAt: new Date() });
}

// Suppression complète et définitive d'une conversation, groupe ou privée
// (distincte de "quitter le groupe" qui ne retire qu'un membre). Utilisée par
// le propriétaire d'un groupe ainsi que par un admin/owner/modérateur pour
// supprimer n'importe quelle conversation (contrôle total, modération).
// Nettoie les messages et les notifications qui y font référence, sans
// toucher aux publications (Post) qui vivent indépendamment des conversations.
async function deleteGroupConversation(convId) {
  const cid = new mongoose.Types.ObjectId(convId);
  await Message.deleteMany({ conversationId: cid });
  await Notification.deleteMany({ conversationId: cid });
  await Conversation.deleteOne({ _id: cid });
}

async function incrementUnread(convId, userId) {
  const key = `unreadCounts.${userId}`;
  return Conversation.updateOne({ _id: convId }, { $inc: { [key]: 1 } });
}

async function resetUnread(convId, userId) {
  const key = `unreadCounts.${userId}`;
  return Conversation.updateOne({ _id: convId }, { $set: { [key]: 0 } });
}

// Messages
async function createMessage(data) {
  const expiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days
  const msg = new Message({ ...data, expiresAt });
  await msg.save();
  return msg.toObject();
}

async function getMessages(conversationId, before = null, limit = 30) {
  const query = {
    conversationId,
    deleted: { $ne: true },
  };
  if (before) {
    query.createdAt = { $lt: new Date(before) };
  }
  return Message.find(query).sort({ createdAt: -1 }).limit(limit).lean();
}

async function getMessageById(id) {
  return Message.findById(id).lean();
}

async function editMessage(messageId, content) {
  return Message.updateOne(
    { _id: messageId, expiresAt: { $gt: new Date() } },
    { content, editedAt: new Date() }
  );
}

async function deleteMessage(messageId) {
  return Message.updateOne({ _id: messageId }, { deleted: true, content: '' });
}

async function permanentDeleteMessage(messageId) {
  return Message.deleteOne({ _id: messageId });
}

async function addReaction(messageId, userId, reactionType) {
  await Message.updateOne(
    { _id: messageId },
    { $pull: { reactions: { userId } } }
  );
  return Message.updateOne(
    { _id: messageId },
    { $push: { reactions: { userId, type: reactionType } } }
  );
}

async function removeReaction(messageId, userId) {
  return Message.updateOne({ _id: messageId }, { $pull: { reactions: { userId } } });
}

async function pinMessage(messageId, pinned) {
  return Message.updateOne({ _id: messageId }, { pinned });
}

async function markMessagesSeen(conversationId, userId, beforeDate) {
  return Message.updateMany(
    {
      conversationId,
      senderId: { $ne: userId },
      seenBy: { $ne: userId },
      createdAt: { $lte: beforeDate || new Date() },
    },
    { $addToSet: { seenBy: userId } }
  );
}

async function getPinnedMessages(conversationId) {
  return Message.find({ conversationId, pinned: true, deleted: { $ne: true } })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();
}

// Expired message cleanup
async function cleanupExpiredMessages() {
  const result = await Message.updateMany(
    { expiresAt: { $lt: new Date() }, deleted: { $ne: true } },
    { $set: { content: '', type: 'expired', deleted: false } }
  );
  return result.modifiedCount;
}

// Notifications
async function createNotification(data) {
  const n = new Notification(data);
  await n.save();
  return n.toObject();
}

async function getUserNotifications(userId, skip = 0, limit = 20) {
  return Notification.find({ userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
}

async function markNotificationRead(notificationId, userId) {
  return Notification.updateOne({ _id: notificationId, userId }, { read: true });
}

async function markAllNotificationsRead(userId) {
  return Notification.updateMany({ userId, read: false }, { read: true });
}

async function getUnreadNotificationCount(userId) {
  return Notification.countDocuments({ userId, read: false });
}

// Reports
async function createReport(data) {
  const r = new Report(data);
  await r.save();
  return r.toObject();
}

async function getReports(status = 'pending', skip = 0, limit = 30) {
  const query = status === 'all' ? {} : { status };
  return Report.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
}

async function updateReportStatus(reportId, status, reviewedBy) {
  return Report.updateOne(
    { _id: reportId },
    { status, reviewedBy, reviewedAt: new Date() }
  );
}

// Posts (Publications)
async function createPost(data) {
  const p = new Post(data);
  await p.save();
  return p.toObject();
}

async function getPosts(skip = 0, limit = 20) {
  return Post.find({ deleted: { $ne: true } })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
}

async function getPostsByAuthor(authorId, skip = 0, limit = 20) {
  return Post.find({ authorId, deleted: { $ne: true } })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
}

async function getPostById(id) {
  return Post.findOne({ _id: id, deleted: { $ne: true } }).lean();
}

async function getPostsByIds(ids) {
  return Post.find({ _id: { $in: ids } }).lean();
}

async function deletePost(id) {
  await PostLike.deleteMany({ postId: id });
  return Post.updateOne({ _id: id }, { deleted: true });
}

// Bascule le like (idempotent) sans jamais charger la liste complète des likes.
async function togglePostLike(postId, userId) {
  const existing = await PostLike.findOne({ postId, userId }).lean();
  if (existing) {
    await PostLike.deleteOne({ _id: existing._id });
    const updated = await Post.findOneAndUpdate(
      { _id: postId },
      { $inc: { likesCount: -1 } },
      { new: true }
    ).select('likesCount').lean();
    return { liked: false, likesCount: Math.max(0, updated?.likesCount || 0) };
  }
  try {
    await PostLike.create({ postId, userId });
  } catch (err) {
    // Course concurrente sur l'index unique : quelqu'un a liké entretemps, on
    // considère simplement l'état comme "déjà liké".
    if (err.code !== 11000) throw err;
  }
  const updated = await Post.findOneAndUpdate(
    { _id: postId },
    { $inc: { likesCount: 1 } },
    { new: true }
  ).select('likesCount').lean();
  return { liked: true, likesCount: updated?.likesCount || 0 };
}

// Pour une page de résultats de posts : quels posts l'utilisateur courant a-t-il likés ?
async function getLikedPostIds(userId, postIds) {
  const likes = await PostLike.find({ userId, postId: { $in: postIds } }).select('postId').lean();
  return new Set(likes.map((l) => l.postId.toString()));
}

// Le partage référence toujours le post ORIGINAL (jamais un partage d'un
// partage) : aucune duplication de contenu ou de média.
async function createSharedPost(userId, originalPostId, description) {
  const original = await Post.findOne({ _id: originalPostId, deleted: { $ne: true } }).lean();
  if (!original) return null;
  const rootId = original.sharedFrom ? original.sharedFrom : original._id;
  const shared = await createPost({
    authorId: userId,
    content: '',
    mediaType: 'none',
    mediaUrl: '',
    description: description || '',
    sharedFrom: rootId,
  });
  await Post.updateOne({ _id: rootId }, { $inc: { sharesCount: 1 } });
  return shared;
}

// Incrémente le compteur de partages d'une publication (toujours la publication
// racine, jamais un partage intermédiaire) sans jamais dupliquer son contenu.
async function incrementPostShares(postId) {
  return Post.updateOne({ _id: postId }, { $inc: { sharesCount: 1 } });
}

// Utilities
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generateIdentity(userId) {
  const id = userId.toString();
  const colors = [
    ['#6C63FF', '#A78BFA'],
    ['#F59E0B', '#FCD34D'],
    ['#10B981', '#6EE7B7'],
    ['#EF4444', '#FCA5A5'],
    ['#3B82F6', '#93C5FD'],
    ['#EC4899', '#F9A8D4'],
    ['#8B5CF6', '#C4B5FD'],
    ['#06B6D4', '#67E8F9'],
    ['#84CC16', '#BEF264'],
    ['#F97316', '#FED7AA'],
  ];
  const shapes = ['circle', 'square', 'diamond', 'hexagon'];
  const patterns = ['dots', 'lines', 'grid', 'waves', 'none'];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) & 0xffffffff;
  }
  const absHash = Math.abs(hash);
  const colorPair = colors[absHash % colors.length];
  const shape = shapes[(absHash >> 4) % shapes.length];
  const pattern = patterns[(absHash >> 8) % patterns.length];
  return { colorA: colorPair[0], colorB: colorPair[1], shape, pattern };
}

module.exports = {
  connect,
  User, Session, Conversation, Message, Notification, Report, Post, PostLike,
  createUser, findUserByUsername, findUserById, findUsersByIds,
  updateUserLastSeen, updateUserOnlineStatus, updateUserSettings,
  updateUserPassword, updateUsername, blockUser, unblockUser,
  addFcmToken, removeFcmToken, deleteUserAccount,
  searchUsers, getOnlineUsers, getAllUsersAdmin, updateUserRole,
  suspendUser, banUser,
  createSession, findSession, touchSession, deleteSession,
  deleteAllUserSessions, getUserSessions,
  findOrCreatePrivateConversation, createGroupConversation,
  getUserConversations, getConversationById, updateConversationLastMessage,
  updateConversationBackground, addMemberToGroup, removeMemberFromGroup,
  promoteGroupAdmin, demoteGroupAdmin, updateGroupName, deleteGroupConversation,
  incrementUnread, resetUnread,
  createMessage, getMessages, getMessageById, editMessage,
  deleteMessage, permanentDeleteMessage, addReaction, removeReaction,
  pinMessage, markMessagesSeen, getPinnedMessages, cleanupExpiredMessages,
  createNotification, getUserNotifications, markNotificationRead,
  markAllNotificationsRead, getUnreadNotificationCount,
  createReport, getReports, updateReportStatus,
  createPost, getPosts, getPostsByAuthor, getPostById, getPostsByIds, deletePost,
  togglePostLike, getLikedPostIds, createSharedPost,
  generateIdentity,
};
