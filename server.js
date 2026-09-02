// ============================================================
//  反射神経バトル (Reflex Battle) - サーバー [Render公開版]
//  Node.js 標準モジュールのみで動作（npm install 不要）
//  ・SSEで「よーいドン」合図とランキングを配信
//  ・反応時間は各スマホ側で計測（通信遅延の影響なし＝公平）
//  ・PORT環境変数対応（Renderでそのまま動作）
//  ・認証不要 → iPhone/Androidどちらもそのまま参加OK
//
//  ★リセット2種類：
//    /api/reset      … タイムのみ（参加者は残す）
//    /api/reset-all  … 参加者も含めて全リセット
//  ★再入場対応：
//    /api/rejoin     … 保存したIDで同じ人として復帰（記録も維持）
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

// ---------- ゲーム状態 ----------
const players = new Map();       // id -> {name, best, times[], fouls, lastRound}
const playerClients = new Map(); // id -> res
const hostClients = new Set();
let round = { id: 0, active: false, startedAt: 0 };

const uid = () => Math.random().toString(36).slice(2, 10);

function send(res, event, data) {
  try { res.write(`event: ${event}\n`); res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
}
function broadcastPlayers(event, data) { for (const res of playerClients.values()) send(res, event, data); }
function broadcastHosts(event, data) { for (const res of hostClients) send(res, event, data); }

function leaderboard() {
  return [...players.values()]
    .filter(p => p.best != null)
    .sort((a, b) => a.best - b.best)
    .map((p, i) => ({ rank: i + 1, name: p.name, best: p.best, tries: p.times.length }));
}
function stats() {
  const withScore = [...players.values()].filter(p => p.best != null);
  return { joined: players.size, answered: withScore.length, round: round.id, active: round.active };
}
function pushLeaderboard() { broadcastHosts('leaderboard', { board: leaderboard(), stats: stats() }); }

function serveFile(res, file, type) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': type });
    res.end(buf);
  });
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', c => (b += c));
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (p === '/healthz') { res.writeHead(200); return res.end('ok'); }

  if (p === '/' || p === '/player') return serveFile(res, path.join(PUBLIC, 'player.html'), 'text/html; charset=utf-8');
  if (p === '/host')                return serveFile(res, path.join(PUBLIC, 'host.html'),   'text/html; charset=utf-8');

  // SSE: プレイヤー
  if (p === '/events/player') {
    const id = url.searchParams.get('id');
    if (!id || !players.has(id)) { res.writeHead(400); return res.end('bad id'); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write('\n');
    playerClients.set(id, res);
    send(res, 'hello', { id, round });
    req.on('close', () => playerClients.delete(id));
    return;
  }

  // SSE: ホスト
  if (p === '/events/host') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write('\n');
    hostClients.add(res);
    send(res, 'leaderboard', { board: leaderboard(), stats: stats() });
    req.on('close', () => hostClients.delete(res));
    return;
  }

  // 新規参加
  if (req.method === 'POST' && p === '/api/join') {
    const { name } = await readBody(req);
    const nm = (name || '').toString().trim().slice(0, 20) || '名無し';
    const id = uid();
    players.set(id, { name: nm, best: null, times: [], fouls: 0, lastRound: 0 });
    pushLeaderboard();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ id, name: nm, round }));
  }

  // 再入場：保存済みのIDで同じ人として復帰
  if (req.method === 'POST' && p === '/api/rejoin') {
    const { id, name } = await readBody(req);
    const nm = (name || '').toString().trim().slice(0, 20) || '名無し';
    if (id && players.has(id)) {
      // サーバーにまだ本人が残っている → そのまま復帰（記録も維持）
      const pl = players.get(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id, name: pl.name, round, restored: true }));
    }
    if (id) {
      // 本人はもういない（全リセット後など） → 同じIDと名前で作り直し
      players.set(id, { name: nm, best: null, times: [], fouls: 0, lastRound: 0 });
      pushLeaderboard();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id, name: nm, round, restored: false }));
    }
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false }));
  }

  // 結果送信
  if (req.method === 'POST' && p === '/api/result') {
    const { id, roundId, timeMs, foul } = await readBody(req);
    const pl = players.get(id);
    if (pl && roundId === round.id) {
      if (foul) {
        pl.fouls++;
      } else if (typeof timeMs === 'number' && timeMs > 0 && timeMs < 60000) {
        pl.times.push(Math.round(timeMs));
        if (pl.best == null || timeMs < pl.best) pl.best = Math.round(timeMs);
      }
      pl.lastRound = round.id;
      pushLeaderboard();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // ラウンド開始
  if (req.method === 'POST' && p === '/api/start') {
    round = { id: round.id + 1, active: true, startedAt: Date.now() };
    broadcastPlayers('round-start', { roundId: round.id });
    broadcastHosts('round-start', { roundId: round.id });
    pushLeaderboard();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, round }));
  }

  // 記録のみリセット（参加者は残す）
  if (req.method === 'POST' && p === '/api/reset') {
    for (const pl of players.values()) { pl.best = null; pl.times = []; pl.fouls = 0; }
    round = { id: 0, active: false, startedAt: 0 };
    broadcastPlayers('reset', {});
    pushLeaderboard();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // 全リセット（参加者も消す）
  if (req.method === 'POST' && p === '/api/reset-all') {
    players.clear();
    round = { id: 0, active: false, startedAt: 0 };
    broadcastPlayers('kick', {});
    pushLeaderboard();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  const nets = os.networkInterfaces();
  let lan = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) { lan = net.address; break; }
    }
  }
  console.log('===================================================');
  console.log('  反射神経バトル サーバー起動！');
  console.log('---------------------------------------------------');
  console.log(`  ホスト画面: http://${lan}:${PORT}/host`);
  console.log(`  参加者用:   http://${lan}:${PORT}/`);
  console.log('===================================================');
});
