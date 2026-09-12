'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const id = () => crypto.randomBytes(12).toString('hex');

const players = new Map();
const playerStreams = new Map();
const hostStreams = new Set();
let generation = id();
let round = { id: 0, active: false, mode: 'reflex', duration: 7, practice: false };
let view = { mode: 'reflex', duration: 7 };
let roundResponses = new Set();
let uniqueGame = { status: 'idle', answers: new Map(), result: null, practice: false };

function newPlayer(name) {
  return {
    name,
    reflexBest: null,
    reflexTries: 0,
    tapBest: {},
    tapTries: {},
    uniquePoints: 0,
    uniqueWins: 0,
    state: 'standby',
    visible: true,
    lastSeen: Date.now()
  };
}
function cleanName(v) { return String(v || '').trim().slice(0, 20) || '名無し'; }
function findByName(name) {
  const key = cleanName(name).toLowerCase();
  for (const [pid, p] of players) if (p.name.toLowerCase() === key) return [pid, p];
  return null;
}
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function readJson(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 100000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
function sse(res, event, data) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
}
function emitPlayers(event, data) { for (const res of playerStreams.values()) sse(res, event, data); }
function emitHosts(event, data) { for (const res of hostStreams) sse(res, event, data); }

function assignRanks(sorted) {
  let prior = null, priorRank = 0;
  return sorted.map((x, i) => {
    const rank = prior !== null && x.score === prior ? priorRank : i + 1;
    prior = x.score; priorRank = rank;
    return { ...x, rank };
  });
}
function leaderboard() {
  if (view.mode === 'unique') {
    const rows = [...players.values()].map(p => ({ name: p.name, score: p.uniquePoints, tries: p.uniqueWins }))
      .filter(x => x.score > 0).sort((a, b) => b.score - a.score);
    return assignRanks(rows);
  }
  if (view.mode === 'tap') {
    const k = String(view.duration);
    const rows = [...players.values()].map(p => ({ name: p.name, score: p.tapBest[k], tries: p.tapTries[k] || 0 }))
      .filter(x => Number.isFinite(x.score)).sort((a, b) => b.score - a.score);
    return assignRanks(rows);
  }
  const rows = [...players.values()].filter(p => Number.isFinite(p.reflexBest))
    .map(p => ({ name: p.name, score: p.reflexBest, tries: p.reflexTries }))
    .sort((a, b) => a.score - b.score);
  return assignRanks(rows);
}
function booby(board) {
  if (view.mode === 'unique' || board.length < 2) return { prize: [], maker: [] };
  const scores = [...new Set(board.map(x => x.score))];
  if (scores.length < 2) return { prize: [], maker: board.map(x => x.name) };
  const makerScore = scores[scores.length - 1];
  const prizeScore = scores[scores.length - 2];
  return {
    prize: board.filter(x => x.score === prizeScore).map(x => x.name),
    maker: board.filter(x => x.score === makerScore).map(x => x.name)
  };
}
function presence() {
  const now = Date.now();
  const detail = [];
  let standby = 0, connected = 0;
  for (const [pid, p] of players) {
    const stream = playerStreams.has(pid);
    const fresh = now - p.lastSeen < 30000;
    const online = stream && fresh;
    if (online) connected++;
    if (online && p.visible && p.state === 'standby') standby++;
    else detail.push({ name: p.name, state: !online ? '切断・未確認' : !p.visible ? '画面非表示' : stateLabel(p.state) });
  }
  return { connected, standby, notStandby: players.size - standby, detail };
}
function stateLabel(v) {
  return ({ countdown: 'カウントダウン', ready: '反射待機', playing: 'プレイ中', result: '結果表示', answering: '回答中' })[v] || v || '未確認';
}
function stats() {
  const p = presence();
  return {
    joined: players.size,
    answered: view.mode === 'unique' ? uniqueGame.answers.size : leaderboard().length,
    round: round.id,
    active: round.active,
    mode: view.mode,
    duration: view.duration,
    practice: round.practice,
    roundCompleted: roundResponses.size,
    uniqueStatus: uniqueGame.status,
    generation,
    ...p
  };
}
function hostPayload() {
  const board = leaderboard();
  return { board, stats: stats(), booby: booby(board), uniqueResult: uniqueGame.result };
}
function pushHost() { emitHosts('leaderboard', hostPayload()); }

