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
      id,
      name: result.name,
      score: result.avg,
      tries: 1,
      raw: result
    }))
    .filter(row => row.raw.valid);

  return rank(rows, true);
}

function finishTempoRound() {
  if (active.type !== 'tempo') {
    return;
  }

  const completedRound = active;
  const board = tempoBoard(completedRound.results);

  if (completedRound.practice) {
    tempoPracticeDone = true;
  } else {
    tempoNext = Math.max(
      tempoNext,
      completedRound.index + 1
    );

    tempoHistory[completedRound.index] = {
      index: completedRound.index,
      label: completedRound.label,
      tempoMs: completedRound.tempoMs,
      board,
      completed: completedRound.results.size
    };
  }

  active = {
    type: 'revealed',
    mode: 'tempo'
  };

  lastReveal = {
    kind: 'tempo-round',
    label: completedRound.label,
    board,
    at: Date.now(),
    tempoMs: completedRound.tempoMs
  };

  for (const id of players.keys()) {
    emitOne(id, 'ranking-show', {
      kind: 'tempo-round',
      label: completedRound.label,
      unit: 'ms',

      ...personalRanking(
        board,
        id,
        completedRound.results.get(id)
      ),

      tempoMs: completedRound.tempoMs,
      durationMs: RESULT_MS
    });
  }

  push();

  setTimeout(() => {
    returnPlayersToStandby();

    if (
      !completedRound.practice &&
      completedRound.index === 2
    ) {
      setTimeout(
        showTempoOverall,
        Math.min(600, RESULT_MS + 20)
      );
    }
  }, RESULT_MS);
}

function showTempoOverall() {
  const board = tempoOverall();

  lastReveal = {
    kind: 'tempo-overall',
    label: 'テンポゲーム 総合結果',
    board,
    at: Date.now()
  };

  for (const id of players.keys()) {
    emitOne(id, 'ranking-show', {
      kind: 'tempo-overall',
      label: 'テンポゲーム 総合結果',
      unit: 'ms',

      ...personalRanking(
        board,
        id,
        null
      ),

      durationMs: RESULT_MS
    });
  }

  push();

  setTimeout(() => {
    emitAll('standby', {});
    push();
  }, RESULT_MS);
}

function maybeFinish() {
  if (!readyForAuto()) {
    return;
  }

  if (active.type === 'speed') {
    finishSpeedRound();
  } else if (active.type === 'tempo') {
    finishTempoRound();
  }
}

function evaluateUnique() {
  const counts = new Map();

  for (const number of active.answers.values()) {
    counts.set(
      number,
      (counts.get(number) || 0) + 1
    );
  }

  const uniqueNumbers = [...counts]
    .filter(([, count]) => count === 1)
    .map(([number]) => number)
    .sort((a, b) => b - a);

  const podium = uniqueNumbers
    .slice(0, 3)
    .map((number, index) => {
      let id = '';
      let name = '';

      for (
        const [
          playerId,
          answer
        ] of active.answers
      ) {
        if (answer === number) {
          id = playerId;
          name =
            players.get(playerId)?.name || '';
          break;
        }
      }

      return {
        place: index + 1,
        number,
        id,
        name
      };
    });

  const winningNumber =
    uniqueNumbers[0] ?? null;

  const winners = podium[0]
    ? [podium[0].name]
    : [];

  if (
    !active.practice &&
    podium[0]
  ) {
    const winner = players.get(
      podium[0].id
    );

    if (winner) {
      winner.uniquePoints += 1;
      winner.uniqueWins += 1;
    }
  }

  const result = {
    historyId: uid(),
    roundId: roundNo,
    roundNumber: uniqueHistory.length + 1,
    winningNumber,
    winners,
    podium,
    answerCount: active.answers.size,

    distribution: [...counts]
      .sort((a, b) => a[0] - b[0])
      .map(([number, count]) => ({
        number,
        count,
        unique: count === 1,
        winner:
          number === winningNumber
      })),

    practice: active.practice
  };

  if (!active.practice) {
    uniqueHistory.push(result);
  }

  return result;
}

