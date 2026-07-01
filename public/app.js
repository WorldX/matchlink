import { INTEREST_TAGS, LOOKING_TAGS, COUNTRY_NAMES, LANGUAGE_NAMES } from './tags.js';
import { GIFTS, TOKENS_PER_MINUTE } from './economy.js';
import { getUserId, fetchUser, saveProfile, fetchAdminUsers } from './user.js';

const socket = io();
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

let currentUser = null;
let localStream = null;
let pc = null;
let roomId = null;
let partnerSid = null;
let isInitiator = false;
let iceQueue = [];
let isSearching = false;
let chatStartedAt = null;
let chatTimerInterval = null;
let searchTimer = null;

const pInterests = new Set();
const pLooking = new Set();
let interestPresets = [...INTEREST_TAGS];
let lookingPresets = [...LOOKING_TAGS];

const $ = (id) => document.getElementById(id);

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.nav === name));
  if (name === 'wallet') renderWallet();
  if (name === 'admin') loadAdmin();
}

function updateTokens(n) {
  $('token-balance').textContent = n;
  $('wallet-tokens').textContent = n;
  if (currentUser) currentUser.tokens = n;
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function setStatus(title, sub = '', overlay = true, pulse = false) {
  $('status-text').textContent = title;
  $('status-sub').textContent = sub;
  $('remote-overlay').classList.toggle('hidden', !overlay);
  $('pulse-ring').classList.toggle('hidden', !pulse);
}

function setControls({ searching, connected }) {
  $('btn-start').classList.toggle('hidden', searching || connected);
  $('btn-next').classList.toggle('hidden', !connected);
  $('btn-decline').classList.toggle('hidden', !connected);
  $('btn-stop').classList.toggle('hidden', !searching && !connected);
  $('btn-mute').classList.toggle('hidden', !connected);
  $('btn-cam').classList.toggle('hidden', !connected);
  $('chat-drawer').classList.toggle('hidden', !connected);
  $('match-info').classList.toggle('hidden', !connected);
  $('chat-timer').classList.toggle('hidden', !connected);
}

function startChatTimer() {
  chatStartedAt = Date.now();
  clearInterval(chatTimerInterval);
  chatTimerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - chatStartedAt) / 1000);
    $('chat-timer').textContent = formatTime(s);
  }, 1000);
}

function stopChatTimer() {
  clearInterval(chatTimerInterval);
  chatStartedAt = null;
}

