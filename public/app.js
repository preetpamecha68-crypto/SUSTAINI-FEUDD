const socket = io();
const app = document.getElementById('app');
const toast = document.getElementById('toast');
let mode = null;
let roomCode = null;
let playerId = null;
let room = null;
let submittedLocal = false;

const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function shell(content, cls = '') {
  app.innerHTML = `<div class="page ${cls}">${content}</div>`;
}

function logo() {
  return `<div class="brand"><span class="brand-star">✦</span><span>SUSTAINI<span class="brand-dash">-</span>FEUD</span></div>`;
}

function home() {
  mode = null;
  room = null;
  roomCode = null;
  playerId = null;
  submittedLocal = false;
  shell(`
    <section class="home-stage">
      <div class="top-line"><span>SUSTAINICITY</span><span>LIVE GAME SHOW</span></div>
      ${logo()}
      <div class="home-kicker">THE SUSTAINABILITY SHOWDOWN</div>
      <h1>Think green.<br><span>Think fast.</span><br>Take the board.</h1>
      <p class="home-copy">A live, host-controlled answer game for the Sustainicity stage.</p>
      <div class="home-actions">
        <button class="game-btn gold" type="button" onclick="hostGame()">HOST A GAME <b>→</b></button>
        <button class="game-btn ghost" type="button" onclick="showJoin()">JOIN A GAME <b>→</b></button>
      </div>
      <div class="rules-strip"><span>6 ANSWERS</span><i></i><span>50 / 40 / 30 / 20 / 10 / 5</span><i></i><span>1 ATTEMPT EACH</span></div>
    </section>`);
}

function showJoin() {
  shell(`
    <section class="center-stage">
      <div class="entry-card">
        ${logo()}
        <div class="section-label">PLAYER ENTRY</div>
        <h2>Join the game.</h2>
        <p>Use the room code shown on the host screen.</p>
        <form onsubmit="joinGame(event)">
          <label>ROOM CODE<input id="join-code" maxlength="5" autocomplete="off" autocapitalize="characters" placeholder="A7K92" required /></label>
          <label>YOUR NAME<input id="join-name" maxlength="18" autocomplete="off" placeholder="Preet" required /></label>
          <button class="game-btn gold full" type="submit">JOIN GAME <b>→</b></button>
        </form>
        <button class="back-btn" type="button" onclick="home()">← Back</button>
      </div>
    </section>`);
  document.getElementById('join-code')?.focus();
}

function hostGame() { socket.emit('host:create'); }

function joinGame(event) {
  event.preventDefault();
  roomCode = document.getElementById('join-code').value.trim().toUpperCase();
  const name = document.getElementById('join-name').value.trim();
  socket.emit('player:join', { code: roomCode, name });
}

function hostLobby() {
  const players = room?.players || [];
  shell(`
    <section class="host-shell">
      <header class="game-header">${logo()}<div class="room-pill">ROOM <strong>${esc(roomCode)}</strong></div></header>
      <div class="lobby-layout">
        <main class="host-lobby-card">
          <div class="section-label">HOST CONTROL</div>
          <h1>Get your players in.</h1>
          <p class="subcopy">Put this code on the projector. Players join from their phones.</p>
          <div class="room-code-big"><span>ROOM CODE</span><strong>${esc(roomCode)}</strong><button type="button" onclick="copyCode()">COPY</button></div>
          <div class="lobby-rule">The game uses one question, six hidden answers and one attempt per player.</div>
          <button class="game-btn gold start-game" type="button" onclick="startRound()" ${players.length ? '' : 'disabled'}>START ROUND <b>→</b></button>
        </main>
        <aside class="roster-card">
          <div class="card-title"><span>PLAYERS IN</span><strong>${players.length}</strong></div>
          <div class="roster-list">${players.length ? players.map((p, i) => `<div class="roster-item"><span class="player-number">${String(i+1).padStart(2,'0')}</span><span class="player-avatar">${esc(p.name.charAt(0).toUpperCase())}</span><strong>${esc(p.name)}</strong><span class="online-dot"></span></div>`).join('') : `<div class="empty-roster"><span>Waiting for players</span><small>Names appear here instantly.</small></div>`}</div>
        </aside>
      </div>
    </section>`);
}