function validateSession(body) {
  return body && body.sessionGeneration === generation && players.has(String(body.id || ''));
}
function setState(pid, state, visible) {
  const p = players.get(pid);
  if (!p) return;
  p.state = String(state || p.state);
  p.visible = visible !== false;
  p.lastSeen = Date.now();
}
function evaluateUnique() {
  const counts = new Map();
  for (const n of uniqueGame.answers.values()) counts.set(n, (counts.get(n) || 0) + 1);
  const uniques = [...counts.entries()].filter(([, c]) => c === 1).map(([n]) => n).sort((a, b) => b - a);
  const winningNumber = uniques.length ? uniques[0] : null;
  const winners = [];
  if (winningNumber !== null) {
    for (const [pid, n] of uniqueGame.answers) {
      if (n === winningNumber) {
        winners.push(players.get(pid).name);
        if (!uniqueGame.practice) {
          players.get(pid).uniquePoints += 1;
          players.get(pid).uniqueWins += 1;
        }
      }
    }
  }
  const distribution = [...counts.entries()].sort((a, b) => b[0] - a[0]).map(([number, count]) => ({ number, count, unique: count === 1 }));
  uniqueGame.result = { winningNumber, winners, distribution, practice: uniqueGame.practice };
  uniqueGame.status = 'revealed';
  return uniqueGame.result;
}

