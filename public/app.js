const socket = io();
const app = document.getElementById('app');
const toast = document.getElementById('toast');
let mode = null;
let roomCode = null;
let playerId = null;
let room = null;
let submittedLocal = false;
let buzzedLocal = false;
let questions = [];
let selectedQuestionId = null;
let seenResultKey = null;

const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const getHostQuestion = () => questions.find(q => q.id === Number(room?.question?.id));

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 2600);
}
function shell(content, cls = '') { app.innerHTML = `<div class="page ${cls}">${content}</div>`; }
function logo() { return `<div class="brand"><span class="brand-mark">SF</span><span>SUSTAINI<span class="brand-dash">-</span>FEUD</span></div>`; }

function home() {
  mode = null; room = null; roomCode = null; playerId = null; submittedLocal = false; buzzedLocal = false; selectedQuestionId = null; seenResultKey = null;
  shell(`<section class="home-stage">
    <div class="top-line"><span>SUSTAINICITY</span><span>LIVE GAME SHOW</span></div>${logo()}
    <div class="home-kicker">THE SUSTAINABILITY SHOWDOWN</div>
    <h1>Think green.<br><span>Think fast.</span><br>Take the board.</h1>
    <p class="home-copy">Two competitors. One buzzer. Six hidden answers. One winner.</p>
    <div class="home-actions"><button class="game-btn gold" type="button" onclick="hostGame()">HOST A GAME <b>→</b></button><button class="game-btn ghost" type="button" onclick="showJoin()">JOIN A GAME <b>→</b></button></div>
    <div class="rules-strip"><span>2 COMPETITORS</span><i></i><span>BUZZ FIRST</span><i></i><span>50 / 40 / 30 / 20 / 10 / 5</span></div>
  </section>`);
}
function showJoin() {
  shell(`<section class="center-stage"><div class="entry-card">${logo()}<div class="section-label">PLAYER ENTRY</div><h2>Join the showdown.</h2><p>Enter the room code shown on the host screen.</p>
    <form onsubmit="joinGame(event)"><label>ROOM CODE<input id="join-code" maxlength="5" autocomplete="off" autocapitalize="characters" placeholder="A7K92" required /></label><label>YOUR NAME<input id="join-name" maxlength="18" autocomplete="off" placeholder="Preet" required /></label><button class="game-btn gold full" type="submit">JOIN GAME <b>→</b></button></form><button class="back-btn" type="button" onclick="home()">← Back</button>
  </div></section>`);
  document.getElementById('join-code')?.focus();
}
function hostGame() { socket.emit('host:create'); }
function joinGame(event) { event.preventDefault(); roomCode = document.getElementById('join-code').value.trim().toUpperCase(); const name = document.getElementById('join-name').value.trim(); socket.emit('player:join', { code: roomCode, name }); }

function questionSelector() {
  const players = room?.players || [];
  const selected = questions.find(q => q.id === Number(selectedQuestionId));
  const statusText = room?.status === 'ended' ? 'QUESTION COMPLETE — CHOOSE THE NEXT ONE' : 'QUESTION SELECT';
  shell(`<section class="host-shell"><header class="game-header">${logo()}<div class="room-pill">ROOM <strong>${esc(roomCode)}</strong></div></header>
    <div class="selection-layout"><main class="question-picker-card"><div class="section-label">${statusText}</div><div class="picker-heading"><div><h1>Choose your question.</h1><p>Your exact survey questions are loaded. Each one has six hidden answers behind the board.</p></div><div class="question-total"><strong>${questions.length}</strong><span>QUESTIONS</span></div></div>
      <div class="question-grid">${questions.map(q => `<button type="button" class="question-option ${Number(selectedQuestionId) === q.id ? 'selected' : ''}" onclick="selectQuestion(${q.id})"><span class="q-number">${String(q.id).padStart(2,'0')}</span><span class="q-copy">${esc(q.question)}</span><span class="q-arrow">${Number(selectedQuestionId) === q.id ? '✓' : '→'}</span></button>`).join('')}</div>
      <div class="picker-footer"><div class="selected-preview">${selected ? `<span>SELECTED</span><strong>Q${String(selected.id).padStart(2,'0')}</strong><em>${esc(selected.question)}</em>` : '<span>NO QUESTION SELECTED</span>'}</div><button class="game-btn gold start-game" type="button" onclick="startSelectedRound()" ${players.length === 2 && selected ? '' : 'disabled'}>START SHOWDOWN <b>→</b></button></div>
    </main><aside class="roster-card"><div class="card-title"><span>COMPETITORS</span><strong>${players.length}/2</strong></div><div class="roster-list">${players.length ? players.map((p, i) => `<div class="roster-item"><span class="player-number">${String(i+1).padStart(2,'0')}</span><span class="player-avatar">${esc(p.name.charAt(0).toUpperCase())}</span><strong>${esc(p.name)}</strong><span class="online-dot"></span></div>`).join('') : `<div class="empty-roster"><span>Waiting for competitors</span><small>Two players are required.</small></div>`}</div><div class="roster-note">Players only see the question and their buzzer. The six answers stay hidden until you reveal one.</div></aside></div>
  </section>`);
}
function selectQuestion(id) { selectedQuestionId = Number(id); render(); }
function startSelectedRound() { if (!selectedQuestionId) return notify('Select a question first.'); socket.emit('host:start', { code: roomCode, questionId: selectedQuestionId }); }
function nextQuestion() { socket.emit('host:next', { code: roomCode }); }

