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
const PUBLIC = path.join(
  __dirname,
  'public'
);

const players = new Map();
const playerStreams = new Map();
const hostStreams = new Set();

const removedPlayerIds =
  new Set();

const removedClientKeys =
  new Set();

const uid = () =>
  crypto
    .randomBytes(12)
    .toString('hex');

let generation = uid();
let roundNo = 0;

let view = {
  mode: 'reflex',
  duration: 5
};

let active = {
  type: 'idle'
};

let uniqueHistory = [];
let tempoHistory = [];
let tempoPlan = [];
let tempoNext = 0;
let lastReveal = null;

/* =========================================================
   名前の正規化
   ========================================================= */

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(
      /[\s\u3000]+/g,
      ' '
    )
    .trim();
}

function cleanName(value) {
  return (
    normalizeText(value)
      .slice(0, 40) ||
    '名無し'
  );
}

function nameKey(value) {
  return normalizeText(value)
    .replace(
      /[\s\u3000]+/g,
      ''
    )
    .toLocaleLowerCase(
      'ja-JP'
    );
}

/* =========================================================
   参加者データ
   ========================================================= */

function createPlayer(
  name,
  clientKey = ''
) {
  return {
    clientKey:
      String(clientKey || ''),

    name:
      cleanName(name),

    reflexBest: null,
    reflexTries: 0,

    tapBest: {},
    tapTries: {},

    uniquePoints: 0,
    uniqueWins: 0,

    tempoRounds: [
      null,
      null,
      null
    ],

    state: 'standby',
    visible: true,
    lastSeen: Date.now()
  };
}

/* =========================================================
   HTTP共通
   ========================================================= */

function sendJson(
  res,
  status,
  data
) {
  res.writeHead(
    status,
    {
      'Content-Type':
        'application/json; charset=utf-8',

      'Cache-Control':
        'no-store'
    }
  );

  res.end(
    JSON.stringify(data)
  );
}

function readJson(req) {
  return new Promise(
    resolve => {
      let text = '';

      req.on(
        'data',
        chunk => {
          text += chunk;

          if (
            text.length >
            1000000
          ) {
            req.destroy();
          }
        }
      );

      req.on(
        'end',
        () => {
          try {
            resolve(
              JSON.parse(
                text || '{}'
              )
            );
          } catch {
            resolve({});
          }
        }
      );

      req.on(
        'error',
        () => {
          resolve({});
        }
      );
    }
  );
}

/* =========================================================
   SSE共通
   ========================================================= */

function sendSse(
  res,
  event,
  data
) {
  try {
    res.write(
      `event: ${event}\n`
    );

    res.write(
      `data: ${JSON.stringify(data)}\n\n`
    );
  } catch {
    // 切断済みの場合は何もしない
  }
}

function emitAll(
  event,
  data
) {
  for (
    const stream of
      playerStreams.values()
  ) {
    sendSse(
      stream,
      event,
      data
    );
  }
}

function emitOne(
  playerId,
  event,
  data
) {
  const stream =
    playerStreams.get(
      playerId
    );

  if (stream) {
    sendSse(
      stream,
      event,
      data
    );
  }
}

function pushHostState() {
  const data =
    createPayload();

  for (
    const stream of
      hostStreams
  ) {
    sendSse(
      stream,
      'leaderboard',
      data
    );
  }
}

/* =========================================================
   参加者検索
   ========================================================= */

function findByName(name) {
  const key =
    nameKey(name);

  if (!key) {
    return null;
  }

  for (
    const [
      playerId,
      player
    ] of players
  ) {
    if (
      nameKey(player.name) ===
      key
    ) {
      return [
        playerId,
        player
      ];
    }
  }

  return null;
}

function findByClientKey(
  clientKey
) {
  const key =
    String(clientKey || '');

  if (!key) {
    return null;
  }

  for (
    const [
      playerId,
      player
    ] of players
  ) {
    if (
      player.clientKey ===
      key
    ) {
      return [
        playerId,
        player
      ];
    }
  }

  return null;
}

function validSession(body) {
  return Boolean(
    body &&
    body.sessionGeneration ===
      generation &&
    players.has(
      String(body.id || '')
    )
  );
}

function setPlayerState(
  playerId,
  state,
  visible = true
) {
  const player =
    players.get(playerId);

  if (!player) {
    return;
  }

  player.state =
    state || player.state;

  player.visible =
    visible !== false;

  player.lastSeen =
    Date.now();
}

/* =========================================================
   ランキング
   ========================================================= */

function addRanks(
  rows,
  ascending
) {
  let previousScore = null;
  let previousRank = 0;

  return rows
    .sort(
      (
        left,
        right
      ) => {
        if (
          left.score ===
          right.score
        ) {
          return String(
            left.name
          ).localeCompare(
            String(
              right.name
            ),
            'ja'
          );
        }

        return ascending
          ? left.score -
              right.score
          : right.score -
              left.score;
      }
    )
    .map(
      (
        row,
        index
      ) => {
        const currentRank =
          previousScore !==
            null &&
          row.score ===
            previousScore
            ? previousRank
            : index + 1;

        previousScore =
          row.score;

        previousRank =
          currentRank;

        return {
          ...row,
          rank: currentRank
        };
      }
    );
}