function renderTags(el, presets, selected) {
  el.innerHTML = '';
  presets.forEach((tag) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tag${selected.has(tag) ? ' on' : ''}`;
    b.textContent = tag;
    b.onclick = () => { selected.has(tag) ? selected.delete(tag) : selected.add(tag); b.classList.toggle('on'); };
    el.appendChild(b);
  });
}

function renderGiftGrid() {
  const owned = new Set((currentUser?.gifts || []).map((g) => g.id));
  $('gift-grid').innerHTML = GIFTS.map((g) => `
    <div class="gift-card${owned.has(g.id) ? ' earned' : ''}">
      <div class="gift-emoji">${g.emoji}</div>
      <div class="gift-name">${g.name}</div>
      <div class="gift-req">${g.minMinutes} min chat</div>
      <div class="gift-tokens">+${g.tokens} tokens</div>
    </div>
  `).join('');
}

function renderCollection() {
  const gifts = currentUser?.gifts || [];
  const el = $('gift-collection');
  if (!gifts.length) {
    el.innerHTML = '<p class="empty">Chat longer to earn gifts</p>';
    return;
  }
  el.innerHTML = gifts.map((g) => `
    <div class="collected-gift">
      <span>${g.emoji}</span>
      <span>${g.name}</span>
      <span class="count">×${g.count || 1}</span>
    </div>
  `).join('');
}

function renderWallet() {
  if (!currentUser) return;
  updateTokens(currentUser.tokens);
  renderGiftGrid();
  renderCollection();
}

function showSettlement(data) {
  const toast = $('settlement-toast');
  const sign = data.tokensDelta >= 0 ? '+' : '';
  toast.className = `settlement-toast ${data.tokensDelta >= 0 ? 'positive' : 'negative'}`;
  toast.innerHTML = `
    <strong>${sign}${data.tokensDelta} tokens</strong>
    <div style="color:var(--muted);margin-top:.3rem;font-size:.78rem">${(data.breakdown || []).join(' · ')}</div>
  `;
  toast.classList.remove('hidden');
  updateTokens(data.tokens);
  if (data.gifts) currentUser.gifts = data.gifts;
  setTimeout(() => toast.classList.add('hidden'), 5000);
  showView('wallet');
}

function fillProfileForm() {
  if (!currentUser) return;
  const p = currentUser.profile || {};
  const prefs = currentUser.prefs || {};
  $('p-displayName').value = currentUser.displayName || '';
  $('p-bio').value = p.bio || '';
  $('p-country').value = p.country || '';
  $('p-language').value = p.language || '';
  $('p-ageRange').value = p.ageRange || '';
  $('p-sameCountry').checked = !!prefs.sameCountryOnly;
  $('p-sharedInterest').checked = !!prefs.sharedInterestRequired;
  $('p-minScore').value = String(prefs.minScore || 0);
  pInterests.clear();
  pLooking.clear();
  (p.interests || []).forEach((t) => pInterests.add(t));
  (p.lookingFor || []).forEach((t) => pLooking.add(t));
  renderTags($('p-interests'), interestPresets, pInterests);
  renderTags($('p-looking'), lookingPresets, pLooking);
}

async function loadAdmin() {
  if (!currentUser?.isAdmin) return;
  const users = await fetchAdminUsers(currentUser.id);
  if (!users) return;
  $('admin-stats').innerHTML = `
    <div class="stat-card"><div class="val">${users.length}</div><div class="lbl">Users</div></div>
    <div class="stat-card"><div class="val">${users.reduce((a, u) => a + u.tokens, 0)}</div><div class="lbl">Total tokens</div></div>
    <div class="stat-card"><div class="val">${users.reduce((a, u) => a + u.chatsCompleted, 0)}</div><div class="lbl">Chats</div></div>
  `;
  $('admin-body').innerHTML = users.map((u) => `
    <tr>
      <td>${u.displayName}${u.isAdmin ? ' ⚙️' : ''}</td>
      <td>${u.ip || '—'}</td>
      <td>${u.device}<br><small style="color:var(--muted)">${u.browser}</small></td>
      <td>${u.tokens}</td>
      <td>${u.chatsCompleted}</td>
    </tr>
  `).join('');
}

function cleanupPeer() {
  if (pc) { pc.close(); pc = null; }
  $('remote-video').srcObject = null;
  roomId = null;
  partnerSid = null;
  isInitiator = false;
  iceQueue = [];
  $('chat-msgs').innerHTML = '';
  $('match-info').classList.add('hidden');
  stopChatTimer();
}

async function initMedia() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user' },
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  $('local-video').srcObject = localStream;
  return localStream;
}

async function createPC() {
  pc = new RTCPeerConnection(ICE);
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  pc.ontrack = (e) => { $('remote-video').srcObject = e.streams[0]; setStatus('', '', false); };
  pc.onicecandidate = (e) => { if (e.candidate && roomId) socket.emit('webrtc-ice', { roomId, candidate: e.candidate }); };
  pc.onconnectionstatechange = () => {
    if (pc?.connectionState === 'failed' || pc?.connectionState === 'disconnected') {
      setStatus('Connection lost', 'Tap Next to continue', true, false);
      setControls({ searching: false, connected: false });
    }
  };
}

async function flushIce() {
  if (!pc?.remoteDescription) return;
  while (iceQueue.length) {
    try { await pc.addIceCandidate(new RTCIceCandidate(iceQueue.shift())); } catch { /* */ }
  }
}

async function startMatching() {
  if (pInterests.size === 0 && !(currentUser?.profile?.interests?.length)) {
    setStatus('Add interests first', 'Go to Profile tab', true, false);
    return;
  }
  try { await initMedia(); } catch {
    setStatus('Allow camera & mic', 'Check browser permissions', true, false);
    return;
  }
  cleanupPeer();
  isSearching = true;
  setStatus('Finding match…', 'Matching by your profile', true, true);
  setControls({ searching: true, connected: false });
  socket.emit('join-queue', {});
}

function endChat(exitType) {
  if (roomId) socket.emit('end-chat', { roomId, exitType });
  cleanupPeer();
  isSearching = false;
  setStatus('Ready to match', '', true, false);
  setControls({ searching: false, connected: false });
}

function skipChat(decline = false) {
  if (roomId) socket.emit('skip', { roomId, partnerSid, decline });
  cleanupPeer();
  isSearching = true;
  setStatus('Finding next…', decline ? '−8 tokens for declining' : '', true, true);
  setControls({ searching: true, connected: false });
  socket.emit('join-queue', {});
}

function showMatchInfo(partner, score) {
  $('match-score-bar').textContent = `Compatibility ${score} — ${(partner.matchReasons || []).join(' · ')}`;
  const chips = [...(partner.sharedInterests || []), ...(partner.sharedGoals || [])];
  $('shared-row').innerHTML = chips.map((c) => `<span class="chip">${c}</span>`).join('') || '<span class="chip">New connection</span>';
  $('match-info').classList.remove('hidden');
}

/* ── Socket events ── */
socket.on('registered', (user) => {
  currentUser = user;
  updateTokens(user.tokens);
  fillProfileForm();
  if (user.isAdmin) $('nav-admin').classList.remove('hidden');
});

socket.on('network-stats', ({ online }) => { $('stat-online').textContent = online; });

socket.on('searching', ({ queueSize }) => {
  setStatus('Searching…', `${queueSize} waiting in queue`, true, true);
});

socket.on('matched', async ({ roomId: id, partner, matchScore, isInitiator: init }) => {
  roomId = id;
  isInitiator = init;
  isSearching = false;
  showMatchInfo(partner, matchScore);
  setStatus('Connected!', 'Say hi 👋', true, false);
  setControls({ searching: false, connected: true });
  startChatTimer();
  await createPC();
  if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc-offer', { roomId, offer });
  }
});

socket.on('webrtc-offer', async ({ offer, from }) => {
  partnerSid = from;
  if (!pc) await createPC();
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  await flushIce();
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('webrtc-answer', { roomId, answer });
});

socket.on('webrtc-answer', async ({ answer }) => {
  if (!pc) return;
  await pc.setRemoteDescription(new RTCSessionDescription(answer));
  await flushIce();
});

socket.on('webrtc-ice', async ({ candidate, from }) => {
  if (from) partnerSid = from;
  if (!candidate) return;
  if (pc?.remoteDescription) {
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { iceQueue.push(candidate); }
  } else iceQueue.push(candidate);
});

socket.on('chat-message', ({ message }) => {
  const d = document.createElement('div');
  d.className = 'them';
  d.textContent = `Them: ${message}`;
  $('chat-msgs').appendChild(d);
  $('chat-msgs').scrollTop = $('chat-msgs').scrollHeight;
});

socket.on('chat-settled', (data) => showSettlement(data));

socket.on('partner-skipped', () => {
  cleanupPeer();
  isSearching = true;
  setStatus('They skipped', 'Finding next match…', true, true);
  setControls({ searching: true, connected: false });
  socket.emit('join-queue', {});
});

socket.on('partner-ended', () => {
  cleanupPeer();
  setStatus('Chat ended', 'Check your wallet for rewards', true, false);
  setControls({ searching: false, connected: false });
});

/* ── UI bindings ── */
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.nav));
});

$('btn-start').onclick = startMatching;
$('btn-stop').onclick = () => { socket.emit('leave-queue'); endChat('stop'); };
$('btn-next').onclick = () => skipChat(false);
$('btn-decline').onclick = () => skipChat(true);

$('btn-mute').onclick = () => {
  const t = localStream?.getAudioTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  $('btn-mute').classList.toggle('off', !t.enabled);
  $('btn-mute').textContent = t.enabled ? '🎤' : '🔇';
};

$('btn-cam').onclick = () => {
  const t = localStream?.getVideoTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  $('btn-cam').classList.toggle('off', !t.enabled);
  $('btn-cam').textContent = t.enabled ? '📷' : '🚫';
};

$('chat-form').onsubmit = (e) => {
  e.preventDefault();
  const msg = $('chat-input').value.trim();
  if (!msg || !roomId) return;
  socket.emit('chat-message', { roomId, message: msg });
  const d = document.createElement('div');
  d.textContent = `You: ${msg}`;
  $('chat-msgs').appendChild(d);
  $('chat-input').value = '';
};

$('profile-form').onsubmit = async (e) => {
  e.preventDefault();
  const data = {
    displayName: $('p-displayName').value,
    bio: $('p-bio').value,
    country: $('p-country').value,
    language: $('p-language').value,
    ageRange: $('p-ageRange').value,
    interests: [...pInterests],
    lookingFor: [...pLooking],
    prefs: {
      sameCountryOnly: $('p-sameCountry').checked,
      sharedInterestRequired: $('p-sharedInterest').checked,
      minScore: Number($('p-minScore').value),
    },
  };
  const user = await saveProfile(getUserId(), data);
  currentUser = user;
  updateTokens(user.tokens);
  $('save-status').textContent = '✓ Profile saved';
  setTimeout(() => { $('save-status').textContent = ''; }, 2500);
};

$('p-custom-interest').onkeydown = (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const v = e.target.value.trim().toLowerCase();
  if (!v) return;
  pInterests.add(v);
  if (!interestPresets.includes(v)) interestPresets.push(v);
  renderTags($('p-interests'), interestPresets, pInterests);
  e.target.value = '';
};

$('p-custom-looking').onkeydown = (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const v = e.target.value.trim().toLowerCase();
  if (!v) return;
  pLooking.add(v);
  if (!lookingPresets.includes(v)) lookingPresets.push(v);
  renderTags($('p-looking'), lookingPresets, pLooking);
  e.target.value = '';
};

/* ── Init ── */
const uid = getUserId();
socket.emit('register', { userId: uid });
fetchUser(uid).then((u) => { if (u) { currentUser = u; updateTokens(u.tokens); fillProfileForm(); if (u.isAdmin) $('nav-admin').classList.remove('hidden'); } });
renderGiftGrid();
setControls({ searching: false, connected: false });
setStatus('Ready to match', `Earn ${TOKENS_PER_MINUTE} tokens/min · 8 gifts to collect`, true, false);
