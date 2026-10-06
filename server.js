const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const questions = require('./data/questions.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const POINTS = [50, 40, 30, 20, 10, 5];

function roomCode() {
  let code;
  do code = crypto.randomBytes(3).toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 5);
  while (!code || rooms.has(code));
  return code.padEnd(5, 'X');
}
function cleanName(name) { return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 18); }
function cleanAnswer(answer) { return String(answer || '').trim().replace(/\s+/g, ' ').slice(0, 100); }
function publicRoom(room) {
  return {
    code: room.code,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score, attempted: p.attempted, connected: p.connected })),
    status: room.status,
    currentPlayerId: room.currentPlayerId,
    question: room.question ? { id: room.question.id, question: room.question.question } : null,
    revealed: room.revealed,
    submittedAnswer: room.submittedAnswer,
    resolved: room.resolved,
    winner: room.winner
  };
}
function broadcast(room) { io.to(room.code).emit('room:update', publicRoom(room)); }
function emitError(socket, message) { socket.emit('game:error', { message }); }
function getRoom(socket, code) { const room = rooms.get(String(code || '').toUpperCase()); if (!room) emitError(socket, 'Room not found. Check the code and try again.'); return room; }
function resetRound(room, question) {
  room.question = question;
  room.status = 'playing';
  room.currentPlayerId = null;
  room.revealed = [];
  room.submittedAnswer = null;
  room.resolved = false;
  room.winner = null;
  room.players.forEach(p => { p.attempted = false; });
}
function nextEligible(room, fromId = null) {
  const list = [...room.players.values()].filter(p => p.connected);
  if (!list.length) return null;
  let start = fromId ? Math.max(0, list.findIndex(p => p.id === fromId) + 1) : 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[(start + i) % list.length];
    if (!p.attempted) return p.id;
  }
  return null;
}
function endRound(room) {
  room.status = 'ended';
  room.currentPlayerId = null;
  room.submittedAnswer = null;
  room.resolved = false;
}

io.on('connection', socket => {
  socket.on('host:create', () => {
    const code = roomCode();
    const room = { code, hostId: socket.id, players: new Map(), status: 'lobby', question: null, revealed: [], currentPlayerId: null, submittedAnswer: null, resolved: false, winner: null };
    rooms.set(code, room);
    socket.join(code);
    socket.data.role = 'host'; socket.data.roomCode = code;
    socket.emit('host:created', { code });
    broadcast(room);
  });

  socket.on('player:join', ({ code, name }) => {
    const room = getRoom(socket, code);
    if (!room) return;
    if (room.status !== 'lobby') return emitError(socket, 'This game has already started.');
    const clean = cleanName(name);
    if (!clean) return emitError(socket, 'Please enter your name.');
    if ([...room.players.values()].some(p => p.name.toLowerCase() === clean.toLowerCase())) return emitError(socket, 'That name is already in the room.');
    const player = { id: socket.id, name: clean, score: 0, attempted: false, connected: true };
    room.players.set(socket.id, player);
    socket.join(room.code);
    socket.data.role = 'player'; socket.data.roomCode = room.code;
    socket.emit('player:joined', { code: room.code, playerId: socket.id });
    broadcast(room);
  });

  socket.on('host:start', ({ code, questionId }) => {
    const room = getRoom(socket, code);
    if (!room || room.hostId !== socket.id) return;
    if (!room.players.size) return emitError(socket, 'Add at least one player before starting.');
    const question = questionId ? questions.find(q => q.id === Number(questionId)) : questions[Math.floor(Math.random() * questions.length)];
    if (!question) return emitError(socket, 'Question not found.');
    resetRound(room, question);
    room.currentPlayerId = nextEligible(room);
    broadcast(room);
  });

  socket.on('host:resolve', ({ code, answerIndex }) => {
    const room = getRoom(socket, code);
    if (!room || room.hostId !== socket.id) return;
    if (room.status !== 'playing' || !room.currentPlayerId || !room.submittedAnswer || room.resolved) return emitError(socket, 'There is no answer waiting to be resolved.');
    const index = Number(answerIndex);
    if (!Number.isInteger(index) || index < 0 || index >= 6 || room.revealed.includes(index)) return emitError(socket, 'That answer is unavailable.');
    const player = room.players.get(room.currentPlayerId);
    const answer = room.question.answers[index];
    player.score += answer.points;
    player.attempted = true;
    room.revealed.push(index);
    room.resolved = true;
    broadcast(room);
  });

  socket.on('host:wrong', ({ code }) => {
    const room = getRoom(socket, code);
    if (!room || room.hostId !== socket.id) return;
    if (room.status !== 'playing' || !room.currentPlayerId || !room.submittedAnswer || room.resolved) return emitError(socket, 'There is no answer waiting to be resolved.');
    const player = room.players.get(room.currentPlayerId);
    if (player) player.attempted = true;
    room.resolved = true;
    broadcast(room);
  });

  socket.on('host:next', ({ code }) => {
    const room = getRoom(socket, code);
    if (!room || room.hostId !== socket.id) return;
    if (room.status !== 'playing' || !room.resolved) return emitError(socket, 'Resolve the current answer first.');
    if (room.revealed.length === 6 || !nextEligible(room, room.currentPlayerId)) { endRound(room); broadcast(room); return; }
    room.currentPlayerId = nextEligible(room, room.currentPlayerId);
    room.submittedAnswer = null;
    room.resolved = false;
    broadcast(room);
  });

  socket.on('player:submit', ({ code, answer }) => {
    const room = getRoom(socket, code);
    if (!room || room.status !== 'playing') return emitError(socket, 'The round is not accepting answers.');
    if (room.currentPlayerId !== socket.id) return emitError(socket, 'It is not your turn.');
    const player = room.players.get(socket.id);
    if (!player || player.attempted || room.submittedAnswer) return emitError(socket, 'Your answer is already locked.');
    const clean = cleanAnswer(answer);
    if (!clean) return emitError(socket, 'Type an answer before locking it in.');
    room.submittedAnswer = clean;
    broadcast(room);
  });

  socket.on('host:reset', ({ code }) => {
    const room = getRoom(socket, code);
    if (!room || room.hostId !== socket.id) return;
    room.status = 'lobby'; room.question = null; room.revealed = []; room.currentPlayerId = null; room.submittedAnswer = null; room.resolved = false;
    room.players.forEach(p => { p.score = 0; p.attempted = false; });
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    if (room.hostId === socket.id) {
      room.status = 'host-disconnected';
      io.to(code).emit('host:disconnected');
      broadcast(room);
      return;
    }
    const player = room.players.get(socket.id);
    if (player) {
      const wasCurrent = room.currentPlayerId === socket.id;
      room.players.delete(socket.id);
      if (wasCurrent && room.status === 'playing') {
        room.submittedAnswer = null; room.resolved = false;
        room.currentPlayerId = nextEligible(room);
        if (!room.currentPlayerId) endRound(room);
      }
      broadcast(room);
    }
  });
});

server.listen(PORT, () => console.log(`SUSTAINI-FEUD running on port ${PORT}`));
