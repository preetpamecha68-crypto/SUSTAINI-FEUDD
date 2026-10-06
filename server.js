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
app.get('/api/questions', (_req, res) => res.json(questions.map(q => ({ id: q.id, question: q.question }))));

const BASE_POINTS = [50, 40, 30, 20, 10, 5];
const SECOND_CHANCE_MULTIPLIER = 0.9;
const WRONG_PENALTY = 10;

function roomCode() {
  let code;
  do code = crypto.randomBytes(3).toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 5);
  while (!code || rooms.has(code));
  return code.padEnd(5, 'X');
}
function cleanName(name) { return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 18); }
function cleanAnswer(answer) { return String(answer || '').trim().replace(/\s+/g, ' ').slice(0, 100); }
function secondChancePoints(points) { return Math.max(1, Math.round(points * SECOND_CHANCE_MULTIPLIER)); }
function publicRoom(room) {
  return {
    code: room.code,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected })),
    status: room.status,
    question: room.question ? { id: room.question.id, question: room.question.question } : null,
    revealed: room.revealed,
    buzzWinnerId: room.buzzWinnerId,
    answererId: room.answererId,
    chance: room.chance,
    submittedAnswer: room.submittedAnswer,
    resolved: room.resolved,
    lastResult: room.lastResult,
    secondChancePoints: room.secondChancePoints
  };
}
function broadcast(room) { io.to(room.code).emit('room:update', publicRoom(room)); }
function emitError(socket, message) { socket.emit('game:error', { message }); }
function getRoom(socket, code) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) emitError(socket, 'Room not found. Check the code and try again.');
  return room;
}
function resetRound(room, question) {
  room.question = question;
  room.status = 'buzzing';
  room.revealed = [];
  room.buzzWinnerId = null;
  room.answererId = null;
  room.chance = 0;
  room.submittedAnswer = null;
  room.resolved = false;
  room.lastResult = null;
  room.secondChancePoints = null;
}
function endRound(room) {
  room.status = 'ended';
  room.buzzWinnerId = null;
  room.answererId = null;
  room.submittedAnswer = null;
  room.resolved = false;
}
function otherPlayerId(room, playerId) {
  return [...room.players.values()].find(p => p.id !== playerId && p.connected)?.id || null;
}