function createTempoOverall() {
  const rows = [];

  for (
    const [
      playerId,
      player
    ] of players
  ) {
    const completed =
      player.tempoRounds.every(
        result =>
          result &&
          result.valid
      );

    if (!completed) {
      continue;
    }

    const average =
      player.tempoRounds
        .reduce(
          (
            sum,
            result
          ) =>
            sum +
            result.avg,
          0
        ) / 3;

    rows.push({
      id: playerId,
      name: player.name,

      score:
        Math.round(
          average * 10
        ) / 10,

      rounds:
        player.tempoRounds.map(
          result =>
            result.avg
        ),

      tries: 3
    });
  }

  return addRanks(
    rows,
    true
  );
}

function createLeaderboard() {
  if (
    view.mode === 'tempo'
  ) {
    return createTempoOverall();
  }

  if (
    view.mode === 'unique'
  ) {
    return addRanks(
      [...players.values()]
        .map(
          player => ({
            name:
              player.name,

            score:
              player.uniquePoints,

            tries:
              player.uniqueWins
          })
        )
        .filter(
          row =>
            row.score > 0
        ),

      false
    );
  }

  if (
    view.mode === 'tap'
  ) {
    const key = '5';

    return addRanks(
      [...players.values()]
        .map(
          player => ({
            name:
              player.name,

            score:
              player.tapBest[
                key
              ],

            tries:
              player.tapTries[
                key
              ] || 0
          })
        )
        .filter(
          row =>
            Number.isFinite(
              row.score
            )
        ),

      false
    );
  }

  return addRanks(
    [...players.values()]
      .filter(
        player =>
          Number.isFinite(
            player.reflexBest
          )
      )
      .map(
        player => ({
          name:
            player.name,

          score:
            player.reflexBest,

          tries:
            player.reflexTries
        })
      ),

    true
  );
}

function createBooby(board) {
  if (
    [
      'unique',
      'tempo'
    ].includes(
      view.mode
    ) ||
    board.length < 2
  ) {
    return {
      prize: [],
      maker: []
    };
  }

  const scores = [
    ...new Set(
      board.map(
        row =>
          row.score
      )
    )
  ];

  if (
    scores.length < 2
  ) {
    return {
      prize: [],

      maker:
        board.map(
          row =>
            row.name
        )
    };
  }

  return {
    prize:
      board
        .filter(
          row =>
            row.score ===
            scores.at(-2)
        )
        .map(
          row =>
            row.name
        ),

    maker:
      board
        .filter(
          row =>
            row.score ===
            scores.at(-1)
        )
        .map(
          row =>
            row.name
        )
  };
}

/* =========================================================
   接続状態
   ========================================================= */

function isPlayerOnline(
  playerId,
  player,
  now = Date.now()
) {
  return (
    playerStreams.has(
      playerId
    ) &&
    now -
      player.lastSeen <
      30000
  );
}

