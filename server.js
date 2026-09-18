'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const RESULT_MS = Math.max(
  20,
  Number(process.env.RESULT_MS || 5000)
);
const PUBLIC = path.join(__dirname, 'public');

const uid = () => crypto.randomBytes(12).toString('hex');

const players = new Map();
const playerStreams = new Map();
const hostStreams = new Set();

let generation = uid();
let roundNo = 0;

let view = {
  mode: 'reflex',
  duration: 7
};

let active = {
  type: 'idle'
};

let uniqueHistory = [];
let tempoHistory = [];
let tempoPlan = [];
let tempoPracticeDone = false;
let tempoNext = 0;
let lastReveal = null;

function newPlayer(name, clientKey = '') {
  return {
    clientKey: String(clientKey || ''),
    name,
    reflexBest: null,
    reflexTries: 0,
    tapBest: {},
    tapTries: {},
    uniquePoints: 0,
    uniqueWins: 0,
    tempoRounds: [null, null, null],
    state: 'standby',
    visible: true,
    lastSeen: Date.now()
  };
}

const clean = value =>
  String(value || '').trim().slice(0, 20) || '名無し';

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(data));
}

function read(req) {
  return new Promise(resolve => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve({});
      }
    });

    req.on('error', () => {
      resolve({});
    });
  });
}

function sse(res, event, data) {
  try {
    res.write(
      `event: ${event}\n` +
      `data: ${JSON.stringify(data)}\n\n`
    );
  } catch {
    // 接続切断時は何もしない
  }
}

function emitAll(event, data) {
  for (const res of playerStreams.values()) {
    sse(res, event, data);
  }
}

function emitOne(id, event, data) {
  const res = playerStreams.get(id);

  if (res) {
    sse(res, event, data);
  }
}

function emitHosts() {
  const data = payload();

  for (const res of hostStreams) {
    sse(res, 'leaderboard', data);
  }
}

function byName(name) {
  const key = clean(name).toLowerCase();

  for (const [id, player] of players) {
    if (player.name.toLowerCase() === key) {
      return [id, player];
    }
  }

  return null;
}

function byClientKey(clientKey) {
  const key = String(clientKey || '');

  if (!key) {
    return null;
  }

  for (const [id, player] of players) {
    if (player.clientKey === key) {
      return [id, player];
    }
  }

  return null;
}

function valid(body) {
  return (
    body &&
    body.sessionGeneration === generation &&
    players.has(String(body.id || ''))
  );
}

function setState(id, state, visible = true) {
  const player = players.get(id);

  if (!player) {
    return;
  }

  player.state = state || player.state;
  player.visible = visible !== false;
  player.lastSeen = Date.now();
}

function rank(rows, ascending) {
  let previousScore = null;
  let previousRank = 0;

  return rows
    .sort((a, b) =>
      ascending
        ? a.score - b.score
        : b.score - a.score
    )
    .map((row, index) => {
      const currentRank =
        previousScore !== null &&
        row.score === previousScore
          ? previousRank
          : index + 1;

      previousScore = row.score;
      previousRank = currentRank;

      return {
        ...row,
        rank: currentRank
      };
    });
}

function tempoOverall() {
  const rows = [];

  for (const [id, player] of players) {
    const completedAllRounds = player.tempoRounds.every(
      result => result && result.valid
    );

    if (!completedAllRounds) {
      continue;
    }

    const score =
      Math.round(
        (
          player.tempoRounds.reduce(
            (sum, result) => sum + result.avg,
            0
          ) / 3
        ) * 10
      ) / 10;

    rows.push({
      id,
      name: player.name,
      score,
      rounds: player.tempoRounds.map(result => result.avg),
      tries: 3
    });
  }

  return rank(rows, true);
}

function leaderboard() {
  if (view.mode === 'tempo') {
    return tempoOverall();
  }

  if (view.mode === 'unique') {
    const rows = [...players.values()]
      .map(player => ({
        name: player.name,
        score: player.uniquePoints,
        tries: player.uniqueWins
      }))
      .filter(row => row.score > 0);

    return rank(rows, false);
  }

  if (view.mode === 'tap') {
    const durationKey = String(view.duration);

    const rows = [...players.values()]
      .map(player => ({
        name: player.name,
        score: player.tapBest[durationKey],
        tries: player.tapTries[durationKey] || 0
      }))
      .filter(row => Number.isFinite(row.score));

    return rank(rows, false);
  }

  const rows = [...players.values()]
    .filter(player => Number.isFinite(player.reflexBest))
    .map(player => ({
      name: player.name,
      score: player.reflexBest,
      tries: player.reflexTries
    }));

  return rank(rows, true);
}

