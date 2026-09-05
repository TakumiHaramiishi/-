// ============================================================
//  反射神経バトル + 連打バトル
//  Render公開版
//
//  ゲームモード
//   reflex : 反射神経ゲーム
//   tap    : 制限時間内の連打ゲーム
//
//  主な機能
//   ・iPhone / Android対応
//   ・SSEによるリアルタイム配信
//   ・ブラウザを閉じた場合の再入場
//   ・記録のみリセット
//   ・参加者を含む全リセット
//   ・全リセット後の古い端末セッションを無効化
//   ・連打記録を5秒、7秒、10秒ごとに別管理
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ============================================================
// ゲーム状態
// ============================================================

// 参加者
//
// id -> {
//   name: string,
//
//   // 反射神経
//   reflexBest: number | null,
//   reflexTries: number,
//
//   // 連打
//   // 例: { "5": 42, "7": 58, "10": 81 }
//   tapBestByDuration: object,
//
//   // 例: { "5": 2, "7": 1, "10": 3 }
//   tapTriesByDuration: object
// }
const players = new Map();

// プレイヤー側のSSE接続
// id -> response
const playerClients = new Map();

// ホスト側のSSE接続
const hostClients = new Set();

// 全リセットやサーバー再起動を判定する世代ID
//
// サーバー再起動時に新しくなるため、Renderがスリープ・再起動して
// サーバー上の参加者データが失われた場合にも、古い端末セッションを
// 無効と判定できます。
let sessionGeneration = createGenerationId();

// 現在のラウンド
let round = {
  id: 0,
  active: false,
  mode: 'reflex',
  duration: 7,
  startedAt: 0
};

// ホスト画面で現在閲覧しているランキング条件
// 実際に進行中のラウンドとは別管理する
let rankingView = {
  mode: 'reflex',
  duration: 7
};

// ============================================================
// 共通関数
// ============================================================

function createGenerationId() {
  return crypto.randomBytes(16).toString('hex');
}

function createPlayerId() {
  return crypto.randomBytes(12).toString('hex');
}

function normalizeName(name) {
  return (name || '')
    .toString()
    .trim()
    .slice(0, 20) || '名無し';
}

function normalizedNameKey(name) {
  return normalizeName(name).toLowerCase();
}

function createPlayer(name) {
  return {
    name: normalizeName(name),

    reflexBest: null,
    reflexTries: 0,

    tapBestByDuration: {},
    tapTriesByDuration: {}
  };
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(data));
}

function sendSse(res, eventName, data) {
  try {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (error) {
    // 切断済み接続への送信失敗は無視
  }
}

function broadcastToPlayers(eventName, data) {
  for (const res of playerClients.values()) {
    sendSse(res, eventName, data);
  }
}

function broadcastToHosts(eventName, data) {
  for (const res of hostClients) {
    sendSse(res, eventName, data);
  }
}

function findPlayerByName(name) {
  const key = normalizedNameKey(name);

  for (const [id, player] of players.entries()) {
    if (normalizedNameKey(player.name) === key) {
      return {
        id,
        player
      };
    }
  }

  return null;
}

function getTapBest(player, duration) {
  const key = String(duration);
  const value = player.tapBestByDuration[key];

  return typeof value === 'number' ? value : null;
}

function getTapTries(player, duration) {
  const key = String(duration);
  const value = player.tapTriesByDuration[key];

  return typeof value === 'number' ? value : 0;
}

// ============================================================
// ランキング
// ============================================================

function getLeaderboard() {
  let sortedResults = [];

  if (rankingView.mode === 'tap') {
    const duration = rankingView.duration;

    sortedResults = [...players.values()]
      .map(player => ({
        name: player.name,
        score: getTapBest(
          player,
          duration
        ),
        tries: getTapTries(
          player,
          duration
        )
      }))
      .filter(item => item.score !== null)
      .sort((a, b) => b.score - a.score);
  } else {
    sortedResults = [...players.values()]
      .filter(
        player =>
          player.reflexBest !== null
      )
      .map(player => ({
        name: player.name,
        score: player.reflexBest,
        tries: player.reflexTries
      }))
      .sort((a, b) => a.score - b.score);
  }

  let previousScore = null;
  let previousRank = 0;

  return sortedResults.map(
    (item, index) => {
      let rank;

      if (
        previousScore !== null &&
        item.score === previousScore
      ) {
        rank = previousRank;
      } else {
        rank = index + 1;
      }

      previousScore = item.score;
      previousRank = rank;

      return {
        rank,
        name: item.name,
        score: item.score,
        tries: item.tries
      };
    }
  );
}
function getStats() {
  let answered = 0;

  if (round.mode === 'tap') {
    answered = [...players.values()].filter(
      player => getTapBest(player, round.duration) !== null
    ).length;
  } else {
    answered = [...players.values()].filter(
      player => player.reflexBest !== null
    ).length;
  }

  return {
    joined: players.size,
    answered,
    round: round.id,
    mode: round.mode,
    duration: round.duration,
    active: round.active,
    sessionGeneration
  };
}function getStats() {
  let answered = 0;

  if (rankingView.mode === 'tap') {
    answered = [...players.values()]
      .filter(
        player =>
          getTapBest(
            player,
            rankingView.duration
          ) !== null
      )
      .length;
  } else {
    answered = [...players.values()]
      .filter(
        player =>
          player.reflexBest !== null
      )
      .length;
  }

  return {
    joined: players.size,
    answered,

    // ラウンド番号は実際に開始した回数
    round: round.id,
    active: round.active,

    // modeとdurationはホストが現在見ているランキング条件
    mode: rankingView.mode,
    duration: rankingView.duration,

    // 実際に進行中のゲーム情報
    activeMode: round.mode,
    activeDuration: round.duration,

    sessionGeneration
  };
}

function getHostPayload() {
  return {
    board: getLeaderboard(),
    stats: getStats()
  };
}

function pushLeaderboard() {
  broadcastToHosts('leaderboard', getHostPayload());
}

// ============================================================
// ファイル配信
// ============================================================

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  return types[extension] || 'application/octet-stream';
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (error, fileData) => {
    if (error) {
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8'
      });

      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': getContentType(filePath),
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    });

    res.end(fileData);
  });
}