function answerBoardHost() {
  const q = getHostQuestion();
  const answers = q?.answers || [];
  return `<div class="feud-board" aria-label="Answer board">${answers.map((answer, i) => {
    const revealed = room.revealed.includes(i);
    const selectable = room.status === 'host-review' && !!room.submittedAnswer && !revealed;
    const availablePoints = room.chance === 2 ? Math.max(1, Math.round(answer.points * 0.9)) : answer.points;
    return `<button class="board-row ${revealed ? 'is-revealed' : ''} ${selectable ? 'is-selectable' : ''}" type="button" ${selectable ? '' : 'disabled'} onclick="award(${i})"><span class="board-index">${String(i + 1).padStart(2,'0')}</span><span class="board-answer">${revealed ? esc(answer.text) : '<span class="answer-bars">••••••••••••</span>'}</span><span class="board-points">${room.chance === 2 && !revealed ? availablePoints : answer.points}</span></button>`;
  }).join('')}</div>`;
}

function hostGameScreen() {
  const players = room.players || [];
  const answerer = players.find(p => p.id === room.answererId);
  const buzzer = players.find(p => p.id === room.buzzWinnerId);
  const roundOver = room.status === 'ended';
  const reviewing = room.status === 'host-review';
  const answering = room.status === 'answering';
  const canResolve = reviewing && !!room.submittedAnswer;
  let stateTitle = roundOver ? 'QUESTION COMPLETE' : reviewing ? 'HOST DECISION' : answering ? `${esc(answerer?.name || 'PLAYER')} IS ANSWERING` : 'BUZZER OPEN';
  let stateCopy = roundOver ? 'Reveal confirmed. Move to the next question when ready.' : reviewing ? 'Click the matching hidden answer for points, or mark the answer wrong.' : answering ? 'Watch the competitor answer, then judge it from the host screen.' : 'Both competitors are live. First valid buzz wins the first chance.';
  shell(`<section class="host-shell"><header class="game-header">${logo()}<div class="room-pill">ROOM <strong>${esc(roomCode)}</strong></div><button class="header-action" type="button" onclick="nextQuestion()">NEXT QUESTION</button></header>
    <div class="show-layout"><main class="show-main"><div class="question-card"><div class="question-label">QUESTION ${String(room.question?.id || '').padStart(2,'0')}</div><h1>${esc(room.question?.question || '')}</h1><div class="question-count">${room.revealed.length} / 6 ANSWERS REVEALED</div></div>
      ${answerBoardHost()}
      <div class="show-status-card"><div><span class="small-label">${stateTitle}</span><strong>${buzzer ? `BUZZ WINNER: ${esc(buzzer.name)}` : 'READY'}</strong></div><p>${stateCopy}</p>${room.chance === 2 ? `<div class="second-chance-note">SECOND CHANCE • CORRECT ANSWERS PAY 90% • WRONG = -${10}</div>` : ''}</div>
      <div class="contestant-panel"><div class="contestant-head"><div><span class="small-label">CURRENT ANSWERER</span><strong>${esc(answerer?.name || (roundOver ? 'ROUND COMPLETE' : 'Waiting for buzz'))}</strong></div><div class="turn-number">${room.chance ? `CHANCE ${room.chance}` : 'BUZZ'}</div></div>
        <div class="answer-window"><span class="small-label">PLAYER ANSWER</span><div class="live-answer">${room.submittedAnswer ? `“${esc(room.submittedAnswer)}”` : answering ? '<span>Waiting for spoken answer...</span>' : '<span>No answer locked yet.</span>'}</div></div>
        <div class="host-controls"><button class="game-btn wrong" type="button" onclick="wrong()" ${canResolve ? '' : 'disabled'}>✕ WRONG / -10</button><button class="game-btn gold" type="button" onclick="nextQuestion()" ${roundOver ? '' : 'disabled'}>${roundOver ? 'NEXT QUESTION' : 'WAITING'} ${roundOver ? '<b>→</b>' : ''}</button></div>
        <div class="host-tip">${canResolve ? 'Click the hidden answer that matches what the player said. That answer flips open and the points are awarded.' : 'The host controls the official result. The answer board stays hidden from competitors.'}</div>
      </div></main>
      <aside class="scoreboard-card"><div class="scoreboard-heading"><span>LIVE SCORES</span><span>PTS</span></div><div class="score-list">${players.map((p, i) => `<div class="score-line ${p.id === room.answererId ? 'current' : ''}"><span class="score-rank">${String(i+1).padStart(2,'0')}</span><strong>${esc(p.name)}</strong><b>${p.score}</b></div>`).join('')}</div><div class="scoreboard-footer"><span>HOST MODE</span><span>● LIVE</span></div></aside>
    </div></section>`);
}
function award(index) { socket.emit('host:resolve', { code: roomCode, answerIndex: index }); }
function wrong() { socket.emit('host:wrong', { code: roomCode }); }