function createPresence() {
  const now =
    Date.now();

  let connected = 0;
  let standby = 0;
  let playing = 0;

  const detail = [];

  for (
    const [
      playerId,
      player
    ] of players
  ) {
    const online =
      isPlayerOnline(
        playerId,
        player,
        now
      );

    if (online) {
      connected += 1;
    }

    if (
      online &&
      player.visible &&
      player.state ===
        'standby'
    ) {
      standby += 1;
      continue;
    }

    if (
      online &&
      player.state !==
        'standby'
    ) {
      playing += 1;
    }

    detail.push({
      id: playerId,
      name: player.name,

      state:
        !online
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

    notStandby:
      players.size -
      standby,

    detail
  };
}

/* =========================================================
   ホスト状態
   ========================================================= */

function completedCount() {
  if (
    active.type.startsWith(
      'unique'
    )
  ) {
    return (
      active.answers?.size ||
      0
    );
  }

  return (
    active.results?.size ||
    0
  );
}

function createStats() {
  return {
    joined:
      players.size,

    answered:
      completedCount(),

    round:
      roundNo,

    active:
      ![
        'idle',
        'revealed'
      ].includes(
        active.type
      ),

    activeMode:
      active.mode ||
      view.mode,

    mode:
      view.mode,

    duration:
      view.duration,

    practice:
      Boolean(
        active.practice
      ),

    roundCompleted:
      completedCount(),

    uniqueStatus:
      active.type.startsWith(
        'unique'
      )
        ? active.type.replace(
            'unique-',
            ''
          )
        : 'idle',

    generation,
    tempoNext,

    tempoLabel:
      active.mode ===
        'tempo'
        ? active.label
        : null,

    tempoMs:
      active.mode ===
        'tempo'
        ? active.tempoMs
        : null,

    ...createPresence()
  };
}

function createPayload() {
  const board =
    createLeaderboard();

  return {
    board,

    stats:
      createStats(),

    booby:
      createBooby(board),

    uniqueResult:
      lastReveal?.kind ===
        'unique'
        ? lastReveal.result
        : null,

    uniqueHistory,
    tempoHistory,
    lastReveal
  };
}

/* =========================================================
   結果発表
   ========================================================= */

function readyForAutomaticFinish() {
  return (
    players.size > 0 &&
    completedCount() >=
      players.size
  );
}

function createPersonalRanking(
  board,
  playerId,
  rawResult
) {
  const playerName =
    players.get(
      playerId
    )?.name;

  return {
    top3:
      board.slice(0, 3),

    self:
      board.find(
        row =>
          row.id ===
            playerId ||
          row.name ===
            playerName
      ),

    raw:
      rawResult,

    durationMs:
      RESULT_MS
  };
}

function returnToStandby() {
  for (
    const player of
      players.values()
  ) {
    player.state =
      'standby';
  }

  active = {
    type: 'idle'
  };

  emitAll(
    'standby',
    {}
  );

  pushHostState();
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

  for (
    const playerId of
      players.keys()
  ) {
    emitOne(
      playerId,
      'ranking-show',
      {
        kind,
        label,

        ...createPersonalRanking(
          board,
          playerId,
          rawMap?.get(
            playerId
          )
        ),

        ...extra
      }
    );
  }

  pushHostState();

  setTimeout(
    returnToStandby,
    RESULT_MS
  );
}

/* =========================================================
   反射神経・連打
   ========================================================= */

function finishSpeedRound() {
  if (
    active.type !==
    'speed'
  ) {
    return;
  }

  const completedRound =
    active;

  let board;

  if (
    completedRound.practice
  ) {
    const rows = [
      ...completedRound
        .results.entries()
    ]
      .map(
        (
          [
            playerId,
            result
          ]
        ) => ({
          id: playerId,
          ...result
        })
      )
      .filter(
        result =>
          result.valid
      )
      .map(
        result => ({
          id:
            result.id,

          name:
            result.name,

          score:
            result.score,

          tries: 1
        })
      );

    board = addRanks(
      rows,

      completedRound.mode ===
        'reflex'
    );
  } else {
    board =
      createLeaderboard();
  }

  active = {
    type: 'revealed',

    mode:
      completedRound.mode
  };

  showRanking(
    completedRound.mode,
    board,
    completedRound.results,
    completedRound.label,
    {
      unit:
        completedRound.mode ===
          'tap'
          ? '回'
          : 'ms',

      practice:
        completedRound.practice
    }
  );
}

/* =========================================================
   テンポゲーム
   ========================================================= */

function createTempoBoard(
  resultMap
) {
  return addRanks(
    [
      ...resultMap.entries()
    ]
      .map(
        (
          [
            playerId,
            result
          ]
        ) => ({
          id: playerId,
          name: result.name,
          score: result.avg,
          tries: 1,
          raw: result
        })
      )
      .filter(
        row =>
          row.raw.valid
      ),

    true
  );
}

function finishTempoRound() {
  if (
    active.type !==
    'tempo'
  ) {
    return;
  }

  const completedRound =
    active;

  const board =
    createTempoBoard(
      completedRound.results
    );

  if (
    !completedRound.practice
  ) {
    tempoNext = Math.max(
      tempoNext,

      completedRound.index +
        1
    );

    tempoHistory[
      completedRound.index
    ] = {
      index:
        completedRound.index,

      label:
        completedRound.label,

      tempoMs:
        completedRound.tempoMs,

      board,

      completed:
        completedRound
          .results.size
    };
  }

  active = {
    type: 'revealed',
    mode: 'tempo'
  };

  lastReveal = {
    kind: 'tempo-round',

    label:
      completedRound.label,

    board,

    tempoMs:
      completedRound.tempoMs,

    at: Date.now()
  };

  for (
    const playerId of
      players.keys()
  ) {
    emitOne(
      playerId,
      'ranking-show',
      {
        kind:
          'tempo-round',

        label:
          completedRound.label,

        unit: 'ms',

        ...createPersonalRanking(
          board,
          playerId,

          completedRound
            .results.get(
              playerId
            )
        ),

        tempoMs:
          completedRound.tempoMs,

        durationMs:
          RESULT_MS
      }
    );
  }

  pushHostState();

  setTimeout(
    () => {
      returnToStandby();

      if (
        !completedRound.practice &&
        completedRound.index ===
          2
      ) {
        setTimeout(
          showTempoOverall,

          Math.min(
            600,
            RESULT_MS + 20
          )
        );
      }
    },

    RESULT_MS
  );
}

function showTempoOverall() {
  const board =
    createTempoOverall();

  lastReveal = {
    kind:
      'tempo-overall',

    label:
      'テンポゲーム 総合結果',

    board,
    at: Date.now()
  };

  for (
    const playerId of
      players.keys()
  ) {
    emitOne(
      playerId,
      'ranking-show',
      {
        kind:
          'tempo-overall',

        label:
          'テンポゲーム 総合結果',

        unit: 'ms',

        ...createPersonalRanking(
          board,
          playerId,
          null
        ),

        durationMs:
          RESULT_MS
      }
    );
  }

  pushHostState();

  setTimeout(
    () => {
      emitAll(
        'standby',
        {}
      );

      pushHostState();
    },

    RESULT_MS
  );
}

function maybeFinish() {
  if (
    !readyForAutomaticFinish()
  ) {
    return;
  }

  if (
    active.type === 'speed'
  ) {
    finishSpeedRound();
  } else if (
    active.type === 'tempo'
  ) {
    finishTempoRound();
  }
}

/* =========================================================
   最大ユニーク
   ========================================================= */

function evaluateUnique() {
  const counts =
    new Map();

  for (
    const number of
      active.answers.values()
  ) {
    counts.set(
      number,

      (
        counts.get(number) ||
        0
      ) + 1
    );
  }

  const uniqueNumbers = [
    ...counts
  ]
    .filter(
      (
        [
          ,
          count
        ]
      ) =>
        count === 1
    )
    .map(
      ([number]) =>
        number
    )
    .sort(
      (
        left,
        right
      ) =>
        right - left
    );

  const podium =
    uniqueNumbers
      .slice(0, 3)
      .map(
        (
          number,
          index
        ) => {
          let playerId = '';
          let playerName = '';

          for (
            const [
              answerPlayerId,
              answerNumber
            ] of
              active.answers
          ) {
            if (
              answerNumber ===
              number
            ) {
              playerId =
                answerPlayerId;

              playerName =
                players.get(
                  answerPlayerId
                )?.name || '';

              break;
            }
          }

          return {
            place:
              index + 1,

            number,

            id:
              playerId,

            name:
              playerName
          };
        }
      );

  const winningNumber =
    uniqueNumbers[0] ??
    null;

  const winners =
    podium[0]
      ? [
          podium[0].name
        ]
      : [];

  if (
    !active.practice &&
    podium[0]
  ) {
    const winner =
      players.get(
        podium[0].id
      );

    if (winner) {
      winner.uniquePoints +=
        1;

      winner.uniqueWins +=
        1;
    }
  }

  const result = {
    historyId:
      uid(),

    roundId:
      roundNo,

    roundNumber:
      uniqueHistory.length +
      1,

    winningNumber,
    winners,
    podium,

    answerCount:
      active.answers.size,

    distribution: [
      ...counts
    ]
      .sort(
        (
          left,
          right
        ) =>
          left[0] -
          right[0]
      )
      .map(
        (
          [
            number,
            count
          ]
        ) => ({
          number,
          count,

          unique:
            count === 1,

          winner:
            number ===
            winningNumber
        })
      ),

    practice:
      active.practice
  };

  if (
    !active.practice
  ) {
    uniqueHistory.push(
      result
    );
  }

  return result;
}

function revealUnique() {
  if (
    active.type !==
    'unique-closed'
  ) {
    return null;
  }

  const answers =
    active.answers;

  const result =
    evaluateUnique();

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

  for (
    const playerId of
      players.keys()
  ) {
    const ownNumber =
      answers.get(
        playerId
      );

    const ownCount =
      ownNumber
        ? [
            ...answers.values()
          ].filter(
            number =>
              number ===
              ownNumber
          ).length
        : 0;

    const ownPlace =
      result.podium.find(
        entry =>
          entry.id ===
          playerId
      )?.place || null;

    emitOne(
      playerId,
      'unique-result',
      {
        ...result,

        ownNumber:
          ownNumber || null,

        ownCount,
        ownPlace,

        durationMs:
          RESULT_MS
      }
    );
  }

  pushHostState();

  setTimeout(
    returnToStandby,
    RESULT_MS
  );

  return result;
}

/* =========================================================
   参加者削除補助
   ========================================================= */

function removePlayerFromSavedTempo(
  playerId,
  playerName
) {
  tempoHistory =
    tempoHistory.map(
      history => {
        if (!history) {
          return history;
        }

        const board = (
          history.board || []
        ).filter(
          row =>
            row.id !==
              playerId &&
            row.name !==
              playerName
        );

        return {
          ...history,

          board:
            addRanks(
              board.map(
                row => ({
                  ...row,

                  rank:
                    undefined
                })
              ),

              true
            )
        };
      }
    );
}

/* =========================================================
   リセット
   ========================================================= */

function resetScores() {
  for (
    const player of
      players.values()
  ) {
    player.reflexBest =
      null;

    player.reflexTries =
      0;

    player.tapBest = {};
    player.tapTries = {};

    player.uniquePoints =
      0;

    player.uniqueWins =
      0;

    player.tempoRounds = [
      null,
      null,
      null
    ];

    player.state =
      'standby';
  }

  uniqueHistory = [];
  tempoHistory = [];
  tempoPlan = [];
  tempoNext = 0;
  lastReveal = null;

  active = {
    type: 'idle'
  };
}

/* =========================================================
   HTML配信
   ========================================================= */

function serveHtml(
  res,
  filename
) {
  fs.readFile(
    filename,

    (
      error,
      fileData
    ) => {
      if (error) {
        res.writeHead(404);
        res.end(
          'Not found'
        );
        return;
      }

      res.writeHead(
        200,
        {
          'Content-Type':
            'text/html; charset=utf-8',

          'Cache-Control':
            'no-store'
        }
      );

      res.end(
        fileData
      );
    }
  );
}

/* =========================================================
   HTTPサーバー
   ========================================================= */

const server =
  http.createServer(
    async (
      req,
      res
    ) => {
      try {
        const requestUrl =
          new URL(
            req.url,

            `http://${req.headers.host || 'localhost'}`
          );

        const pathname =
          requestUrl.pathname;

        /* -----------------------------
           Health Check
           ----------------------------- */

        if (
          pathname ===
          '/healthz'
        ) {
          return sendJson(
            res,
            200,
            {
              ok: true,
              version: '5.4'
            }
          );
        }

        /* -----------------------------
           HTML
           ----------------------------- */

        if (
          pathname === '/' ||
          pathname ===
            '/player' ||
          pathname ===
            '/player.html'
        ) {
          return serveHtml(
            res,

            path.join(
              PUBLIC,
              'player.html'
            )
          );
        }

        if (
          pathname ===
            '/host' ||
          pathname ===
            '/host.html'
        ) {
          return serveHtml(
            res,

            path.join(
              PUBLIC,
              'host.html'
            )
          );
        }

        /* -----------------------------
           プレイヤー用SSE
           ----------------------------- */

        if (
          pathname ===
          '/events/player'
        ) {
          const playerId =
            requestUrl
              .searchParams
              .get('id');

          const sessionGeneration =
            requestUrl
              .searchParams
              .get(
                'generation'
              );

          if (
            sessionGeneration !==
            generation
          ) {
            return sendJson(
              res,
              409,
              {
                staleSession:
                  true
              }
            );
          }

          if (
            !players.has(
              playerId
            )
          ) {
            return sendJson(
              res,
              404,
              {
                playerMissing:
                  true
              }
            );
          }

          res.writeHead(
            200,
            {
              'Content-Type':
                'text/event-stream',

              'Cache-Control':
                'no-store',

              Connection:
                'keep-alive',

              'X-Accel-Buffering':
                'no'
            }
          );

          res.write('\n');

          const previousStream =
            playerStreams.get(
              playerId
            );

          if (
            previousStream &&
            previousStream !==
              res
          ) {
            try {
              previousStream.end();
            } catch {
              // 何もしない
            }
          }

          playerStreams.set(
            playerId,
            res
          );

          setPlayerState(
            playerId,
            'standby',
            true
          );

          sendSse(
            res,
            'hello',
            {
              generation
            }
          );

          pushHostState();

          req.on(
            'close',
            () => {
              if (
                playerStreams.get(
                  playerId
                ) === res
              ) {
                playerStreams.delete(
                  playerId
                );
              }

              pushHostState();
            }
          );

          return;
        }

        /* -----------------------------
           ホスト用SSE
           ----------------------------- */

        if (
          pathname ===
          '/events/host'
        ) {
          res.writeHead(
            200,
            {
              'Content-Type':
                'text/event-stream',

              'Cache-Control':
                'no-store',

              Connection:
                'keep-alive',

              'X-Accel-Buffering':
                'no'
            }
          );

          res.write('\n');

          hostStreams.add(
            res
          );

          sendSse(
            res,
            'leaderboard',
            createPayload()
          );

          req.on(
            'close',
            () => {
              hostStreams.delete(
                res
              );
            }
          );

          return;
        }

        /* -----------------------------
           新規参加
           ----------------------------- */

        if (
          req.method ===
            'POST' &&
          pathname ===
            '/api/join'
        ) {
          const body =
            await readJson(req);

          const name =
            cleanName(
              body.name
            );

          const clientKey =
            String(
              body.clientKey ||
              ''
            );

          /*
           * 削除後に正しい本名で再参加した場合は、
           * 同じ端末キーの削除状態を解除します。
           */
          if (clientKey) {
            removedClientKeys.delete(
              clientKey
            );
          }

          const existing =
            findByClientKey(
              clientKey
            ) ||
            findByName(name);

          if (existing) {
            const [
              playerId,
              player
            ] = existing;

            if (clientKey) {
              player.clientKey =
                clientKey;
            }

            setPlayerState(
              playerId,
              'standby',
              true
            );

            pushHostState();

            return sendJson(
              res,
              200,
              {
                id:
                  playerId,

                name:
                  player.name,

                sessionGeneration:
                  generation,

                restored: true
              }
            );
          }

          const playerId =
            uid();

          players.set(
            playerId,

            createPlayer(
              name,
              clientKey
            )
          );

          pushHostState();

          return sendJson(
            res,
            200,
            {
              id:
                playerId,

              name,

              sessionGeneration:
                generation,

              restored: false
            }
          );
        }

        /* -----------------------------
           再入場
           ----------------------------- */

        if (
          req.method ===
            'POST' &&
          pathname ===
            '/api/rejoin'
        ) {
          const body =
            await readJson(req);

          const requestedId =
            String(
              body.id || ''
            );

          const requestedName =
            String(
              body.name || ''
            ).trim();

          const clientKey =
            String(
              body.clientKey ||
              ''
            );

          /*
           * ホストから削除された参加情報は、
           * 保存済みセッションから自動復活させません。
           */
          if (
            removedPlayerIds.has(
              requestedId
            ) ||
            (
              clientKey &&
              removedClientKeys.has(
                clientKey
              )
            )
          ) {
            return sendJson(
              res,
              404,
              {
                playerMissing:
                  true,

                removed: true,

                sessionGeneration:
                  generation
              }
            );
          }

          if (
            body.sessionGeneration ===
              generation &&
            players.has(
              requestedId
            )
          ) {
            const player =
              players.get(
                requestedId
              );

            if (clientKey) {
              player.clientKey =
                clientKey;
            }

            setPlayerState(
              requestedId,
              'standby',
              true
            );

            pushHostState();

            return sendJson(
              res,
              200,
              {
                id:
                  requestedId,

                name:
                  player.name,

                sessionGeneration:
                  generation,

                restored: true
              }
            );
          }

          const existing =
            findByClientKey(
              clientKey
            ) ||
            (
              requestedName
                ? findByName(
                    requestedName
                  )
                : null
            );

          if (existing) {
            const [
              playerId,
              player
            ] = existing;

            if (clientKey) {
              player.clientKey =
                clientKey;
            }

            setPlayerState(
              playerId,
              'standby',
              true
            );

            pushHostState();

            return sendJson(
              res,
              200,
              {
                id:
                  playerId,

                name:
                  player.name,

                sessionGeneration:
                  generation,

                restored: true
              }
            );
          }

          if (requestedName) {
            const playerId =
              uid();

            const name =
              cleanName(
                requestedName
              );

            players.set(
              playerId,

              createPlayer(
                name,
                clientKey
              )
            );

            setPlayerState(
              playerId,
              'standby',
              true
            );

            pushHostState();

            return sendJson(
              res,
              200,
              {
                id:
                  playerId,

                name,

                sessionGeneration:
                  generation,

                restored: true,
                recreated: true
              }
            );
          }

          return sendJson(
            res,
            404,
            {
              playerMissing:
                true,

              sessionGeneration:
                generation
            }
          );
        }

        /* -----------------------------
           参加登録削除
           ----------------------------- */

        if (
          req.method ===
            'POST' &&
          pathname ===
            '/api/remove-player'
        ) {
          const body =
            await readJson(req);

          const playerId =
            String(
              body.id || ''
            );

          if (
            !players.has(
              playerId
            )
          ) {
            return sendJson(
              res,
              404,
              {
                playerMissing:
                  true
              }
            );
          }

          const player =
            players.get(
              playerId
            );

          const online =
            isPlayerOnline(
              playerId,
              player
            );

          /*
           * 現在接続中の参加者は削除しません。
           */
          if (online) {
            return sendJson(
              res,
              409,
              {
                playerConnected:
                  true
              }
            );
          }

          /*
           * 古いSSE接続が残っている場合は終了します。
           */
          const staleStream =
            playerStreams.get(
              playerId
            );

          if (staleStream) {
            try {
              staleStream.end();
            } catch {
              // 何もしない
            }

            playerStreams.delete(
              playerId
            );
          }

          removedPlayerIds.add(
            playerId
          );

          if (
            player.clientKey
          ) {
            removedClientKeys.add(
              player.clientKey
            );
          }

          /*
           * 進行中の結果・回答からも削除します。
           */
          if (
            active.results
              instanceof Map
          ) {
            active.results.delete(
              playerId
            );
          }

          if (
            active.answers
              instanceof Map
          ) {
            active.answers.delete(
              playerId
            );
          }

          removePlayerFromSavedTempo(
            playerId,
            player.name
          );

          players.delete(
            playerId
          );

          pushHostState();

          /*
           * 削除によって残り全員が完了状態になった場合、
           * 自動結果確定を再判定します。
           */
          setTimeout(
            maybeFinish,
            0
          );

          return sendJson(
            res,
            200,
            {
              ok: true,

              removedId:
                playerId,

              removedName:
                player.name
            }
          );
        }

        /* -----------------------------
           状態通知
           ----------------------------- */

        if (
          req.method ===
            'POST' &&
          pathname ===
            '/api/state'
        ) {
          const body =
            await readJson(req);

          if (
            !validSession(body)
          ) {
            return sendJson(
              res,
              409,
              {
                staleSession:
                  true
              }
            );
          }

          setPlayerState(
            String(body.id),
            body.state,
            body.visible
          );

          pushHostState();

          return sendJson(
            res,
            200,
            {
              ok: true
            }
          );
        }

        /* -----------------------------
           ランキング選択
           ----------------------------- */

        if (
          req.method ===
            'POST' &&
          pathname ===
            '/api/select-ranking'
        ) {
          const body =
            await readJson(req);

          view.mode = [
            'reflex',
            'tap',
            'unique',
            'tempo'
          ].includes(
            body.mode
          )
            ? body.mode
            : 'reflex';

          view.duration = 5;

          pushHostState();

          return sendJson(
            res,
            200,
            createPayload()
          );
        }

        /* -----------------------------
           反射神経・連打開始
           ----------------------------- */

        if (
          req.method ===
            'POST' &&
          pathname ===
            '/api/start'
        ) {
          if (
            active.type !==
            'idle'
          ) {
            return sendJson(
              res,
              409,
              {
                busy: true
              }
            );
          }

          const body =
            await readJson(req);

          const mode =
            body.mode ===
              'tap'
              ? 'tap'
              : 'reflex';

          const duration = 5;

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
              Boolean(
                body.practice
              ),

            results:
              new Map(),

            label:
              (
                mode === 'tap'
                  ? '連打5秒'
                  : '反射神経'
              ) +
              (
                body.practice
                  ? '［練習］'
                  : ''
              )
          };

          for (
            const player of
              players.values()
          ) {
            player.state =
              'playing';
          }

          emitAll(
            mode === 'tap'
              ? 'tap-start'
              : 'reflex-start',

            {
              roundId:
                roundNo,

              duration,

              practice:
                active.practice,

              countdown: 3,
              generation
            }
          );

          pushHostState();

          return sendJson(
            res,
            200,
            {
              ok: true
            }
          );
        }

        /* -----------------------------
           反射神経・連打結果
           ----------------------------- */

        if (
          req.method ===
            'POST' &&
          pathname ===
            '/api/result'
        ) {
          const body =
            await readJson(req);

          if (
            !validSession(
              body
            ) ||
            active.type !==
              'speed'
          ) {
            return sendJson(
              res,
              409,
              {
                closed: true
              }
            );
          }

          const playerId =
            String(body.id);

          const player =
            players.get(
              playerId
            );

          let result;

          if (
            active.mode ===
            'tap'
          ) {
            const taps =
              Math.max(
                0,

                Math.round(
                  Number(
                    body.taps
                  ) || 0
                )
              );

            result = {
              name:
                player.name,

              valid: true,
              score: taps
            };

            if (
              !active.practice
            ) {
              const key = '5';

              if (
                !Number.isFinite(
                  player.tapBest[
                    key
                  ]
                ) ||
                taps >
                  player.tapBest[
                    key
                  ]
              ) {
                player.tapBest[
                  key
                ] = taps;
              }

              player.tapTries[
                key
              ] =
                (
                  player.tapTries[
                    key
                  ] || 0
                ) + 1;
            }
          } else if (
            body.foul
          ) {
            result = {
              name:
                player.name,

              valid: false,

              reason:
                'フライング'
            };
          } else {
            const timeMs =
              Math.round(
                Number(
                  body.timeMs
                )
              );

            result =
              Number.isFinite(
                timeMs
              ) &&
              timeMs > 0
                ? {
                    name:
                      player.name,

                    valid: true,

                    score:
                      timeMs
                  }
                : {
                    name:
                      player.name,

                    valid: false,

                    reason:
                      '記録なし'
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

              player.reflexTries +=
                1;
            }
          }

          active.results.set(
            playerId,
            result
          );

          setPlayerState(
            playerId,
            'result',
            true
          );

          pushHostState();

          setTimeout(
            maybeFinish,
            120
          );

          return sendJson(
            res,
            200,
            {
              ok: true
            }
          );
        }

        /* -----------------------------
           未完了者あり確定
           ----------------------------- */

        if (
          req.method ===
            'POST' &&
          pathname ===
            '/api/finish-active'
        ) {
          if (
            active.type ===
            'speed'
          ) {
            finishSpeedRound();
          } else if (
            active.type ===
            'tempo'
          ) {
            finishTempoRound();
          } else {
            return sendJson(
              res,
              409,
              {
                wrongState:
                  true
              }
            );
          }

          return sendJson(
            res,
            200,
            {
              ok: true
            }
          );
        }

        /* -----------------------------
           最大ユニーク操作
           ----------------------------- */

        if (
          req.method ===
            'POST' &&
          pathname ===
            '/api/unique'
        ) {
          const body =
            await readJson(req);

          if (
            body.action ===
            'open'
          ) {
            if (
              active.type !==
              'idle'
            ) {
              return sendJson(
                res,
                409,
                {
                  busy: true
                }
              );
            }

            roundNo += 1;

            view = {
              mode: 'unique',
              duration: 0
            };

            active = {
              type:
                'unique-open',

              mode: 'unique',

              practice:
                Boolean(
                  body.practice
                ),

              answers:
                new Map()
            };

            emitAll(
              'unique-open',

              {
                roundId:
                  roundNo,

                practice:
                  active.practice,

                generation
              }
            );

            pushHostState();

            return sendJson(
              res,
              200,
              {
                ok: true
              }
            );
          }

          if (
            body.action ===
              'close' &&
            active.type ===
              'unique-open'
          ) {
            active.type =
              'unique-closed';

            emitAll(
              'unique-closed',
              {}
            );

            pushHostState();

            return sendJson(
              res,
              200,
              {
                ok: true
              }
            );
          }

          if (
            body.action ===
              'reveal' &&
            active.type ===
              'unique-closed'
          ) {
            return sendJson(
              res,
              200,
              {
                ok: true,

                result:
                  revealUnique()
              }
            );
          }

          return sendJson(
            res,
            409,
            {
              wrongState: true
            }
          );
        }

        /* -----------------------------
           最大ユニーク回答
           ----------------------------- */

        if (
          req.method ===
            'POST' &&
          pathname ===
            '/api/unique-answer'
        ) {
          const body =
            await readJson(req);

          if (
            !validSession(
              body
            ) ||
            active.type !==
              'unique-open'
          ) {
            return sendJson(
              res,
              409,
              {
                closed: true
              }
            );
          }

          const number =
            parseInt(
              body.number,
              10
            );

          if (
            number < 1 ||
            number > 100
          ) {
            return sendJson(
              res,
              400,
              {
                invalidNumber:
                  true
              }
            );
          }

          active.answers.set(
            String(body.id),
            number
          );

          setPlayerState(
            String(body.id),
            'answering',
            true
          );

          pushHostState();

          return sendJson(
            res,
            200,
            {
              ok: true,
              number
            }
          );
        }

        /* -----------------------------
           テンポ開始
           ----------------------------- */

        if (
          req.method ===
            'POST' &&
          pathname ===
            '/api/tempo/start'
        ) {
          const body =
            await readJson(req);

          const practiceMode =
            Boolean(
              body.practice
            );

          const index =
            practiceMode
              ? -1
              : Number(
                  body.index
                );

          if (
            active.type !==
            'idle'
          ) {
            return sendJson(
              res,
              409,
              {
                busy: true
              }
            );
          }

          if (
            !practiceMode &&
            index !==
              tempoNext
          ) {
            return sendJson(
              res,
              409,
              {
                wrongRound:
                  true
              }
            );
          }

          if (!tempoPlan.length) {
            const pick =
              values =>
                values[
                  Math.floor(
                    Math.random() *
                    values.length
                  )
                ];

            tempoPlan = [
              pick([
                700,
                800,
                900
              ]),

              pick([
                1000,
                1100,
                1200
              ]),

              pick([
                1300,
                1400,
                1500
              ])
            ].sort(
              () =>
                Math.random() -
                0.5
            );
          }

          const tempoMs =
            practiceMode
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
                    Math.random() *
                    9
                  )
                ]
              : tempoPlan[
                  index
                ];

          roundNo += 1;

          view = {
            mode: 'tempo',
            duration: 0
          };

          active = {
            type: 'tempo',
            mode: 'tempo',

            practice:
              practiceMode,

            index,
            tempoMs,

            results:
              new Map(),

            label:
              practiceMode
                ? 'テンポゲーム 練習'
                : `テンポゲーム 本番 第${index + 1}ラウンド`
          };

          for (
            const player of
              players.values()
          ) {
            player.state =
              'playing';
          }

          emitAll(
            'tempo-start',

            {
              roundId:
                roundNo,

              practice:
                practiceMode,

              index,
              tempoMs,

              label:
                active.label,

              generation
            }
          );

          pushHostState();

          return sendJson(
            res,
            200,
            {
              ok: true
            }
          );
        }

        /* -----------------------------
           テンポ結果
           ----------------------------- */

        if (
          req.method ===
            'POST' &&
          pathname ===
            '/api/tempo/result'
        ) {
          const body =
            await readJson(req);

          if (
            !validSession(
              body
            ) ||
            active.type !==
              'tempo' ||
            Number(
              body.roundId
            ) !== roundNo
          ) {
            return sendJson(
              res,
              409,
              {
                closed: true
              }
            );
          }

          const playerId =
            String(body.id);

          const player =
            players.get(
              playerId
            );

          let result;

          if (
            !Array.isArray(
              body.intervals
            ) ||
            body.intervals.length !==
              9
          ) {
            result = {
              name:
                player.name,

              valid: false,

              reason:
                'タップ回数不足'
            };
          } else if (
            body.hidden
          ) {
            result = {
              name:
                player.name,

              valid: false,

              reason:
                '画面非表示'
            };
          } else if (
            Number(
              body.transitionMs
            ) <
              active.tempoMs *
                0.5 ||
            Number(
              body.transitionMs
            ) >
              active.tempoMs *
                1.5
          ) {
            result = {
              name:
                player.name,

              valid: false,

              reason:
                '見本から継続できませんでした'
            };
          } else if (
            Number(
              body.elapsedMs
            ) >
              active.tempoMs *
                15
          ) {
            result = {
              name:
                player.name,

              valid: false,

              reason:
                '時間切れ'
            };
          } else {
            const intervals =
              body.intervals.map(
                Number
              );

            const invalid =
              intervals.some(
                interval =>
                  !Number.isFinite(
                    interval
                  ) ||
                  interval < 200
              );

            if (invalid) {
              result = {
                name:
                  player.name,

                valid: false,

                reason:
                  '時刻データ不正'
              };
            } else {
              const errors =
                intervals.map(
                  interval =>
                    Math.abs(
                      interval -
                      active.tempoMs
                    )
                );

              result = {
                name:
                  player.name,

                valid: true,

                avg:
                  Math.round(
                    (
                      errors.reduce(
                        (
                          sum,
                          error
                        ) =>
                          sum +
                          error,
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
            playerId,
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

          setPlayerState(
            playerId,
            'result',
            true
          );

          pushHostState();

          setTimeout(
            maybeFinish,
            120
          );

          return sendJson(
            res,
            200,
            {
              ok: true,
              record: result
            }
          );
        }

        /* -----------------------------
           記録リセット
           ----------------------------- */

        if (
          req.method ===
            'POST' &&
          pathname ===
            '/api/reset'
        ) {
          resetScores();

          emitAll(
            'reset',
            {}
          );

          pushHostState();

          return sendJson(
            res,
            200,
            {
              ok: true
            }
          );
        }

        /* -----------------------------
           全リセット
           ----------------------------- */

        if (
          req.method ===
            'POST' &&
          pathname ===
            '/api/reset-all'
        ) {
          emitAll(
            'kick',
            {}
          );

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

          removedPlayerIds.clear();
          removedClientKeys.clear();

          generation =
            uid();

          roundNo = 0;

          view = {
            mode: 'reflex',
            duration: 5
          };

          resetScores();
          pushHostState();

          return sendJson(
            res,
            200,
            {
              ok: true
            }
          );
        }

        res.writeHead(404);
        res.end('Not found');
      } catch (error) {
        console.error(error);

        if (
          !res.headersSent
        ) {
          sendJson(
            res,
            500,
            {
              error:
                'internal_error'
            }
          );
        } else {
          try {
            res.end();
          } catch {
            // 何もしない
          }
        }
      }
    }
  );

/* =========================================================
   定期状態更新
   ========================================================= */

setInterval(
  pushHostState,
  10000
).unref();

/* =========================================================
   起動
   ========================================================= */

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `Halloween complete v5.4 on ${PORT}`
    );
  }
);