function readJsonBody(req) {
  return new Promise(resolve => {
    let body = '';
    let finished = false;

    req.on('data', chunk => {
      if (finished) {
        return;
      }

      body += chunk;

      // 異常に大きなリクエストを防止
      if (body.length > 100000) {
        finished = true;
        resolve({});
        req.destroy();
      }
    });

    req.on('end', () => {
      if (finished) {
        return;
      }

      try {
        resolve(JSON.parse(body || '{}'));
      } catch (error) {
        resolve({});
      }
    });

    req.on('error', () => {
      if (!finished) {
        resolve({});
      }
    });
  });
}

// ============================================================
// セッション処理
// ============================================================

function buildJoinResponse(id, player, extra = {}) {
  return {
    id,
    name: player.name,
    round,
    sessionGeneration,
    ...extra
  };
}

function isOldSession(clientGeneration) {
  // generationがない旧player.htmlからのアクセスも
  // 安全側で「古いセッション」と判断します。
  return (
    !clientGeneration ||
    clientGeneration !== sessionGeneration
  );
}

// ============================================================
// 結果登録
// ============================================================

function saveReflexResult(player, timeMs) {
  if (
    typeof timeMs !== 'number' ||
    !Number.isFinite(timeMs) ||
    timeMs <= 0 ||
    timeMs >= 60000
  ) {
    return false;
  }

  const roundedTime = Math.round(timeMs);

  if (
    player.reflexBest === null ||
    roundedTime < player.reflexBest
  ) {
    player.reflexBest = roundedTime;
  }

  player.reflexTries += 1;
  return true;
}

function saveTapResult(player, taps, duration) {
  if (
    typeof taps !== 'number' ||
    !Number.isFinite(taps) ||
    taps < 0 ||
    taps >= 100000
  ) {
    return false;
  }

  const durationKey = String(duration);
  const roundedTaps = Math.round(taps);
  const currentBest = getTapBest(player, duration);
  const currentTries = getTapTries(player, duration);

  if (
    currentBest === null ||
    roundedTaps > currentBest
  ) {
    player.tapBestByDuration[durationKey] = roundedTaps;
  }

  player.tapTriesByDuration[durationKey] = currentTries + 1;
  return true;
}

// ============================================================
// HTTPサーバー
// ============================================================