function copyCode() {
  if (navigator.clipboard) navigator.clipboard.writeText(roomCode).then(() => notify('Room code copied'));
  else notify(`Room code: ${roomCode}`);
}

function startRound() { socket.emit('host:start', { code: roomCode }); }

function answerBoardHost() {
  const answers = room?.question?.answers || [];
  return `<div class="feud-board" aria-label="Answer board">${answers.map((answer, i) => {
    const revealed = room.revealed.includes(i);
    const selectable = !!room.submittedAnswer && !room.resolved && !revealed;
    return `<button class="board-row ${revealed ? 'is-revealed' : ''} ${selectable ? 'is-selectable' : ''}" type="button" ${selectable ? '' : 'disabled'} onclick="award(${i})">
      <span class="board-index">${String(i + 1).padStart(2, '0')}</span>
      <span class="board-answer">${revealed ? esc(answer.text) : '<span class="answer-bars">••••••••••••</span>'}</span>
      <span class="board-points">${answer.points}</span>
    </button>`;
  }).join('')}</div>`;
}

function hostGameScreen() {
  const current = room.players?.find(p => p.id === room.currentPlayerId);
  const canResolve = !!room.submittedAnswer && !room.resolved;
  const roundOver = room.status === 'ended';
  shell(`
    <section class="host-shell">
      <header class="game-header">${logo()}<div class="room-pill">ROOM <strong>${esc(roomCode)}</strong></div></header>
      <div class="show-layout">
        <main class="show-main">
          <div class="question-card">
            <div class="question-label">THE QUESTION</div>
            <h1>${esc(room.question?.question || '')}</h1>
            <div class="question-count">${room.revealed.length} / 6 ANSWERS REVEALED</div>
          </div>
          ${answerBoardHost()}
          <div class="contestant-panel">
            <div class="contestant-head">
              <div><span class="small-label">CURRENT PLAYER</span><strong>${esc(current?.name || 'ROUND COMPLETE')}</strong></div>
              <div class="turn-number">${roundOver ? 'FINAL' : 'TURN'}</div>
            </div>
            <div class="answer-window">
              <span class="small-label">PLAYER ANSWER</span>
              <div class="live-answer">${room.submittedAnswer ? `“${esc(room.submittedAnswer)}”` : '<span>Waiting for answer...</span>'}</div>
            </div>
            <div class="host-controls">
              <button class="game-btn wrong" type="button" onclick="wrong()" ${canResolve ? '' : 'disabled'}>WRONG / 0</button>
              <button class="game-btn gold" type="button" onclick="nextPlayer()" ${room.resolved ? '' : 'disabled'}>${roundOver ? 'ROUND COMPLETE' : 'NEXT PLAYER'} ${roundOver ? '' : '<b>→</b>'}</button>
            </div>
            ${roundOver ? '<div class="round-finished">All six answers are revealed or every player has taken their turn.</div>' : '<div class="host-tip">Click the matching answer on the board to award its points. No automatic matching required.</div>'}
          </div>
        </main>
        <aside class="scoreboard-card">
          <div class="scoreboard-heading"><span>LIVE SCORES</span><span>PTS</span></div>
          <div class="score-list">${(room.players || []).map((p, i) => `<div class="score-line ${p.id === room.currentPlayerId ? 'current' : ''}"><span class="score-rank">${String(i+1).padStart(2,'0')}</span><strong>${esc(p.name)}</strong><b>${p.score}</b></div>`).join('')}</div>
          <div class="scoreboard-footer"><span>HOST MODE</span><span>● LIVE</span></div>
        </aside>
      </div>
    </section>`);
}