io.on('connection', socket => {
  socket.on('host:create', () => {
    const code = roomCode();
    const room = {
      code,
      hostId: socket.id,
      players: new Map(),
      status: 'lobby',
      question: null,
      revealed: [],
      buzzWinnerId: null,
      answererId: null,
      chance: 0,
      submittedAnswer: null,
      resolved: false,
      lastResult: null,
      secondChancePoints: null
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.role = 'host';
    socket.data.roomCode = code;
    socket.emit('host:created', { code, questions });
    broadcast(room);
  });

  socket.on('player:join', ({ code, name }) => {
    const room = getRoom(socket, code);
    if (!room) return;
    if (room.status !== 'lobby' && room.status !== 'selection') return emitError(socket, 'This game has already started.');
    if (room.players.size >= 2) return emitError(socket, 'This game is limited to two competitors.');
    const clean = cleanName(name);
    if (!clean) return emitError(socket, 'Please enter your name.');
    if ([...room.players.values()].some(p => p.name.toLowerCase() === clean.toLowerCase())) return emitError(socket, 'That name is already in the room.');
    const player = { id: socket.id, name: clean, score: 0, connected: true };
    room.players.set(socket.id, player);
    socket.join(room.code);
    socket.data.role = 'player';
    socket.data.roomCode = room.code;
    socket.emit('player:joined', { code: room.code, playerId: socket.id });
    broadcast(room);
  });

  socket.on('host:load-questions', ({ code }) => {
    const room = getRoom(socket, code);
    if (!room || room.hostId !== socket.id) return;
    socket.emit('host:question-bank', { questions });
  });

  socket.on('host:start', ({ code, questionId }) => {
    const room = getRoom(socket, code);
    if (!room || room.hostId !== socket.id) return;
    if (room.players.size !== 2) return emitError(socket, 'Add exactly two competitors before starting.');
    const question = questions.find(q => q.id === Number(questionId));
    if (!question) return emitError(socket, 'Please select a question first.');
    resetRound(room, question);
    socket.emit('host:round', { question });
    broadcast(room);
  });

  socket.on('host:question-select', ({ code }) => {
    const room = getRoom(socket, code);
    if (!room || room.hostId !== socket.id) return;
    if (room.players.size !== 2) return emitError(socket, 'You need exactly two competitors.');
    room.status = 'selection';
    room.question = null;
    room.revealed = [];
    room.buzzWinnerId = null;
    room.answererId = null;
    room.chance = 0;
    room.submittedAnswer = null;
    room.resolved = false;
    room.lastResult = null;
    room.secondChancePoints = null;
    broadcast(room);
  });

  socket.on('player:buzz', ({ code }) => {
    const room = getRoom(socket, code);
    if (!room || room.status !== 'buzzing') return emitError(socket, 'The buzzer is not open.');
    if (!room.players.has(socket.id)) return;
    if (room.players.size !== 2) return emitError(socket, 'The host needs two competitors.');
    if (room.buzzWinnerId) return;
    room.buzzWinnerId = socket.id;
    room.answererId = socket.id;
    room.chance = 1;
    room.status = 'answering';
    room.lastResult = { type: 'buzz', playerId: socket.id, name: room.players.get(socket.id).name };
    broadcast(room);
  });

  socket.on('player:submit', ({ code, answer }) => {
    const room = getRoom(socket, code);
    if (!room || room.status !== 'answering') return emitError(socket, 'It is not answer time.');
    if (room.answererId !== socket.id) return emitError(socket, 'You did not win the buzzer.');
    if (room.submittedAnswer) return emitError(socket, 'Your answer is already locked.');
    const clean = cleanAnswer(answer);
    if (!clean) return emitError(socket, 'Type an answer before locking it in.');
    room.submittedAnswer = clean;
    room.status = 'host-review';
    broadcast(room);
  });

  socket.on('host:resolve', ({ code, answerIndex }) => {
    const room = getRoom(socket, code);
    if (!room || room.hostId !== socket.id) return;
    if (!['host-review'].includes(room.status) || !room.answererId || !room.submittedAnswer || room.resolved) return emitError(socket, 'There is no answer waiting to be resolved.');
    const index = Number(answerIndex);
    if (!Number.isInteger(index) || index < 0 || index >= 6 || room.revealed.includes(index)) return emitError(socket, 'That answer is unavailable.');
    const player = room.players.get(room.answererId);
    const answer = room.question.answers[index];
    const points = room.chance === 1 ? answer.points : secondChancePoints(answer.points);
    player.score += points;
    room.revealed.push(index);
    room.resolved = true;
    room.lastResult = { type: 'correct', playerId: player.id, name: player.name, points, answerIndex: index, chance: room.chance };
    room.status = 'ended';
    broadcast(room);
  });

  socket.on('host:wrong', ({ code }) => {
    const room = getRoom(socket, code);
    if (!room || room.hostId !== socket.id) return;
    if (room.status !== 'host-review' || !room.answererId || !room.submittedAnswer || room.resolved) return emitError(socket, 'There is no answer waiting to be marked wrong.');
    const player = room.players.get(room.answererId);
    if (player) player.score -= WRONG_PENALTY;
    const firstWrong = room.chance === 1;
    room.lastResult = { type: 'wrong', playerId: room.answererId, name: player?.name || 'Player', points: -WRONG_PENALTY, chance: room.chance };
    room.submittedAnswer = null;
    room.resolved = false;

    if (firstWrong) {
      const second = otherPlayerId(room, room.answererId);
      if (second) {
        room.answererId = second;
        room.chance = 2;
        room.status = 'answering';
        room.secondChancePoints = BASE_POINTS.map(secondChancePoints);
      } else {
        endRound(room);
      }
    } else {
      endRound(room);
    }
    broadcast(room);
  });

  socket.on('host:next', ({ code }) => {
    const room = getRoom(socket, code);
    if (!room || room.hostId !== socket.id) return;
    if (room.status !== 'ended') return emitError(socket, 'Finish the question first.');
    room.status = 'selection';
    room.question = null;
    room.revealed = [];
    room.buzzWinnerId = null;
    room.answererId = null;
    room.chance = 0;
    room.submittedAnswer = null;
    room.resolved = false;
    room.lastResult = null;
    room.secondChancePoints = null;
    broadcast(room);
  });

  socket.on('host:reset', ({ code }) => {
    const room = getRoom(socket, code);
    if (!room || room.hostId !== socket.id) return;
    room.status = 'lobby';
    room.question = null;
    room.revealed = [];
    room.buzzWinnerId = null;
    room.answererId = null;
    room.chance = 0;
    room.submittedAnswer = null;
    room.resolved = false;
    room.lastResult = null;
    room.secondChancePoints = null;
    room.players.forEach(p => { p.score = 0; });
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
    if (room.players.has(socket.id)) {
      room.players.delete(socket.id);
      if (room.players.size < 2 && ['buzzing','answering','host-review'].includes(room.status)) {
        room.status = 'lobby';
        room.question = null;
        room.revealed = [];
        room.buzzWinnerId = null;
        room.answererId = null;
        room.chance = 0;
        room.submittedAnswer = null;
        room.resolved = false;
      }
      broadcast(room);
    }
  });
});

server.listen(PORT, () => console.log(`SUSTAINI-FEUD running on port ${PORT}`));