function showWrongOverlay(name, points, secondChance) {
  const overlay = document.createElement('div');
  overlay.className = 'result-overlay wrong-overlay';
  overlay.innerHTML = `<div class="result-card"><div class="result-icon">✕</div><div class="result-word">WRONG!</div><div class="result-name">${esc(name)}</div><div class="result-points">${points} PTS</div>${secondChance ? '<div class="result-next">SECOND COMPETITOR — BUZZER CHANCE</div>' : ''}</div>`;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 1250);
}
function showCorrectOverlay(points) {
  const overlay = document.createElement('div');
  overlay.className = 'result-overlay correct-overlay';
  overlay.innerHTML = `<div class="result-card"><div class="result-icon">✓</div><div class="result-word">CORRECT!</div><div class="result-points">+${points} PTS</div></div>`;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 1250);
}

function playerView() {
  const me = room?.players?.find(p => p.id === playerId);
  const buzzOpen = room?.status === 'buzzing';
  const iWonBuzz = room?.answererId === playerId && room?.chance;
  const waitingForOther = ['answering','host-review'].includes(room?.status) && room?.answererId !== playerId;
  const ended = room?.status === 'ended';
  const selecting = room?.status === 'selection' || room?.status === 'lobby';
  const hostDisconnected = room?.status === 'host-disconnected';
  let body;
  if (hostDisconnected) body = `<div class="mobile-status">CONNECTION ENDED</div><h1>Host disconnected.</h1><p>The game host has left the room.</p><button class="back-btn" type="button" onclick="home()">Back to home</button>`;
  else if (ended) body = `<div class="mobile-status">QUESTION COMPLETE</div><h1>Nice round, ${esc(me?.name || '')}.</h1><div class="mobile-final-score"><span>YOUR SCORE</span><strong>${me?.score ?? 0}</strong></div><p>Watch the host screen for the next question.</p>`;
  else if (iWonBuzz && room.status === 'answering') body = `<div class="buzz-win-pill">YOU BUZZED FIRST</div><h1 class="phone-question">${esc(room.question.question)}</h1><form onsubmit="submitAnswer(event)" class="phone-form"><input id="player-answer" maxlength="100" autocomplete="off" placeholder="Type your answer..." ${submittedLocal ? 'disabled' : ''} required /><button class="game-btn gold full" type="submit" ${submittedLocal ? 'disabled' : ''}>${submittedLocal ? 'ANSWER LOCKED ✓' : 'LOCK IN ANSWER'}</button></form><div class="phone-score"><span>YOUR SCORE</span><strong>${me?.score ?? 0}</strong></div>`;
  else if (buzzOpen) body = `<div class="buzzer-ring"><span>BUZZ</span></div><div class="mobile-status">BUZZER OPEN</div><h1>Get ready.</h1><p>Tap the buzzer as soon as the host opens the question.</p><button class="game-btn buzzer-btn" type="button" onclick="buzz()" ${buzzedLocal ? 'disabled' : ''}>${buzzedLocal ? 'BUZZED ✓' : 'BUZZ IN!'}</button><div class="phone-score"><span>YOUR SCORE</span><strong>${me?.score ?? 0}</strong></div>`;
  else if (waitingForOther) body = `<div class="waiting-pulse"><span></span></div><div class="mobile-status">${room.chance === 2 ? 'SECOND COMPETITOR' : 'BUZZ LOCKED'}</div><h1>${room.answererId ? esc(room.players.find(p => p.id === room.answererId)?.name || 'Other player') : 'Waiting...'}</h1><p>${room.chance === 2 ? 'The first competitor missed. You now have the chance to answer.' : 'The first competitor is answering. Stay ready.'}</p><div class="phone-score"><span>YOUR SCORE</span><strong>${me?.score ?? 0}</strong></div>`;
  else body = `<div class="waiting-pulse"><span></span></div><div class="mobile-status">${selecting ? 'ROOM READY' : 'STAND BY'}</div><h1>Waiting for host...</h1><p>${selecting ? 'You are in. The host is selecting the next question.' : 'Watch the host screen.'}</p><div class="phone-score"><span>YOUR SCORE</span><strong>${me?.score ?? 0}</strong></div>`;
  shell(`<section class="phone-stage"><div class="phone-card">${logo()}${body}</div></section>`);
  if (iWonBuzz && room.status === 'answering' && !submittedLocal) setTimeout(() => document.getElementById('player-answer')?.focus(), 0);
}
function buzz() { if (buzzedLocal || room?.status !== 'buzzing') return; buzzedLocal = true; socket.emit('player:buzz', { code: roomCode }); playerView(); }
function submitAnswer(event) { event.preventDefault(); if (submittedLocal) return; const input = document.getElementById('player-answer'); const answer = input?.value.trim(); if (!answer) return; submittedLocal = true; socket.emit('player:submit', { code: roomCode, answer }); playerView(); }