function award(index) { socket.emit('host:resolve', { code: roomCode, answerIndex: index }); }
function wrong() { socket.emit('host:wrong', { code: roomCode }); }
function nextPlayer() { socket.emit('host:next', { code: roomCode }); }

function playerView() {
  const me = room?.players?.find(p => p.id === playerId);
  const myTurn = room?.currentPlayerId === playerId && room.status === 'playing';
  const ended = room?.status === 'ended';
  const hostDisconnected = room?.status === 'host-disconnected';

  let body;
  if (hostDisconnected) {
    body = `<div class="mobile-status">CONNECTION ENDED</div><h1>Host disconnected.</h1><p>The game host has left the room.</p><button class="back-btn" type="button" onclick="home()">Back to home</button>`;
  } else if (ended) {
    body = `<div class="mobile-status">ROUND COMPLETE</div><h1>Good game, ${esc(me?.name || '')}.</h1><div class="mobile-final-score"><span>YOUR SCORE</span><strong>${me?.score ?? 0}</strong></div><p>Check the host screen for the final board.</p><button class="back-btn" type="button" onclick="home()">Leave game</button>`;
  } else if (myTurn) {
    body = `<div class="your-turn-pill">YOUR TURN</div><h1 class="phone-question">${esc(room.question.question)}</h1><form onsubmit="submitAnswer(event)" class="phone-form"><input id="player-answer" maxlength="100" autocomplete="off" placeholder="Type your answer..." ${submittedLocal ? 'disabled' : ''} required /><button class="game-btn gold full" type="submit" ${submittedLocal ? 'disabled' : ''}>${submittedLocal ? 'ANSWER LOCKED ✓' : 'LOCK IN ANSWER'}</button></form><div class="phone-score"><span>YOUR SCORE</span><strong>${me?.score ?? 0}</strong></div>`;
  } else {
    body = `<div class="waiting-pulse"><span></span></div><div class="mobile-status">${room?.status === 'lobby' ? 'ROOM READY' : 'STAND BY'}</div><h1>Waiting for host...</h1><p>${room?.status === 'lobby' ? 'You are in. The host will start the round shortly.' : 'Watch the host screen. Your turn will appear here.'}</p><div class="phone-score"><span>YOUR SCORE</span><strong>${me?.score ?? 0}</strong></div>`;
  }

  shell(`<section class="phone-stage"><div class="phone-card">${logo()}${body}</div></section>`);
  if (myTurn && !submittedLocal) setTimeout(() => document.getElementById('player-answer')?.focus(), 0);
}

function submitAnswer(event) {
  event.preventDefault();
  if (submittedLocal) return;
  const input = document.getElementById('player-answer');
  const answer = input?.value.trim();
  if (!answer) return;
  submittedLocal = true;
  socket.emit('player:submit', { code: roomCode, answer });
  playerView();
}

function render() {
  if (!mode || !room) return;
  if (mode === 'host') {
    if (room.status === 'lobby') hostLobby();
    else hostGameScreen();
  } else playerView();
}

socket.on('host:created', data => {
  mode = 'host';
  roomCode = data.code;
});

socket.on('player:joined', data => {
  mode = 'player';
  roomCode = data.code;
  playerId = data.playerId;
  submittedLocal = false;
});

socket.on('room:update', data => {
  const oldCurrent = room?.currentPlayerId;
  room = data;
  if (mode === 'player' && room.currentPlayerId !== playerId) submittedLocal = false;
  if (mode === 'player' && oldCurrent !== room.currentPlayerId && room.currentPlayerId === playerId) submittedLocal = false;
  render();
});

socket.on('host:disconnected', () => {
  if (mode === 'player') {
    room = { ...(room || {}), status: 'host-disconnected' };
    playerView();
  }
});

socket.on('game:error', data => notify(data.message));
socket.on('connect', () => { if (!mode) home(); });
socket.on('disconnect', () => { if (mode === 'host') notify('Connection lost. Reconnect to continue.'); });

home();