function revealUnique() {
  if (active.type !== 'unique-closed') {
    return null;
  }

  const answers = active.answers;
  const result = evaluateUnique();

  active = {
    type: 'revealed',
    mode: 'unique'
  };

  lastReveal = {
    kind: 'unique',
    label:
      '最大ユニークナンバー 結果',
    result,
    at: Date.now()
  };

  for (const id of players.keys()) {
    const ownNumber = answers.get(id);

    const ownCount = ownNumber
      ? [...answers.values()].filter(
          number => number === ownNumber
        ).length
      : 0;

    const ownPlace =
      result.podium.find(
        entry => entry.id === id
      )?.place || null;

    emitOne(id, 'unique-result', {
      ...result,
      ownNumber: ownNumber || null,
      ownCount,
      ownPlace,
      durationMs: RESULT_MS
    });
  }

  push();

  setTimeout(
    returnPlayersToStandby,
    RESULT_MS
  );

  return result;
}

function resetScores() {
  for (const player of players.values()) {
    player.reflexBest = null;
    player.reflexTries = 0;
    player.tapBest = {};
    player.tapTries = {};
    player.uniquePoints = 0;
    player.uniqueWins = 0;
    player.tempoRounds = [
      null,
      null,
      null
    ];
  }

  uniqueHistory = [];
  tempoHistory = [];
  tempoPlan = [];
  tempoPracticeDone = false;
  tempoNext = 0;
  lastReveal = null;

  active = {
    type: 'idle'
  };
}

function serve(res, file) {
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type':
        'text/html; charset=utf-8',

      'Cache-Control': 'no-store'
    });

    res.end(data);
  });
}

