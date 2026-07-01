const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const MATCH_INTERVAL_MS = 1500;

app.use(express.static(path.join(__dirname, 'public')));

const waitingQueue = new Map();

function normalizeInterests(interests) {
  if (!interests) return [];
  if (Array.isArray(interests)) {
    return interests.map((i) => String(i).trim().toLowerCase()).filter(Boolean);
  }
  return String(interests)
    .split(',')
    .map((i) => i.trim().toLowerCase())
    .filter(Boolean);
}

function scorePair(a, b) {
  let score = 0;

  if (a.country && b.country && a.country === b.country) score += 40;
  if (a.language && b.language && a.language === b.language) score += 25;

  const aInterests = new Set(a.interests || []);
  const bInterests = new Set(b.interests || []);
  let overlap = 0;
  for (const interest of aInterests) {
    if (bInterests.has(interest)) overlap++;
  }
  score += overlap * 15;

  if (a.ageRange && b.ageRange && a.ageRange === b.ageRange) score += 10;

  const aLooking = new Set(a.lookingFor || []);
  const bLooking = new Set(b.lookingFor || []);
  for (const tag of aLooking) {
    if (bLooking.has(tag)) score += 5;
  }

  return score;
}

function findBestMatch(userId, profile) {
  let best = null;
  let bestScore = -1;

  for (const [otherId, other] of waitingQueue) {
    if (otherId === userId) continue;

    const forward = scorePair(profile, other.profile);
    const reverse = scorePair(other.profile, profile);
    const combined = forward + reverse;

    if (combined > bestScore) {
      bestScore = combined;
      best = { id: otherId, socket: other.socket, score: combined };
    }
  }

  return best;
}

function pairUsers(userA, userB) {
  waitingQueue.delete(userA.id);
  waitingQueue.delete(userB.id);

  const roomId = `room-${userA.id}-${userB.id}`;

  userA.socket.join(roomId);
  userB.socket.join(roomId);

  userA.socket.emit('matched', {
    roomId,
    partner: sanitizePartner(userB.profile),
    matchScore: userB.score,
    isInitiator: true,
  });

  userB.socket.emit('matched', {
    roomId,
    partner: sanitizePartner(userA.profile),
    matchScore: userA.score,
    isInitiator: false,
  });
}

function sanitizePartner(profile) {
  return {
    country: profile.country || 'Unknown',
    language: profile.language || 'Any',
    interests: profile.interests || [],
    ageRange: profile.ageRange || 'Any',
    lookingFor: profile.lookingFor || [],
  };
}

function tryMatchAll() {
  const entries = [...waitingQueue.entries()];
  const matched = new Set();

  for (const [userId, entry] of entries) {
    if (matched.has(userId)) continue;

    const best = findBestMatch(userId, entry.profile);
    if (!best || matched.has(best.id)) continue;

    matched.add(userId);
    matched.add(best.id);

    pairUsers(
      { id: userId, socket: entry.socket, profile: entry.profile, score: best.score },
      { id: best.id, socket: best.socket, profile: waitingQueue.get(best.id).profile, score: best.score }
    );
  }
}

setInterval(tryMatchAll, MATCH_INTERVAL_MS);

io.on('connection', (socket) => {
  socket.on('join-queue', (data = {}) => {
    const profile = {
      country: (data.country || '').trim(),
      language: (data.language || '').trim(),
      interests: normalizeInterests(data.interests),
      ageRange: (data.ageRange || '').trim(),
      lookingFor: normalizeInterests(data.lookingFor),
    };

    waitingQueue.set(socket.id, { socket, profile, joinedAt: Date.now() });
    socket.emit('searching', { queueSize: waitingQueue.size });
  });

  socket.on('leave-queue', () => {
    waitingQueue.delete(socket.id);
  });

  socket.on('webrtc-offer', ({ roomId, offer }) => {
    socket.to(roomId).emit('webrtc-offer', { offer, from: socket.id });
  });

  socket.on('webrtc-answer', ({ roomId, answer }) => {
    socket.to(roomId).emit('webrtc-answer', { answer, from: socket.id });
  });

  socket.on('webrtc-ice', ({ roomId, candidate }) => {
    socket.to(roomId).emit('webrtc-ice', { candidate, from: socket.id });
  });

  socket.on('chat-message', ({ roomId, message }) => {
    socket.to(roomId).emit('chat-message', { message, from: socket.id });
  });

  socket.on('skip', ({ roomId }) => {
    socket.to(roomId).emit('partner-skipped');
    socket.leave(roomId);
    socket.emit('searching', { queueSize: waitingQueue.size });
  });

  socket.on('disconnect', () => {
    waitingQueue.delete(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`MatchLink running at http://localhost:${PORT}`);
});