function booby(board) {
  if (
    ['unique', 'tempo'].includes(view.mode) ||
    board.length < 2
  ) {
    return {
      prize: [],
      maker: []
    };
  }

  const scores = [...new Set(board.map(row => row.score))];

  if (scores.length < 2) {
    return {
      prize: [],
      maker: board.map(row => row.name)
    };
  }

  return {
    prize: board
      .filter(row => row.score === scores.at(-2))
      .map(row => row.name),

    maker: board
      .filter(row => row.score === scores.at(-1))
      .map(row => row.name)
  };
}

function presence() {
  const currentTime = Date.now();

  let standby = 0;
  let connected = 0;
  let playing = 0;

  const detail = [];

  for (const [id, player] of players) {
    const online =
      playerStreams.has(id) &&
      currentTime - player.lastSeen < 30000;

    if (online) {
      connected += 1;
    }

    if (
      online &&
      player.visible &&
      player.state === 'standby'
    ) {
      standby += 1;
      continue;
    }

    if (online && player.state !== 'standby') {
      playing += 1;
    }

    detail.push({
      name: player.name,
      state: !online
        ? '切断・未確認'
        : !player.visible
          ? '画面非表示'
          : player.state
    });
  }

  return {
    connected,
    standby,
    playing,
    notStandby: players.size - standby,
    detail
  };
}

function completedCount() {
  if (active.type.startsWith('unique')) {
    return active.answers?.size || 0;
  }

  return active.results?.size || 0;
}

function stats() {
  return {
    joined: players.size,
    answered: completedCount(),
    round: roundNo,

    active: !['idle', 'revealed'].includes(active.type),

    activeMode: active.mode || view.mode,
    mode: view.mode,
    duration: view.duration,
    practice: Boolean(active.practice),
    roundCompleted: completedCount(),

    uniqueStatus: active.type.startsWith('unique')
      ? active.type.replace('unique-', '')
      : 'idle',

    generation,

    tempoPracticeDone,
    tempoNext,

    tempoLabel:
      active.mode === 'tempo'
        ? active.label
        : null,

    tempoMs:
      active.mode === 'tempo'
        ? active.tempoMs
        : null,

    ...presence()
  };
}

function payload() {
  const board = leaderboard();

  return {
    board,
    stats: stats(),
    booby: booby(board),

    uniqueResult:
      lastReveal?.kind === 'unique'
        ? lastReveal.result
        : null,

    uniqueHistory,
    tempoHistory,
    lastReveal
  };
}

function push() {
  emitHosts();
}

function readyForAuto() {
  return (
    players.size > 0 &&
    completedCount() >= players.size
  );
}

function personalRanking(board, id, raw) {
  const playerName = players.get(id)?.name;

  const self = board.find(
    row =>
      row.id === id ||
      row.name === playerName
  );

  return {
    top3: board.slice(0, 3),
    self,
    raw,
    durationMs: RESULT_MS
  };
}

function returnPlayersToStandby() {
  for (const player of players.values()) {
    player.state = 'standby';
  }

  emitAll('standby', {});

  active = {
    type: 'idle'
  };

  push();
}

function showRanking(
  kind,
  board,
  rawMap,
  label,
  extra = {}
) {
  lastReveal = {
    kind,
    label,
    board,
    at: Date.now(),
    ...extra
  };

  for (const id of players.keys()) {
    emitOne(id, 'ranking-show', {
      kind,
      label,
      ...personalRanking(
        board,
        id,
        rawMap?.get(id)
      ),
      ...extra
    });
  }

  push();

  setTimeout(
    returnPlayersToStandby,
    RESULT_MS
  );
}

function finishSpeedRound() {
  if (active.type !== 'speed') {
    return;
  }

  const completedRound = active;

  let board;

  if (completedRound.practice) {
    const practiceRows = [
      ...completedRound.results.entries()
    ]
      .map(([id, result]) => ({
        ...result,
        id
      }))
      .filter(result => result.valid)
      .map(result => ({
        id: result.id,
        name: result.name,
        score: result.score,
        tries: 1
      }));

    board = rank(
      practiceRows,
      completedRound.mode === 'reflex'
    );
  } else {
    board = leaderboard();
  }

  active = {
    type: 'revealed',
    mode: completedRound.mode
  };

  showRanking(
    completedRound.mode,
    board,
    completedRound.results,
    completedRound.label,
    {
      unit:
        completedRound.mode === 'tap'
          ? '回'
          : 'ms',

      practice: completedRound.practice
    }
  );
}

function tempoBoard(resultMap) {
  const rows = [
    ...resultMap.entries()
  ]
    .map(([id, result]) => ({
   