function render() {
  if (!mode || !room) return;
  if (mode === 'host') { if (['playing','buzzing','answering','host-review','ended'].includes(room.status)) hostGameScreen(); else questionSelector(); }
  else playerView();
}

socket.on('host:created', data => { mode = 'host'; roomCode = data.code; questions = data.questions || []; render(); });
socket.on('player:joined', data => { mode = 'player'; roomCode = data.code; playerId = data.playerId; submittedLocal = false; buzzedLocal = false; });
socket.on('room:update', data => {
  const oldStatus = room?.status;
  const oldCurrent = room?.answererId;
  room = data;
  if (mode === 'player') {
    if (room.status === 'buzzing' && oldStatus !== 'buzzing') { buzzedLocal = false; submittedLocal = false; }
    if (room.answererId !== oldCurrent && room.answererId === playerId) submittedLocal = false;
    const result = room.lastResult;
    const key = result ? `${result.type}-${result.playerId}-${result.points}-${room.status}-${room.chance}` : null;
    if (result && key !== seenResultKey && result.type === 'wrong' && result.playerId === playerId) {
      showWrongOverlay(result.name, result.points, room.chance === 2 && room.answererId !== playerId);
    }
    if (result && key !== seenResultKey && result.type === 'correct' && result.playerId === playerId) showCorrectOverlay(result.points);
    seenResultKey = key;
  }
  render();
});
socket.on('host:disconnected', () => { if (mode === 'player') { room = { ...(room || {}), status: 'host-disconnected' }; playerView(); } });
socket.on('game:error', data => { notify(data.message); if (mode === 'player' && /buzzer|already|answer time|not your turn/i.test(data.message)) { buzzedLocal = false; submittedLocal = false; playerView(); } });
socket.on('disconnect', () => { if (mode === 'host') notify('Connection lost. Reconnect to continue.'); });
socket.on('connect', () => { if (!mode) home(); });

home();
