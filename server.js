// ============================================================
//  反射神経バトル + 連打バトル (Reflex & Tap Battle) [Render公開版]
//  Node.js 標準モジュールのみで動作（npm install 不要）
//
//  ゲームモード2種類：
//   ・reflex … 反射神経（緑になった瞬間タップ→反応時間が小さいほど上位）
//   ・tap    … 連打（制限時間内のタップ数が多いほど上位）
//
//  ・SSEで合図・ランキングをリアルタイム配信
//  ・PORT環境変数対応（Renderでそのまま動作）
//  ・認証不要 / 再入場対応 / リセット2種類
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

// ---------- ゲーム状態 ----------
// players: id -> { name, best(反応msの最小), tapBest(連打数の最大), reflexTries, tapTries }
const players = new Map();
const playerClients = new Map(); // id -> res
const hostClients = new Set();
// round.mode: 'reflex' | 'tap' 。durationはtap時の制限秒数
let round = { id: 0, active: false, mode: 'reflex', duration: 7, startedAt: 0 };

const uid = () => Math.random().toString(36).slice(2, 10);

function send(res, event, data) {
  try { res.write(`event: ${event}\n`); res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
}
function broadcastPlayers(event, data) { for (const res of playerClients.values()) send(res, event, data); }
function broadcastHosts(event, data) { for (const res of hostClients) send(res, event, data); }

// ランキング：現在のモードに応じて並べ替え
function leaderboard() {
  const mode = round.mode;
  if (mode === 'tap') {
    return [...players.values()]
      .filter(p => p.tapBest != null)
      .sort((a, b) => b.tapBest - a.tapBest) // 多いほど上位
      .map((p, i) => ({ rank: i + 1, name: p.name, score: p.tapBest, tries: p.tapTries }));
  }
  // reflex
  return [...players.values()]
    .filter(p => p.best != null)
    .sort((a, b) => a.best - b.best) // 小さいほど上位
    .map((p, i) => ({ rank: i + 1, name: p.name, score: p.best, tries: p.reflexTries }));
}
function stats() {
  const answered = round.mode === 'tap'
    ? [...players.values()].filter(p => p.tapBest != null).length
    : [...players.values()].filter(p => p.best != null).length;
  return { joined: players.size, answered, round: round.id, mode: round.mode, duration: round.duration, active: round.active };
}
function pushLeaderboard() { broadcastHosts('leaderboard', { board: leaderboard(), stats: stats() }); }

function findByName(name) {
  const key = (name || '').toString().trim().toLowerCase();
  if (!key) return null;
  for (const [id, pl] of players.entries()) {
    if ((pl.name || '').trim().toLowerCase() === key) return { id, pl };
  }
  return null;
}
function newPlayer(name) {
  return { name, best: null, tapBest: null, reflexTries: 0, tapTries: 0 };
}

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

  if (p === '/events/host') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write('\n');
    hostClients.add(res);
    send(res, 'leaderboard', { board: leaderboard(), stats: stats() });
    req.on('close', () => hostClients.delete(res));
    return;
  }

  if (req.method === 'POST' && p === '/api/join') {
    const { name } = await readBody(req);
    const nm = (name || '').toString().trim().slice(0, 20) || '名無し';
    const found = findByName(nm);
    if (found) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id: found.id, name: found.pl.name, round, merged: true }));
    }
    const id = uid();
    players.set(id, newPlayer(nm));
    pushLeaderboard();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ id, name: nm, round, merged: false }));
  }

  if (req.method === 'POST' && p === '/api/rejoin') {
    const { id, name } = await readBody(req);
    const nm = (name || '').toString().trim().slice(0, 20) || '名無し';
    if (id && players.has(id)) {
      const pl = players.get(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id, name: pl.name, round, restored: true }));
    }
    const found = findByName(nm);
    if (found) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id: found.id, name: found.pl.name, round, restored: true, merged: true }));
    }
    const newId = id || uid();
    players.set(newId, newPlayer(nm));
    pushLeaderboard();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ id: newId, name: nm, round, restored: false }));
  }

  // 結果送信：モード別
  if (req.method === 'POST' && p === '/api/result') {
    const { id, roundId, timeMs, taps, foul } = await readBody(req);
    const pl = players.get(id);
    if (pl && roundId === round.id) {
      if (round.mode === 'tap') {
        if (typeof taps === 'number' && taps >= 0 && taps < 100000) {
          if (pl.tapBest == null || taps > pl.tapBest) pl.tapBest = Math.round(taps);
          pl.tapTries++;
        }
      } else {
        if (foul) {
          // 反射神経のフライングは無効
        } else if (typeof timeMs === 'number' && timeMs > 0 && timeMs < 60000) {
          if (pl.best == null || timeMs < pl.best) pl.best = Math.round(timeMs);
          pl.reflexTries++;
        }
      }
      pushLeaderboard();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // ラウンド開始：mode('reflex'|'tap') と duration(秒) を受ける
  if (req.method === 'POST' && p === '/api/start') {
    const { mode, duration } = await readBody(req);
    const m = (mode === 'tap') ? 'tap' : 'reflex';
    const d = Math.min(30, Math.max(3, parseInt(duration, 10) || 7));
    round = { id: round.id + 1, active: true, mode: m, duration: d, startedAt: Date.now() };
    if (m === 'tap') {
      broadcastPlayers('tap-start', { roundId: round.id, duration: d });
    } else {
      broadcastPlayers('round-start', { roundId: round.id });
    }
    broadcastHosts('round-start', { roundId: round.id, mode: m, duration: d });
    pushLeaderboard();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, round }));
  }

  // 記録のみリセット（参加者は残す）
  if (req.method === 'POST' && p === '/api/reset') {
    for (const pl of players.values()) { pl.best = null; pl.tapBest = null; pl.reflexTries = 0; pl.tapTries = 0; }
    round = { id: 0, active: false, mode: round.mode, duration: round.duration, startedAt: 0 };
    broadcastPlayers('reset', {});
    pushLeaderboard();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // 全リセット（参加者も消す）
  if (req.method === 'POST' && p === '/api/reset-all') {
    players.clear();
    round = { id: 0, active: false, mode: round.mode, duration: round.duration, startedAt: 0 };
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
  console.log('  反射神経＆連打バトル サーバー起動！');
  console.log('---------------------------------------------------');
  console.log(`  ホスト画面: http://${lan}:${PORT}/host`);
  console.log(`  参加者用:   http://${lan}:${PORT}/`);
  console.log('===================================================');
});