const server = http.createServer(
  async (req, res) => {
    const url = new URL(
      req.url,
      `http://${req.headers.host || 'localhost'}`
    );

    const pathname = url.pathname;

    if (pathname === '/healthz') {
      return json(res, 200, {
        ok: true
      });
    }

    if (
      pathname === '/' ||
      pathname === '/player' ||
      pathname === '/player.html'
    ) {
      return serve(
        res,
        path.join(
          PUBLIC,
          'player.html'
        )
      );
    }

    if (
      pathname === '/host' ||
      pathname === '/host.html'
    ) {
      return serve(
        res,
        path.join(
          PUBLIC,
          'host.html'
        )
      );
    }

    if (pathname === '/events/player') {
      const id =
        url.searchParams.get('id');

      const sessionGeneration =
        url.searchParams.get(
          'generation'
        );

      if (
        sessionGeneration !== generation
      ) {
        return json(res, 409, {
          staleSession: true
        });
      }

      if (!players.has(id)) {
        return json(res, 404, {
          playerMissing: true
        });
      }

      res.writeHead(200, {
        'Content-Type':
          'text/event-stream',

        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });

      res.write('\n');

      const oldStream =
        playerStreams.get(id);

      if (
        oldStream &&
        oldStream !== res
      ) {
        try {
          oldStream.end();
        } catch {
          // 何もしない
        }
      }

      playerStreams.set(id, res);
      setState(id, 'standby', true);

      sse(res, 'hello', {
        generation
      });

      push();

      req.on('close', () => {
        if (
          playerStreams.get(id) === res
        ) {
          playerStreams.delete(id);
        }

        push();
      });

      return;
    }

    if (pathname === '/events/host') {
      res.writeHead(200, {
        'Content-Type':
          'text/event-stream',

        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });

      res.write('\n');

      hostStreams.add(res);

      sse(
        res,
        'leaderboard',
        payload()
      );

      req.on('close', () => {
        hostStreams.delete(res);
      });

      return;
    }

    if (
      req.method === 'POST' &&
      pathname === '/api/join'
    ) {
      const body = await read(req);

      const name = clean(body.name);
      const clientKey = String(
        body.clientKey || ''
      );

      const existing =
        byClientKey(clientKey) ||
        byName(name);

      if (existing) {
        const [
          id,
          player
        ] = existing;

        if (
          clientKey &&
          !player.clientKey
        ) {
          player.clientKey =
            clientKey;
        }

        setState(
          id,
          'standby',
          true
        );

        push();

        return json(res, 200, {
          id,
          name: player.name,
          sessionGeneration:
            generation,
          restored: true
        });
      }

      const id = uid();

      players.set(
        id,
        newPlayer(
          name,
          clientKey
        )
      );

      push();

      return json(res, 200, {
        id,
        name,
        sessionGeneration:
          generation,
        restored: false
      });
    }

    if (
      req.method === 'POST' &&
      pathname === '/api/rejoin'
    ) {
      const body = await read(req);

      const id = String(
        body.id || ''
      );

      if (
        body.sessionGeneration !==
        generation
      ) {
        return json(res, 409, {
          staleSession: true
        });
      }

      if (!players.has(id)) {
        return json(res, 404, {
          playerMissing: true
        });
      }

      setState(
        id,
        'standby',
        true
      );

      return json(res, 200, {
        id,
        name:
          players.get(id).name,

        sessionGeneration:
          generation
      });
    }

    if (
      req.method === 'POST' &&
      pathname === '/api/state'
    ) {
      const body = await read(req);

      if (!valid(body)) {
        return json(res, 409, {
          staleSession: true
        });
      }

      setState(
        String(body.id),
        body.state,
        body.visible
      );

      push();

      return json(res, 200, {
        ok: true
      });
    }

    if (
      req.method === 'POST' &&
      pathname ===
        '/api/select-ranking'
    ) {
      const body = await read(req);

      view.mode = [
        'reflex',
        'tap',
        'unique',
        'tempo'
      ].includes(body.mode)
        ? body.mode
        : 'reflex';

      view.duration = [
        5,
        7,
        10
      ].includes(Number(body.duration))
        ? Number(body.duration)
        : 7;

      push();

      return json(
        res,
        200,
        payload()
      );
    }

    if (
      req.method === 'POST' &&
      pathname === '/api/start'
    ) {
      if (active.type !== 'idle') {
        return json(res, 409, {
          busy: true
        });
      }

      const body = await read(req);

      const mode =
        body.mode === 'tap'
          ? 'tap'
          : 'reflex';

      const duration = [
        5,
        7,
        10
      ].includes(Number(body.duration))
        ? Number(body.duration)
        : 7;

      roundNo += 1;

      view = {
        mode,
        duration
      };

      active = {
        type: 'speed',
        mode,
        duration,
        practice:
          Boolean(body.practice),

        results: new Map(),

        label:
          (
            mode === 'tap'
              ? `連打${duration}秒`
              : '反射神経'
          ) +
          (
            body.practice
              ? '［練習］'
              : ''
          )
      };

      for (
        const player of players.values()
      ) {
        player.state = 'playing';
      }

      emitAll(
        mode === 'tap'
          ? 'tap-start'
          : 'reflex-start',
        {
          roundId: roundNo,
          duration,
          practice:
            active.practice,

          countdown: 3,
          generation
        }
      );

      push();

      return json(res, 200, {
        ok: true
      });
    }

    if (
      req.method === 'POST' &&
      pathname === '/api/result'
    ) {
      const body = await read(req);

      if (
        !valid(body) ||
        active.type !== 'speed'
      ) {
        return json(res, 409, {
          closed: true
        });
      }

      const id = String(body.id);
      const player =
        players.get(id);

      let result;

      if (active.mode === 'tap') {
        const taps = Math.max(
          0,
          Math.round(
            Number(body.taps) || 0
          )
        );

        result = {
          name: player.name,
          valid: true,
          score: taps
        };

        if (!active.practice) {
          const durationKey =
            String(active.duration);

          if (
            !Number.isFinite(
              player.tapBest[
                durationKey
              ]
            ) ||
            taps >
              player.tapBest[
                durationKey
              ]
          ) {
            player.tapBest[
              durationKey
            ] = taps;
          }

          player.tapTries[
            durationKey
          ] =
            (
              player.tapTries[
                durationKey
              ] || 0
            ) + 1;
        }
      } else if (body.foul) {
        result = {
          name: player.name,
          valid: false,
          reason: 'フライング'
        };
      } else {
        const timeMs = Math.round(
          Number(body.timeMs)
        );

        result =
          Number.isFinite(timeMs) &&
          timeMs > 0
            ? {
                name: player.name,
                valid: true,
                score: timeMs
              }
            : {
                name: player.name,
                valid: false,
                reason: '記録なし'
              };

        if (
          result.valid &&
          !active.practice
        ) {
          if (
            !Number.isFinite(
              player.reflexBest
            ) ||
            timeMs <
              player.reflexBest
          ) {
            player.reflexBest =
              timeMs;
          }

          player.reflexTries += 1;
        }
      }

      active.results.set(
        id,
        result
      );

      setState(
        id,
        'result',
        true
      );

      push();

      setTimeout(
        maybeFinish,
        120
      );

      return json(res, 200, {
        ok: true
      });
    }

    if (
      req.method === 'POST' &&
      pathname ===
        '/api/finish-active'
    ) {
      if (active.type === 'speed') {
        finishSpeedRound();
      } else if (
        active.type === 'tempo'
      ) {
        finishTempoRound();
      } else {
        return json(res, 409, {
          wrongState: true
        });
      }

      return json(res, 200, {
        ok: true
      });
    }

    if (
      req.method === 'POST' &&
      pathname === '/api/unique'
    ) {
      const body = await read(req);

      if (body.action === 'open') {
        if (active.type !== 'idle') {
          return json(res, 409, {
            busy: true
          });
        }

        roundNo += 1;

        view = {
          mode: 'unique',
          duration: 0
        };

        active = {
          type: 'unique-open',
          mode: 'unique',
          practice:
            Boolean(body.practice),

          answers: new Map()
        };

        emitAll('unique-open', {
          roundId: roundNo,
          practice:
            active.practice,

          generation
        });

        push();

        return json(res, 200, {
          ok: true
        });
      }

      if (
        body.action === 'close' &&
        active.type ===
          'unique-open'
      ) {
        active.type =
          'unique-closed';

        emitAll(
          'unique-closed',
          {}
        );

        push();

        return json(res, 200, {
          ok: true
        });
      }

      if (
        body.action === 'reveal' &&
        active.type ===
          'unique-closed'
      ) {
        const result =
          revealUnique();

        return json(res, 200, {
          ok: true,
          result
        });
      }

      return json(res, 409, {
        wrongState: true
      });
    }

    if (
      req.method === 'POST' &&
      pathname ===
        '/api/unique-answer'
    ) {
      const body = await read(req);

      if (
        !valid(body) ||
        active.type !==
          'unique-open'
      ) {
        return json(res, 409, {
          closed: true
        });
      }

      const number = parseInt(
        body.number,
        10
      );

      if (
        number < 1 ||
        number > 100
      ) {
        return json(res, 400, {
          invalidNumber: true
        });
      }

      active.answers.set(
        String(body.id),
        number
      );

      setState(
        String(body.id),
        'answering',
        true
      );

      push();

      return json(res, 200, {
        ok: true,
        number
      });
    }

    if (
      req.method === 'POST' &&
      pathname ===
        '/api/tempo/start'
    ) {
      const body = await read(req);

      const practiceMode =
        Boolean(body.practice);

      const index = practiceMode
        ? -1
        : Number(body.index);

      if (active.type !== 'idle') {
        return json(res, 409, {
          busy: true
        });
      }

      if (
        !practiceMode &&
        index !== tempoNext
      ) {
        return json(res, 409, {
          wrongRound: true
        });
      }

      if (!tempoPlan.length) {
        const choice = values =>
          values[
            Math.floor(
              Math.random() *
                values.length
            )
          ];

        tempoPlan = [
          choice([700, 800, 900]),

          choice([
            1000,
            1100,
            1200
          ]),

          choice([
            1300,
            1400,
            1500
          ])
        ].sort(
          () => Math.random() - 0.5
        );
      }

      const tempoMs = practiceMode
        ? [
            700,
            800,
            900,
            1000,
            1100,
            1200,
            1300,
            1400,
            1500
          ][
            Math.floor(
              Math.random() * 9
            )
          ]
        : tempoPlan[index];

      roundNo += 1;

      view = {
        mode: 'tempo',
        duration: 0
      };

      active = {
        type: 'tempo',
        mode: 'tempo',
        practice: practiceMode,
        index,
        tempoMs,
        results: new Map(),

        label: practiceMode
          ? 'テンポゲーム 練習'
          : `テンポゲーム 本番 第${index + 1}ラウンド`
      };

      for (
        const player of players.values()
      ) {
        player.state = 'playing';
      }

      emitAll('tempo-start', {
        roundId: roundNo,
        practice: practiceMode,
        index,
        tempoMs,
        label: active.label,
        generation
      });

      push();

      return json(res, 200, {
        ok: true
      });
    }

    if (
      req.method === 'POST' &&
      pathname ===
        '/api/tempo/result'
    ) {
      const body = await read(req);

      if (
        !valid(body) ||
        active.type !== 'tempo' ||
        Number(body.roundId) !==
          roundNo
      ) {
        return json(res, 409, {
          closed: true
        });
      }

      const id = String(body.id);
      const player =
        players.get(id);

      let result;

      if (
        !Array.isArray(
          body.intervals
        ) ||
        body.intervals.length !== 9
      ) {
        result = {
          name: player.name,
          valid: false,
          reason: 'タップ回数不足'
        };
      } else if (body.hidden) {
        result = {
          name: player.name,
          valid: false,
          reason: '画面非表示'
        };
      } else if (
        Number(body.transitionMs) <
          active.tempoMs * 0.5 ||
        Number(body.transitionMs) >
          active.tempoMs * 1.5
      ) {
        result = {
          name: player.name,
          valid: false,
          reason:
            '見本から継続できませんでした'
        };
      } else if (
        Number(body.elapsedMs) >
        active.tempoMs * 15
      ) {
        result = {
          name: player.name,
          valid: false,
          reason: '時間切れ'
        };
      } else {
        const intervals =
          body.intervals.map(Number);

        const invalidInterval =
          intervals.some(
            interval =>
              !Number.isFinite(
                interval
              ) ||
              interval < 200
          );

        if (invalidInterval) {
          result = {
            name: player.name,
            valid: false,
            reason:
              '時刻データ不正'
          };
        } else {
          const errors = intervals.map(
            interval =>
              Math.abs(
                interval -
                active.tempoMs
              )
          );

          result = {
            name: player.name,
            valid: true,

            avg:
              Math.round(
                (
                  errors.reduce(
                    (
                      sum,
                      errorValue
                    ) =>
                      sum +
                      errorValue,
                    0
                  ) / 9
                ) * 10
              ) / 10,

            max:
              Math.round(
                Math.max(
                  ...errors
                ) * 10
              ) / 10
          };
        }
      }

      active.results.set(
        id,
        result
      );

      if (
        !active.practice &&
        result.valid
      ) {
        player.tempoRounds[
          active.index
        ] = result;
      }

      setState(
        id,
        'result',
        true
      );

      push();

      setTimeout(
        maybeFinish,
        120
      );

      return json(res, 200, {
        ok: true,
        record: result
      });
    }

    if (
      req.method === 'POST' &&
      pathname === '/api/reset'
    ) {
      resetScores();
      emitAll('reset', {});
      push();

      return json(res, 200, {
        ok: true
      });
    }

    if (
      req.method === 'POST' &&
      pathname ===
        '/api/reset-all'
    ) {
      emitAll('kick', {});

      for (
        const stream of
          playerStreams.values()
      ) {
        try {
          stream.end();
        } catch {
          // 何もしない
        }
      }

      playerStreams.clear();
      players.clear();

      generation = uid();
      roundNo = 0;

      view = {
        mode: 'reflex',
        duration: 7
      };

      resetScores();
      push();

      return json(res, 200, {
        ok: true
      });
    }

    res.writeHead(404);
    res.end('Not found');
  }
);

setInterval(
  push,
  10000
).unref();

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `Halloween complete v5.1 on ${PORT}`
    );
  }
);