function serve(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pth = u.pathname;
  if (pth === '/healthz') return sendJson(res, 200, { ok: true });
  if (pth === '/' || pth === '/player') return serve(res, path.join(PUBLIC, 'player.html'));
  if (pth === '/host') return serve(res, path.join(PUBLIC, 'host.html'));

  if (pth === '/events/player') {
    const pid = u.searchParams.get('id');
    const gen = u.searchParams.get('generation');
    if (gen !== generation) return sendJson(res, 409, { staleSession: true, generation });
    if (!players.has(pid)) return sendJson(res, 404, { playerMissing: true, generation });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('\n');
    const old = playerStreams.get(pid); if (old && old !== res) try { old.end(); } catch {}
    playerStreams.set(pid, res); setState(pid, 'standby', true);
    sse(res, 'hello', { round, generation }); pushHost();
    req.on('close', () => { if (playerStreams.get(pid) === res) playerStreams.delete(pid); pushHost(); });
    return;
  }
  if (pth === '/events/host') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('\n'); hostStreams.add(res); sse(res, 'leaderboard', hostPayload());
    req.on('close', () => hostStreams.delete(res)); return;
  }

  if (req.method === 'POST' && pth === '/api/join') {
    const b = await readJson(req); const name = cleanName(b.name); const prior = findByName(name);
    if (prior) return sendJson(res, 200, { id: prior[0], name: prior[1].name, sessionGeneration: generation, round });
    const pid = id(); const player = newPlayer(name); players.set(pid, player); pushHost();
    return sendJson(res, 200, { id: pid, name, sessionGeneration: generation, round });
  }
  if (req.method === 'POST' && pth === '/api/rejoin') {
    const b = await readJson(req);
    if (b.sessionGeneration !== generation) return sendJson(res, 409, { staleSession: true, sessionGeneration: generation });
    if (players.has(String(b.id || ''))) {
      const pl = players.get(String(b.id)); setState(String(b.id), 'standby', true);
      return sendJson(res, 200, { id: String(b.id), name: pl.name, sessionGeneration: generation, round });
    }
    return sendJson(res, 404, { playerMissing: true, sessionGeneration: generation });
  }
  if (req.method === 'POST' && pth === '/api/state') {
    const b = await readJson(req); if (!validateSession(b)) return sendJson(res, 409, { staleSession: true });
    setState(String(b.id), b.state, b.visible); pushHost(); return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && pth === '/api/select-ranking') {
    const b = await readJson(req); view.mode = ['reflex', 'tap', 'unique'].includes(b.mode) ? b.mode : 'reflex';
    view.duration = [5, 7, 10].includes(Number(b.duration)) ? Number(b.duration) : 7; pushHost();
    return sendJson(res, 200, hostPayload());
  }
  if (req.method === 'POST' && pth === '/api/start') {
    const b = await readJson(req); const mode = b.mode === 'tap' ? 'tap' : 'reflex';
    const duration = [5, 7, 10].includes(Number(b.duration)) ? Number(b.duration) : 7;
    round = { id: round.id + 1, active: true, mode, duration, practice: Boolean(b.practice) };
    view = { mode, duration }; roundResponses = new Set();
    emitPlayers(mode === 'tap' ? 'tap-start' : 'reflex-start', { roundId: round.id, duration, practice: round.practice, countdown: 3, generation });
    emitHosts('round-start', round); pushHost(); return sendJson(res, 200, { ok: true, round });
  }
  if (req.method === 'POST' && pth === '/api/result') {
    const b = await readJson(req); if (!validateSession(b)) return sendJson(res, 409, { staleSession: true });
    if (Number(b.roundId) !== round.id) return sendJson(res, 409, { oldRound: true });
    const pid = String(b.id); const pl = players.get(pid); roundResponses.add(pid); setState(pid, 'result', true);
    if (!round.practice) {
      if (round.mode === 'tap' && Number.isFinite(Number(b.taps))) {
        const k = String(round.duration), n = Math.max(0, Math.round(Number(b.taps)));
        if (!Number.isFinite(pl.tapBest[k]) || n > pl.tapBest[k]) pl.tapBest[k] = n;
        pl.tapTries[k] = (pl.tapTries[k] || 0) + 1;
      } else if (round.mode === 'reflex' && !b.foul && Number.isFinite(Number(b.timeMs)) && Number(b.timeMs) > 0) {
        const n = Math.round(Number(b.timeMs));
        if (!Number.isFinite(pl.reflexBest) || n < pl.reflexBest) pl.reflexBest = n;
        pl.reflexTries++;
      }
    }
    pushHost(); return sendJson(res, 200, { ok: true, practice: round.practice });
  }
  if (req.method === 'POST' && pth === '/api/unique') {
    const b = await readJson(req); const action = b.action;
    if (action === 'open') {
      round = { id: round.id + 1, active: true, mode: 'unique', duration: 0, practice: Boolean(b.practice) };
      view = { mode: 'unique', duration: 0 }; roundResponses = new Set();
      uniqueGame = { status: 'open', answers: new Map(), result: null, practice: round.practice };
      emitPlayers('unique-open', { roundId: round.id, practice: round.practice, generation }); pushHost();
      return sendJson(res, 200, { ok: true });
    }
    if (action === 'close') { uniqueGame.status = 'closed'; emitPlayers('unique-closed', {}); pushHost(); return sendJson(res, 200, { ok: true }); }
    if (action === 'reveal') { const result = evaluateUnique(); emitPlayers('unique-result', result); pushHost(); return sendJson(res, 200, { ok: true, result }); }
    return sendJson(res, 400, { ok: false });
  }
  if (req.method === 'POST' && pth === '/api/unique-answer') {
    const b = await readJson(req); if (!validateSession(b)) return sendJson(res, 409, { staleSession: true });
    if (uniqueGame.status !== 'open') return sendJson(res, 409, { closed: true });
    const n = Number.parseInt(b.number, 10); if (!(n >= 1 && n <= 100)) return sendJson(res, 400, { invalidNumber: true });
    uniqueGame.answers.set(String(b.id), n); roundResponses.add(String(b.id)); setState(String(b.id), 'answering', true); pushHost();
    return sendJson(res, 200, { ok: true, number: n });
  }
  if (req.method === 'POST' && pth === '/api/reset') {
    for (const pl of players.values()) { pl.reflexBest = null; pl.reflexTries = 0; pl.tapBest = {}; pl.tapTries = {}; pl.uniquePoints = 0; pl.uniqueWins = 0; }
    roundResponses = new Set(); uniqueGame = { status: 'idle', answers: new Map(), result: null, practice: false };
    emitPlayers('reset', {}); pushHost(); return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && pth === '/api/reset-all') {
    emitPlayers('kick', {}); for (const r of playerStreams.values()) try { r.end(); } catch {}
    playerStreams.clear(); players.clear(); generation = id(); roundResponses = new Set(); uniqueGame = { status: 'idle', answers: new Map(), result: null, practice: false };
    emitHosts('session-reset', { generation }); pushHost(); return sendJson(res, 200, { ok: true, generation });
  }

  res.writeHead(404); res.end('Not found');
});

setInterval(() => pushHost(), 10000).unref();
server.listen(PORT, '0.0.0.0', () => console.log(`Game server started on ${PORT}`));