const server = http.createServer(async (req, res) => {
  const baseUrl = `http://${req.headers.host || 'localhost'}`;
  const requestUrl = new URL(req.url, baseUrl);
  const pathname = requestUrl.pathname;

  // ----------------------------------------------------------
  // ヘルスチェック
  // ----------------------------------------------------------

  if (pathname === '/healthz') {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    });

    res.end('ok');
    return;
  }

  // ----------------------------------------------------------
  // 画面
  // ----------------------------------------------------------

  if (pathname === '/' || pathname === '/player') {
    serveFile(res, path.join(PUBLIC_DIR, 'player.html'));
    return;
  }

  if (pathname === '/host') {
    serveFile(res, path.join(PUBLIC_DIR, 'host.html'));
    return;
  }

  // ----------------------------------------------------------
  // プレイヤー用SSE
  // ----------------------------------------------------------

  if (pathname === '/events/player') {
    const id = requestUrl.searchParams.get('id');
    const clientGeneration =
      requestUrl.searchParams.get('generation');

    // 全リセット前やサーバー再起動前の古いセッション
    if (isOldSession(clientGeneration)) {
      sendJson(res, 409, {
        ok: false,
        staleSession: true,
        sessionGeneration
      });
      return;
    }

    if (!id || !players.has(id)) {
      sendJson(res, 404, {
        ok: false,
        playerMissing: true,
        sessionGeneration
      });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    res.write('\n');

    // 同じIDの古い接続が残っていれば置き換える
    const oldConnection = playerClients.get(id);

    if (oldConnection && oldConnection !== res) {
      try {
        oldConnection.end();
      } catch (error) {
        // 切断失敗は無視
      }
    }

    playerClients.set(id, res);

    sendSse(res, 'hello', {
      id,
      round,
      sessionGeneration
    });

    req.on('close', () => {
      if (playerClients.get(id) === res) {
        playerClients.delete(id);
      }
    });

    return;
  }

  // ----------------------------------------------------------
  // ホスト用SSE
  // ----------------------------------------------------------

  if (pathname === '/events/host') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    res.write('\n');

    hostClients.add(res);
    sendSse(res, 'leaderboard', getHostPayload());

    req.on('close', () => {
      hostClients.delete(res);
    });

    return;
  }

  // ----------------------------------------------------------
  // 新規参加
  // ----------------------------------------------------------

  if (
    req.method === 'POST' &&
    pathname === '/api/join'
  ) {
    const body = await readJsonBody(req);
    const name = normalizeName(body.name);

    // 同じ名前が既に存在する場合は、その人へ合流
    const existing = findPlayerByName(name);

    if (existing) {
      sendJson(
        res,
        200,
        buildJoinResponse(
          existing.id,
          existing.player,
          {
            merged: true,
            restored: true
          }
        )
      );
      return;
    }

    const id = createPlayerId();
    const player = createPlayer(name);

    players.set(id, player);
    pushLeaderboard();

    sendJson(
      res,
      200,
      buildJoinResponse(
        id,
        player,
        {
          merged: false,
          restored: false
        }
      )
    );

    return;
  }

  // ----------------------------------------------------------
  // 再入場
  // ----------------------------------------------------------

  if (
    req.method === 'POST' &&
    pathname === '/api/rejoin'
  ) {
    const body = await readJsonBody(req);

    const id = (body.id || '').toString();
    const name = normalizeName(body.name);
    const clientGeneration =
      (body.sessionGeneration || '').toString();

    // 全リセット前やサーバー再起動前のID
    //
    // ここでは新しい参加者を自動作成しません。
    // player.html側へ「名前入力画面に戻る」指示を返します。
    if (isOldSession(clientGeneration)) {
      sendJson(res, 409, {
        ok: false,
        staleSession: true,
        reason: 'generation_mismatch',
        sessionGeneration
      });
      return;
    }

    // IDが現在のサーバーに存在
    if (id && players.has(id)) {
      const player = players.get(id);

      sendJson(
        res,
        200,
        buildJoinResponse(
          id,
          player,
          {
            restored: true,
            merged: false
          }
        )
      );

      return;
    }

    // IDがなくても同名が現在のサーバーに存在すれば合流
    const existing = findPlayerByName(name);

    if (existing) {
      sendJson(
        res,
        200,
        buildJoinResponse(
          existing.id,
          existing.player,
          {
            restored: true,
            merged: true
          }
        )
      );

      return;
    }

    // 同じ世代なのにIDも名前も存在しない場合
    // 自動作成せず、名前入力から再参加させます。
    sendJson(res, 404, {
      ok: false,
      playerMissing: true,
      sessionGeneration
    });

    return;
  }

  // ----------------------------------------------------------
  // 結果登録
  // ----------------------------------------------------------

  if (
    req.method === 'POST' &&
    pathname === '/api/result'
  ) {
    const body = await readJsonBody(req);

    const id = (body.id || '').toString();
    const resultRoundId = Number(body.roundId);
    const clientGeneration =
      (body.sessionGeneration || '').toString();

    if (isOldSession(clientGeneration)) {
      sendJson(res, 409, {
        ok: false,
        staleSession: true,
        sessionGeneration
      });
      return;
    }

    const player = players.get(id);

    if (!player) {
      sendJson(res, 404, {
        ok: false,
        playerMissing: true,
        sessionGeneration
      });
      return;
    }

    if (resultRoundId !== round.id) {
      sendJson(res, 409, {
        ok: false,
        oldRound: true,
        currentRoundId: round.id,
        sessionGeneration
      });
      return;
    }

    let saved = false;

    if (round.mode === 'tap') {
      saved = saveTapResult(
        player,
        body.taps,
        round.duration
      );
    } else if (!body.foul) {
      saved = saveReflexResult(
        player,
        body.timeMs
      );
    }

    if (saved) {
      pushLeaderboard();
    }

    sendJson(res, 200, {
      ok: true,
      saved,
      mode: round.mode,
      duration: round.duration,
      sessionGeneration
    });

    return;
  }
// ----------------------------------------------------------
// ホスト画面のランキング表示切り替え
//
// ゲームは開始しない。
// 参加者側へ開始イベントも送らない。
// ラウンドIDも増やさない。
// ----------------------------------------------------------

if (
  req.method === 'POST' &&
  pathname === '/api/select-ranking'
) {
  const body =
    await readJsonBody(req);

  const selectedMode =
    body.mode === 'tap'
      ? 'tap'
      : 'reflex';

  let selectedDuration =
    Number.parseInt(
      body.duration,
      10
    );

  if (
    ![5, 7, 10].includes(
      selectedDuration
    )
  ) {
    selectedDuration = 7;
  }

  rankingView = {
    mode: selectedMode,
    duration: selectedDuration
  };

  // ホスト画面へ選択したランキングを即時配信
  pushLeaderboard();

  sendJson(
    res,
    200,
    {
      ok: true,
      rankingView,
      board: getLeaderboard(),
      stats: getStats()
    }
  );

  return;
}
  // ----------------------------------------------------------
  // ラウンド開始
  // ----------------------------------------------------------

  if (
    req.method === 'POST' &&
    pathname === '/api/start'
  ) {
    const body = await readJsonBody(req);

    const mode =
      body.mode === 'tap'
        ? 'tap'
        : 'reflex';

    let duration =
      Number.parseInt(body.duration, 10);

    // 使用可能な連打時間を5秒、7秒、10秒に限定
    if (![5, 7, 10].includes(duration)) {
      duration = 7;
    }

    round = {
      id: round.id + 1,
      active: true,
      mode,
      duration,
      startedAt: Date.now()
    };
    // 開始したゲームのランキングへ表示を合わせる
rankingView = {
  mode,
  duration
};
    if (mode === 'tap') {
      broadcastToPlayers('tap-start', {
        roundId: round.id,
        duration,
        sessionGeneration
      });
    } else {
      broadcastToPlayers('round-start', {
        roundId: round.id,
        sessionGeneration
      });
    }

    broadcastToHosts('round-start', {
      roundId: round.id,
      mode,
      duration,
      sessionGeneration
    });

    pushLeaderboard();

    sendJson(res, 200, {
      ok: true,
      round,
      sessionGeneration
    });

    return;
  }

  // ----------------------------------------------------------
  // 記録だけリセット
  // ----------------------------------------------------------

  if (
    req.method === 'POST' &&
    pathname === '/api/reset'
  ) {
    for (const player of players.values()) {
      player.reflexBest = null;
      player.reflexTries = 0;

      player.tapBestByDuration = {};
      player.tapTriesByDuration = {};
    }

    round = {
      id: 0,
      active: false,
      mode: round.mode,
      duration: round.duration,
      startedAt: 0
    };

    broadcastToPlayers('reset', {
      sessionGeneration
    });

    pushLeaderboard();

    sendJson(res, 200, {
      ok: true,
      sessionGeneration
    });

    return;
  }

  // ----------------------------------------------------------
  // 参加者を含む全リセット
  // ----------------------------------------------------------

  if (
    req.method === 'POST' &&
    pathname === '/api/reset-all'
  ) {
    // まず現在接続中の全端末に終了を通知
    broadcastToPlayers('kick', {
      reason: 'full_reset'
    });

    // サーバー側参加者をすべて削除
    players.clear();

    // 古いブラウザ保存IDを無効にするため世代IDを更新
    sessionGeneration = createGenerationId();

    round = {
      id: 0,
      active: false,
      mode: round.mode,
      duration: round.duration,
      startedAt: 0
    };

    // 古いSSE接続を明示的に切断
    for (const response of playerClients.values()) {
      try {
        response.end();
      } catch (error) {
        // 切断失敗は無視
      }
    }

    playerClients.clear();

    pushLeaderboard();

    broadcastToHosts('session-reset', {
      sessionGeneration
    });

    sendJson(res, 200, {
      ok: true,
      sessionGeneration
    });

    return;
  }

  // ----------------------------------------------------------
  // 404
  // ----------------------------------------------------------

  res.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8'
  });

  res.end('Not found');
});

// ============================================================
// サーバー起動
// ============================================================

server.listen(PORT, '0.0.0.0', () => {
  console.log('===================================================');
  console.log('  反射神経＆連打バトル サーバー起動');
  console.log('---------------------------------------------------');
  console.log(`  PORT: ${PORT}`);
  console.log(`  セッション世代: ${sessionGeneration}`);
  console.log('===================================================');
});
