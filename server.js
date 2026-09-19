'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT =<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">

  <meta
    name="viewport"
    content="width=device-width,initial-scale=1"
  >

  <title>
    技能人財養成部 ハロウィンパーティー｜司会画面
  </title>

  <style>
    * {
      box-sizing: border-box;
    }

    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;

      font-family:
        -apple-system,
        BlinkMacSystemFont,
        "Hiragino Kaku Gothic ProN",
        "Noto Sans JP",
        sans-serif;

      background: #120b1e;
      color: #ffffff;
    }

    button {
      font: inherit;
    }

    .hidden {
      display: none !important;
    }

    /* =====================================================
       全体レイアウト

       左操作盤と右ランキングは、
       それぞれ独立して縦スクロールします。
       ===================================================== */

    .wrap {
      display: grid;
      grid-template-columns:
        390px
        minmax(0, 1fr);

      width: 100%;
      height: 100vh;
      overflow: hidden;
    }

    .side {
      height: 100vh;
      padding: 10px 12px;

      overflow-x: hidden;
      overflow-y: auto;

      border-right:
        2px solid #f28a24;

      background:
        linear-gradient(
          180deg,
          #321747,
          #1b1029
        );

      scrollbar-color:
        #80599a
        #21132f;
    }

    .main {
      min-width: 0;
      height: 100vh;
      padding: 16px 20px;

      overflow-x: hidden;
      overflow-y: auto;

      background:
        radial-gradient(
          circle at 80% 0,
          #301840,
          #120b1e 55%
        );

      scrollbar-color:
        #80599a
        #21132f;
    }

    h1,
    h2 {
      margin: 0.2em 0;
    }

    /* =====================================================
       操作盤上部タイトル
       ===================================================== */

    .departmentTitle {
      margin: 0;

      color: #ffffff;

      font-size: 1rem;
      font-weight: 900;
      line-height: 1.2;
      text-align: center;
    }

    .partyTitle {
      margin: 3px 0 8px;

      color: #ff9c2e;

      font-size: 1.28rem;
      font-weight: 950;
      line-height: 1.2;
      text-align: center;
      white-space: nowrap;
    }

    /* =====================================================
       QRコード
       ===================================================== */

    .qr {
      display: flex;
      align-items: center;
      justify-content: center;

      min-height: 218px;
      padding: 6px;

      border-radius: 14px;

      background: #ffffff;
      color: #12303f;
    }

    .qr img {
      width: 206px;
      height: 206px;

      /*
       * QRコードの輪郭を崩さないため、
       * 補間を行わず表示します。
       */
      image-rendering: pixelated;
    }

    /* =====================================================
       参加状況
       ===================================================== */

    .stats {
      display: grid;
      grid-template-columns:
        repeat(
          4,
          minmax(0, 1fr)
        );
      gap: 5px;

      margin-top: 7px;
    }

    .card {
      padding: 6px 2px;

      border-radius: 8px;

      background: #42245a;

      font-size: 0.73rem;
      text-align: center;
    }

    .card b {
      display: block;

      color: #ffb257;

      font-size: 1.36rem;
      font-weight: 950;
      line-height: 1.05;
      font-variant-numeric:
        tabular-nums;
    }

    /* =====================================================
       動作状態
       ===================================================== */

    .status {
      margin-top: 7px;
      padding: 9px 10px;

      border-radius: 9px;

      background: #3c2550;

      font-size: 0.88rem;
      font-weight: 750;
      line-height: 1.4;
    }

    .status.ok {
      background: #17633a;
    }

    .status.warn {
      background: #8b6914;
    }

    .status.playing {
      background: #075b87;
    }

    .detail {
      margin-top: 4px;

      color: #ffd2d2;

      font-size: 0.78rem;
      line-height: 1.4;
    }

    /* =====================================================
       操作グループ
       ===================================================== */

    .group {
      margin-top: 7px;
      padding: 8px;

      border-radius: 10px;

      background: #321c45;
    }

    .groupTitle {
      margin-bottom: 6px;

      color: #ffffff;

      font-size: 0.9rem;
      font-weight: 900;
    }

    /*
     * ゲーム選択とモード選択を、
     * 同じ質感のボタンへ統一します。
     */

    .gameButtons,
    .modeButtons {
      display: grid;
      gap: 5px;
    }

    .gameButtons {
      grid-template-columns:
        repeat(
          4,
          minmax(0, 1fr)
        );
    }

    .modeButtons {
      grid-template-columns:
        repeat(
          2,
          minmax(0, 1fr)
        );
    }

    .gameButtons button,
    .modeButtons button {
      min-width: 0;
      padding: 10px 4px;

      border:
        2px solid #6e4d84;
      border-radius: 9px;

      background: #43235c;
      color: #ffffff;

      font-size: 0.88rem;
      font-weight: 900;

      cursor: pointer;
    }

    .gameButtons button:hover,
    .modeButtons button:hover {
      border-color: #b891cf;

      background: #55306d;
    }

    .gameButtons button.on,
    .modeButtons button.on {
      border-color: #ffb257;

      background: #ef7f1a;
      color: #ffffff;

      box-shadow:
        0 0 0 1px #ffb25755;
    }

    /* =====================================================
       メイン操作ボタン
       ===================================================== */

    .action {
      width: 100%;
      margin-top: 7px;
      padding: 12px 8px;

      border: 0;
      border-radius: 10px;

      color: #ffffff;

      font-size: 0.96rem;
      font-weight: 900;

      cursor: pointer;
    }

    .action:disabled {
      opacity: 0.45;
      cursor: default;
    }

    .start {
      background: #27ae60;
    }

    .orange {
      background: #d07816;
    }

    .purple {
      background: #843bad;
    }

    .reset {
      background: #526d88;
    }

    .danger {
      background: #9f3d3d;
    }

    .resetRow {
      display: grid;
      grid-template-columns:
        1fr 1fr;
      gap: 6px;
    }

    .resetRow .action {
      width: 100%;

      font-size: 0.82rem;
    }

    /* =====================================================
       ランキング見出し
       ===================================================== */

    .mainHeader {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;

      min-height: 48px;
      margin-bottom: 7px;
    }

    .mainHeader h2 {
      margin: 0;

      color: #ffffff;

      font-size: clamp(
        1.55rem,
        2vw,
        2rem
      );
      line-height: 1.2;
    }

    /*
     * テンポのラウンド切替をタイトル右横へ配置します。
     */

    .tempoTopTabs {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;

      margin-left: auto;
    }

    .tempoTopTabs button {
      padding: 8px 12px;

      border:
        1px solid #8359a0;
      border-radius: 9px;

      background: #442558;
      color: #ffffff;

      font-size: 0.96rem;
      font-weight: 900;

      cursor: pointer;
    }

    .tempoTopTabs button:hover {
      border-color: #ffb257;
    }

    .tempoTopTabs button.on {
      border-color: #ffb257;

      background: #ef7f1a;
    }

    .tempoInfo {
      margin: 0 0 8px;
      padding: 9px 11px;

      border-radius: 9px;

      background: #402655;

      font-size: 1rem;
      line-height: 1.4;
    }

    /* =====================================================
       ランキングページ切替
       ===================================================== */

    .pager {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;

      margin: 6px 0 9px;
    }

    .pager button {
      padding: 7px 11px;

      border:
        1px solid #80599a;
      border-radius: 8px;

      background: #442558;
      color: #ffffff;

      font-size: 0.95rem;
      font-weight: 800;

      cursor: pointer;
    }

    .pager button.on {
      border-color: #ffb257;

      background: #ef7f1a;
    }

    .pager span {
      margin-left: auto;

      color: #c7b8d2;

      font-size: 0.95rem;
    }

    /* =====================================================
       通常ランキング

       1ページ30名です。
       1列10名で、1・11・21形式に並べます。
       ===================================================== */

    .board {
      display: grid;
      grid-template-columns:
        repeat(
          3,
          minmax(0, 1fr)
        );
      gap: 8px;
    }

    .rank {
      display: grid;
      grid-template-columns:
        56px
        minmax(0, 1fr)
        auto
        auto;
      align-items: center;
      gap: 10px;

      min-height: 72px;
      padding: 10px 12px;

      border:
        1px solid #452b59;
      border-radius: 10px;

      background: #2a183b;
    }

    .rank:nth-child(even) {
      background: #321d45;
    }

    .rank b {
      font-size: clamp(
        1.55rem,
        2vw,
        1.9rem
      );
      font-weight: 950;
      text-align: center;
    }

    .rankName {
      min-width: 0;

      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;

      font-size: clamp(
        1.42rem,
        1.75vw,
        1.72rem
      );
      font-weight: 900;
    }

    .score {
      white-space: nowrap;

      color: #ffd08a;

      font-size: clamp(
        1.38rem,
        1.65vw,
        1.68rem
      );
      font-weight: 950;
      font-variant-numeric:
        tabular-nums;
    }

    .tries {
      white-space: nowrap;

      color: #c7b8d2;

      font-size: clamp(
        0.98rem,
        1.13vw,
        1.15rem
      );
    }

    .top1 {
      border-color: #ffe86f;

      background: #f1c40f !important;
      color: #20142b;
    }

    .top2 {
      border-color: #e8ecef;

      background: #bdc3c7 !important;
      color: #20142b;
    }

    .top3 {
      border-color: #e6a66b;

      background: #cd7f32 !important;
      color: #20142b;
    }

    .top1 .score,
    .top2 .score,
    .top3 .score,
    .top1 .tries,
    .top2 .tries,
    .top3 .tries {
      color: #20142b;
    }

    .rankPlaceholder {
      min-height: 72px;

      visibility: hidden;

      pointer-events: none;
    }

    .panel,
    .award {
      padding: 14px;

      border-radius: 12px;

      background: #2f1b41;
    }

    /* =====================================================
       ブービー表示
       ===================================================== */

    .awards {
      display: grid;
      grid-template-columns:
        1fr 1fr;
      gap: 10px;

      margin-top: 12px;
    }

    .award {
      font-size: 1.12rem;
      line-height: 1.5;
    }

    .award b {
      font-size: 1.22rem;
    }

    /* =====================================================
       最大ユニーク上位3名

       1位・2位・3位は、
       通常ランキングと同じ金・銀・銅にします。
       ===================================================== */

    .podium {
      display: grid;
      grid-template-columns:
        repeat(
          3,
          minmax(0, 1fr)
        );
      gap: 12px;

      margin: 10px 0;
    }

    .podiumCard {
      min-height: 140px;
      padding: 18px;

      border:
        2px solid transparent;
      border-radius: 13px;

      background: #2f1b41;

      font-size: 1.4rem;
      font-weight: 900;
      line-height: 1.45;
      text-align: center;
    }

    .podiumCard.place1 {
      border-color: #ffe86f;

      background: #f1c40f;
      color: #20142b;
    }

    .podiumCard.place2 {
      border-color: #e8ecef;

      background: #bdc3c7;
      color: #20142b;
    }

    .podiumCard.place3 {
      border-color: #e6a66b;

      background: #cd7f32;
      color: #20142b;
    }

    .podiumPlace {
      font-size: 1.65rem;
      font-weight: 950;
    }

    .podiumName {
      margin-top: 7px;

      font-size: 1.55rem;
      font-weight: 950;
    }

    .podiumNumber {
      margin-top: 5px;

      font-size: 1.35rem;
      font-weight: 900;
    }

    /* =====================================================
       最大ユニーク履歴
       ===================================================== */

    .history {
      margin-top: 12px;
      padding: 14px;

      border:
        1px solid #744c90;
      border-radius: 12px;

      background: #21132f;
    }

    .history h2 {
      font-size: 1.45rem;
    }

    .historyTabs {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;

      margin: 9px 0;
    }

    .historyTabs button {
      padding: 8px 12px;

      border:
        1px solid #8359a0;
      border-radius: 9px;

      background: #442558;
      color: #ffffff;

      font-size: 1rem;
      font-weight: 900;

      cursor: pointer;
    }

    .historyTabs button.on {
      border-color: #ffb257;

      background: #ef7f1a;
    }

    .historySummary {
      margin-bottom: 8px;
      padding: 11px;

      border-radius: 10px;

      background: #402655;

      font-size: 1.08rem;
      font-weight: 750;
      line-height: 1.5;
    }

    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;

      margin: 8px 0;

      font-size: 0.95rem;
    }

    .legend i {
      display: inline-block;

      width: 13px;
      height: 13px;
      margin-right: 5px;

      border-radius: 2px;
    }

    .chartScroll {
      overflow-x: auto;
      padding-bottom: 8px;
    }

    .chart {
      display: flex;
      align-items: flex-end;
      gap: 4px;

      min-width: 1200px;
      height: 330px;
      padding:
        34px
        14px
        28px;

      border-left:
        1px solid #86699a;
      border-bottom:
        1px solid #86699a;

      background: #170d22;
    }

    .barColumn {
      position: relative;

      display: flex;
      align-items: flex-end;

      width: 9px;
      height: 100%;
    }

    .chartBar {
      position: relative;

      width: 100%;

      border-radius:
        3px 3px 0 0;

      background: #80549c;
    }

    .chartBar.unique {
      background: #2fbc72;
    }

    .chartBar.winner {
      background: #ffd447;

      box-shadow:
        0 0 12px #ffd447;
    }

    .barNumber {
      position: absolute;
      bottom: -21px;
      left: 50%;

      color: #d5c4df;

      font-size: 9px;

      transform:
        translateX(-50%);
    }

    .barCount {
      position: absolute;
      top: -20px;
      left: 50%;

      color: #ffffff;

      font-size: 10px;
      font-weight: 900;

      transform:
        translateX(-50%);
    }

    /* =====================================================
       レスポンシブ
       ===================================================== */

    @media (
      max-width: 1250px
    ) {
      .wrap {
        grid-template-columns:
          365px
          minmax(0, 1fr);
      }

      .rank {
        grid-template-columns:
          48px
          minmax(0, 1fr)
          auto;
        gap: 7px;
      }

      .tries {
        display: none;
      }
    }

    @media (
      max-width: 850px
    ) {
      html,
      body {
        overflow: auto;
      }

      .wrap {
        display: block;
        height: auto;
        overflow: visible;
      }

      .side,
      .main {
        width: 100%;
        height: auto;
        overflow: visible;
      }

      .side {
        border-right: 0;
        border-bottom:
          2px solid #f28a24;
      }

      .board {
        grid-template-columns:
          1fr;
      }

      .rankPlaceholder {
        display: none;
      }

      .podium {
        grid-template-columns:
          1fr;
      }

      .mainHeader {
        display: block;
      }

      .tempoTopTabs {
        margin-top: 9px;
        margin-left: 0;
      }
    }
  </style>
</head>

<body>
  <div class="wrap">
    <aside class="side">
      <div class="departmentTitle">
        技能人財養成部
      </div>

      <h1 class="partyTitle">
        🎃 ハロウィンパーティー 👻
      </h1>

      <div
        id="qr"
        class="qr"
      >
        QR生成中…
      </div>

      <div class="stats">
        <div class="card">
          <b id="joined">0</b>
          参加
        </div>

        <div class="card">
          <b id="standby">0</b>
          待機
        </div>

        <div class="card">
          <b id="answered">0</b>
          完了
        </div>

        <div class="card">
          <b id="missing">0</b>
          要確認
        </div>
      </div>

      <div
        id="status"
        class="status"
      >
        状態確認中
      </div>

      <div
        id="detail"
        class="detail"
      ></div>

      <div class="group">
        <div class="groupTitle">
          🎮 ゲーム選択
        </div>

        <div class="gameButtons">
          <button
            type="button"
            id="reflex"
            class="on"
          >
            反射
          </button>

          <button
            type="button"
            id="tap"
          >
            連打
          </button>

          <button
            type="button"
            id="unique"
          >
            ユニーク
          </button>

          <button
            type="button"
            id="tempo"
          >
            テンポ
          </button>
        </div>
      </div>

      <div
        id="modeGroup"
        class="group"
      >
        <div class="groupTitle">
          モード
        </div>

        <div class="modeButtons">
          <button
            type="button"
            id="official"
            class="on"
          >
            本番
          </button>

          <button
            type="button"
            id="practice"
          >
            練習
          </button>
        </div>
      </div>

      <button
        type="button"
        id="mainAction"
        class="action start"
      >
        反射神経を開始
      </button>

      <button
        type="button"
        id="force"
        class="action orange hidden"
      >
        未完了者ありで結果確定
      </button>

      <div class="resetRow">
        <button
          type="button"
          id="reset"
          class="action reset"
        >
          記録リセット
        </button>

        <button
          type="button"
          id="resetAll"
          class="action danger"
        >
          全リセット
        </button>
      </div>
    </aside>

    <main class="main">
      <div class="mainHeader">
        <h2 id="title">
          🏆 反射神経ランキング
        </h2>

        <div
          id="tempoTopTabs"
          class="tempoTopTabs hidden"
        ></div>
      </div>

      <div
        id="tempoInfo"
        class="tempoInfo hidden"
      ></div>

      <div
        id="pager"
        class="pager"
      ></div>

      <div
        id="board"
        class="board"
      >
        <div class="panel">
          記録なし
        </div>
      </div>

      <div
        id="podium"
        class="podium hidden"
      ></div>

      <div
        id="awards"
        class="awards"
      >
        <div class="award">
          <b>
            🎁 ブービー賞
          </b>

          <div id="booby">
            該当なし
          </div>
        </div>

        <div class="award">
          <b>
            🫣 ブービーメーカー
          </b>

          <div id="maker">
            該当なし
          </div>
        </div>
      </div>

      <section
        id="uniqueHistory"
        class="history hidden"
      >
        <h2>
          🧠 最大ユニーク
          過去ラウンド分析
        </h2>

        <div
          id="uniqueHistoryTabs"
          class="historyTabs"
        ></div>

        <div
          id="uniqueHistorySummary"
          class="historySummary"
        >
          本番結果はまだありません
        </div>

        <div class="legend">
          <span>
            <i
              style="background: #80549c;"
            ></i>
            重複
          </span>

          <span>
            <i
              style="background: #2fbc72;"
            ></i>
            ユニーク
          </span>

          <span>
            <i
              style="background: #ffd447;"
            ></i>
            勝利数字
          </span>
        </div>

        <div class="chartScroll">
          <div
            id="uniqueChart"
            class="chart"
          ></div>
        </div>
      </section>
    </main>
  </div>

  <script>
    'use strict';

    const $ = id =>
      document.getElementById(id);

    const PAGE_SIZE = 30;
    const ROWS_PER_COLUMN = 10;

    /*
     * 連打は5秒固定です。
     */
    const TAP_DURATION = 5;

    let mode = 'reflex';
    let practice = false;

    let currentData = {};
    let page = 1;

    let selectedUniqueHistoryId =
      null;

    let selectedTempoView =
      'overall';

    /* =====================================================
       HTTP
       ===================================================== */

    async function post(
      url,
      body = {}
    ) {
      const response =
        await fetch(
          url,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            cache: 'no-store',

            body:
              JSON.stringify(body)
          }
        );

      let responseData = {};

      try {
        responseData =
          await response.json();
      } catch {
        responseData = {};
      }

      if (!response.ok) {
        const requestError =
          new Error(
            JSON.stringify(
              responseData
            )
          );

        requestError.status =
          response.status;

        throw requestError;
      }

      return responseData;
    }

    function escapeHtml(value) {
      return String(value || '')
        .replace(
          /[<>&"]/g,
          character => ({
            '<': '&lt;',
            '>': '&gt;',
            '&': '&amp;',
            '"': '&quot;'
          })[character]
        );
    }

    /* =====================================================
       QRコード
       ===================================================== */

    function createQrCode() {
      const joinUrl =
        location.origin + '/';

      const libraryParts = [
        'https:',
        '',
        'cdn.jsdelivr.net',
        'npm',
        'qrcode-generator@1.4.4',
        'qrcode.js'
      ];

      const script =
        document.createElement(
          'script'
        );

      script.src =
        libraryParts.join('/');

      script.onload = () => {
        try {
          const qr =
            window.qrcode(
              0,
              'M'
            );

          qr.addData(joinUrl);
          qr.make();

          $('qr').innerHTML =
            qr.createImgTag(
              6,
              5
            );
        } catch {
          $('qr').textContent =
            'QR生成失敗';
        }
      };

      script.onerror = () => {
        $('qr').textContent =
          'QR読込失敗';
      };

      document.head.appendChild(
        script
      );
    }

    /* =====================================================
       ゲーム選択
       ===================================================== */

    function gameName(
      gameMode
    ) {
      if (gameMode === 'tap') {
        return '連打5秒';
      }

      if (
        gameMode === 'unique'
      ) {
        return '最大ユニーク';
      }

      if (
        gameMode === 'tempo'
      ) {
        return 'テンポゲーム';
      }

      return '反射神経';
    }

    function choose(
      nextMode
    ) {
      mode = nextMode;
      page = 1;

      selectRanking();
    }

    async function selectRanking() {
      [
        'reflex',
        'tap',
        'unique',
        'tempo'
      ].forEach(gameMode => {
        $(gameMode)
          .classList.toggle(
            'on',
            gameMode === mode
          );
      });

      /*
       * テンポを含め、
       * 本番と練習を自由に切り替えます。
       */
      $('modeGroup')
        .classList.remove(
          'hidden'
        );

      $('uniqueHistory')
        .classList.toggle(
          'hidden',
          mode !== 'unique'
        );

      $('tempoTopTabs')
        .classList.toggle(
          'hidden',
          mode !== 'tempo'
        );

      $('tempoInfo')
        .classList.toggle(
          'hidden',
          mode !== 'tempo'
        );

      try {
        currentData =
          await post(
            '/api/select-ranking',
            {
              mode,

              duration:
                TAP_DURATION
            }
          );

        render(currentData);
      } catch {
        alert(
          'ランキングを切り替えられませんでした'
        );
      }
    }

    [
      'reflex',
      'tap',
      'unique',
      'tempo'
    ].forEach(gameMode => {
      $(gameMode).onclick =
        () => {
          choose(gameMode);
        };
    });

    $('official').onclick = () => {
      practice = false;
      updateButtons();
    };

    $('practice').onclick = () => {
      practice = true;
      updateButtons();
    };

    /* =====================================================
       操作ボタン
       ===================================================== */

    function updateButtons() {
      const stats =
        currentData.stats || {};

      $('official')
        .classList.toggle(
          'on',
          !practice
        );

      $('practice')
        .classList.toggle(
          'on',
          practice
        );

      const canForce =
        stats.active &&
        [
          'reflex',
          'tap',
          'tempo'
        ].includes(
          stats.activeMode
        );

      $('force')
        .classList.toggle(
          'hidden',
          !canForce
        );

      if (mode === 'unique') {
        const uniqueStatus =
          stats.uniqueStatus ||
          'idle';

        if (
          uniqueStatus === 'open'
        ) {
          $('mainAction')
            .textContent =
              '回答を締め切る';

          $('mainAction')
            .className =
              'action orange';
        } else if (
          uniqueStatus === 'closed'
        ) {
          $('mainAction')
            .textContent =
              '結果を発表する';

          $('mainAction')
            .className =
              'action purple';
        } else {
          $('mainAction')
            .textContent =
              '回答受付開始' +
              (
                practice
                  ? '［練習］'
                  : ''
              );

          $('mainAction')
            .className =
              'action start';
        }

        $('mainAction').disabled =
          false;

        return;
      }

      if (mode === 'tempo') {
        $('mainAction')
          .className =
            'action start';

        if (
          stats.activeMode ===
            'tempo' &&
          stats.active
        ) {
          $('mainAction')
            .textContent =
              (
                stats.roundCompleted ||
                0
              ) +
              '/' +
              (
                stats.joined ||
                0
              ) +
              '人完了';

          $('mainAction').disabled =
            true;

          return;
        }

        if (practice) {
          $('mainAction')
            .textContent =
              'テンポ開始［練習］';

          $('mainAction').disabled =
            false;

          return;
        }

        if (
          (
            stats.tempoNext ||
            0
          ) < 3
        ) {
          $('mainAction')
            .textContent =
              'テンポ 本番 第' +
              (
                (
                  stats.tempoNext ||
                  0
                ) + 1
              ) +
              'ラウンド開始';

          $('mainAction').disabled =
            false;

          return;
        }

        $('mainAction')
          .textContent =
            'テンポ本番完了';

        $('mainAction').disabled =
          true;

        return;
      }

      if (mode === 'tap') {
        $('mainAction')
          .textContent =
            '連打5秒を開始' +
            (
              practice
                ? '［練習］'
                : ''
            );
      } else {
        $('mainAction')
          .textContent =
            '反射神経を開始' +
            (
              practice
                ? '［練習］'
                : ''
            );
      }

      $('mainAction').className =
        'action start';

      $('mainAction').disabled =
        Boolean(stats.active);
    }

    $('mainAction').onclick =
      async () => {
        const stats =
          currentData.stats || {};

        try {
          if (
            mode === 'unique'
          ) {
            const action =
              stats.uniqueStatus ===
                'open'
                ? 'close'
                : stats.uniqueStatus ===
                    'closed'
                  ? 'reveal'
                  : 'open';

            await post(
              '/api/unique',
              {
                action,
                practice
              }
            );

            return;
          }

          if (
            mode === 'tempo'
          ) {
            await post(
              '/api/tempo/start',
              {
                practice,

                index:
                  stats.tempoNext ||
                  0
              }
            );

            return;
          }

          await post(
            '/api/start',
            {
              mode,

              duration:
                TAP_DURATION,

              practice
            }
          );
        } catch {
          alert(
            '操作できませんでした'
          );
        }
      };

    $('force').onclick =
      async () => {
        if (
          !confirm(
            '未完了者がいても結果を確定しますか？'
          )
        ) {
          return;
        }

        try {
          await post(
            '/api/finish-active'
          );
        } catch {
          alert(
            '結果を確定できませんでした'
          );
        }
      };

    $('reset').onclick =
      async () => {
        if (
          !confirm(
            '全ゲームの記録をリセットしますか？'
          )
        ) {
          return;
        }

        try {
          await post(
            '/api/reset'
          );
        } catch {
          alert(
            '記録をリセットできませんでした'
          );
        }
      };

    $('resetAll').onclick =
      async () => {
        if (
          !confirm(
            '参加者を含めて全リセットしますか？'
          )
        ) {
          return;
        }

        try {
          await post(
            '/api/reset-all'
          );
        } catch {
          alert(
            '全リセットできませんでした'
          );
        }
      };

    /* =====================================================
       状態表示
       ===================================================== */

    function render(data) {
      currentData = data;

      const stats =
        data.stats || {};

      $('joined').textContent =
        stats.joined || 0;

      $('standby').textContent =
        stats.standby || 0;

      $('answered').textContent =
        stats.roundCompleted || 0;

      /*
       * answering・result・playingなどは
       * 要確認へ表示しません。
       */
      const issues =
        (
          stats.detail || []
        ).filter(entry =>
          [
            '切断・未確認',
            '画面非表示'
          ].includes(
            entry.state
          )
        );

      $('missing').textContent =
        issues.length;

      $('detail').innerHTML =
        issues
          .map(
            entry =>
              escapeHtml(
                entry.name
              ) +
              '：' +
              escapeHtml(
                entry.state
              )
          )
          .join('<br>');

      if (stats.active) {
        $('status').textContent =
          '▶ ' +
          gameName(
            stats.activeMode
          ) +
          '：進行中　完了 ' +
          (
            stats.roundCompleted ||
            0
          ) +
          '/' +
          (
            stats.joined ||
            0
          );

        $('status').className =
          'status playing';
      } else if (
        !issues.length
      ) {
        $('status').textContent =
          '✓ ゲーム開始可能';

        $('status').className =
          'status ok';
      } else {
        $('status').textContent =
          '⚠ ' +
          issues.length +
          '人を要確認';

        $('status').className =
          'status warn';
      }

      renderBoard(data);
      updateButtons();
    }

    /* =====================================================
       ランキング共通
       ===================================================== */

    function formatRank(
      rankNumber
    ) {
      if (
        rankNumber === 1
      ) {
        return '🥇';
      }

      if (
        rankNumber === 2
      ) {
        return '🥈';
      }

      if (
        rankNumber === 3
      ) {
        return '🥉';
      }

      return rankNumber;
    }

    function rankClass(
      rankNumber
    ) {
      if (
        rankNumber === 1
      ) {
        return 'top1';
      }

      if (
        rankNumber === 2
      ) {
        return 'top2';
      }

      if (
        rankNumber === 3
      ) {
        return 'top3';
      }

      return '';
    }

    function rankingCard(
      record,
      unit
    ) {
      return `
        <div
          class="rank ${rankClass(
            record.rank
          )}"
          title="${escapeHtml(
            record.name
          )}"
        >
          <b>
            ${formatRank(
              record.rank
            )}
          </b>

          <span class="rankName">
            ${escapeHtml(
              record.name
            )}
          </span>

          <span class="score">
            ${record.score}${unit}
          </span>

          <span class="tries">
            ${record.tries || 0}回
          </span>
        </div>
      `;
    }

    function reorderPageRecords(
      records
    ) {
      const ordered = [];

      for (
        let row = 0;
        row <
          ROWS_PER_COLUMN;
        row += 1
      ) {
        for (
          let column = 0;
          column < 3;
          column += 1
        ) {
          const index =
            row +
            column *
              ROWS_PER_COLUMN;

          ordered.push(
            records[index] ||
            null
          );
        }
      }

      return ordered;
    }

    function renderStandardBoard(
      board,
      unit
    ) {
      const pageCount =
        Math.max(
          1,
          Math.ceil(
            board.length /
            PAGE_SIZE
          )
        );

      page = Math.max(
        1,
        Math.min(
          page,
          pageCount
        )
      );

      const startIndex =
        (
          page - 1
        ) *
        PAGE_SIZE;

      const endIndex =
        Math.min(
          startIndex +
            PAGE_SIZE,
          board.length
        );

      const pageRecords =
        board.slice(
          startIndex,
          endIndex
        );

      const displayRecords =
        reorderPageRecords(
          pageRecords
        );

      if (
        pageCount > 1
      ) {
        $('pager').innerHTML =
          Array.from(
            {
              length:
                pageCount
            },
            (
              _,
              index
            ) => {
              const pageNumber =
                index + 1;

              return `
                <button
                  type="button"
                  class="${
                    pageNumber ===
                    page
                      ? 'on'
                      : ''
                  }"
                  data-page="${pageNumber}"
                >
                  ${pageNumber}
                </button>
              `;
            }
          ).join('') +
          `
            <span>
              ${
                startIndex + 1
              }～${endIndex}位 /
              ${board.length}人
            </span>
          `;

        document
          .querySelectorAll(
            '[data-page]'
          )
          .forEach(button => {
            button.onclick =
              () => {
                page =
                  Number(
                    button.dataset
                      .page
                  );

                renderBoard(
                  currentData
                );
              };
          });
      } else {
        $('pager').innerHTML =
          '';
      }

      if (!board.length) {
        $('board').innerHTML =
          `
            <div class="panel">
              記録なし
            </div>
          `;

        return;
      }

      $('board').innerHTML =
        displayRecords
          .map(record =>
            record
              ? rankingCard(
                  record,
                  unit
                )
              : `
                <div
                  class="rankPlaceholder"
                ></div>
              `
          )
          .join('');
    }

    /* =====================================================
       最大ユニーク
       ===================================================== */

    function renderUniquePodium(
      history
    ) {
      const latestResult =
        currentData
          .uniqueResult ||
        history.at(-1);

      $('podium').innerHTML =
        [1, 2, 3]
          .map(place => {
            const entry =
              latestResult
                ?.podium
                ?.find(
                  item =>
                    item.place ===
                    place
                );

            return `
              <div
                class="podiumCard place${place}"
              >
                <div class="podiumPlace">
                  ${
                    [
                      '',
                      '🥇',
                      '🥈',
                      '🥉'
                    ][place]
                  }
                  ${place}位
                </div>

                <div class="podiumName">
                  ${
                    entry
                      ? escapeHtml(
                          entry.name
                        )
                      : '該当なし'
                  }
                </div>

                <div class="podiumNumber">
                  ${
                    entry
                      ? '数字 ' +
                        entry.number
                      : ''
                  }
                </div>
              </div>
            `;
          })
          .join('');
    }

    function renderUniqueHistory(
      history
    ) {
      if (!history.length) {
        selectedUniqueHistoryId =
          null;

        $('uniqueHistoryTabs')
          .innerHTML = '';

        $('uniqueHistorySummary')
          .textContent =
            '本番結果はまだありません';

        $('uniqueChart')
          .innerHTML = '';

        return;
      }

      const selectedExists =
        selectedUniqueHistoryId &&
        history.some(
          entry =>
            entry.historyId ===
            selectedUniqueHistoryId
        );

      if (!selectedExists) {
        selectedUniqueHistoryId =
          history
            .at(-1)
            .historyId;
      }

      $('uniqueHistoryTabs')
        .innerHTML =
          history
            .map(entry => `
              <button
                type="button"
                class="${
                  entry.historyId ===
                  selectedUniqueHistoryId
                    ? 'on'
                    : ''
                }"
                data-unique-history="${
                  entry.historyId
                }"
              >
                第${
                  entry.roundNumber
                }ラウンド
              </button>
            `)
            .join('');

      document
        .querySelectorAll(
          '[data-unique-history]'
        )
        .forEach(button => {
          button.onclick =
            () => {
              selectedUniqueHistoryId =
                button.dataset
                  .uniqueHistory;

              renderUniqueHistory(
                history
              );
            };
        });

      const selected =
        history.find(
          entry =>
            entry.historyId ===
            selectedUniqueHistoryId
        );

      const podiumText =
        (
          selected.podium ||
          []
        )
          .map(
            entry =>
              entry.place +
              '位：' +
              escapeHtml(
                entry.name
              ) +
              '（' +
              entry.number +
              '）'
          )
          .join('　');

      $('uniqueHistorySummary')
        .innerHTML =
          `
            第${
              selected.roundNumber
            }ラウンド
            　回答 ${
              selected.answerCount
            }人
            　勝利数字 ${
              selected.winningNumber ??
              'なし'
            }
            <br>
            ${
              podiumText ||
              'ユニーク数字なし'
            }
          `;

      const distributionMap =
        new Map(
          (
            selected.distribution ||
            []
          ).map(entry => [
            entry.number,
            entry
          ])
        );

      const maxCount =
        Math.max(
          1,
          ...(
            selected.distribution ||
            []
          ).map(
            entry =>
              entry.count
          )
        );

      $('uniqueChart').innerHTML =
        Array.from(
          {
            length: 100
          },
          (
            _,
            index
          ) => {
            const number =
              index + 1;

            const entry =
              distributionMap.get(
                number
              );

            const count =
              entry?.count || 0;

            const height =
              count
                ? Math.max(
                    5,
                    Math.round(
                      count /
                      maxCount *
                      255
                    )
                  )
                : 0;

            const barClass =
              entry?.winner
                ? 'winner'
                : entry?.unique
                  ? 'unique'
                  : '';

            return `
              <div class="barColumn">
                <div
                  class="chartBar ${barClass}"
                  style="height: ${height}px;"
                >
                  ${
                    count
                      ? `
                        <span
                          class="barCount"
                        >
                          ${count}
                        </span>
                      `
                      : ''
                  }
                </div>

                <span class="barNumber">
                  ${number}
                </span>
              </div>
            `;
          }
        ).join('');
    }

    /* =====================================================
       テンポラウンド切替
       ===================================================== */

    function renderTempoViews(
      history,
      overallBoard
    ) {
      const roundViews =
        history
          .filter(Boolean)
          .map(entry => ({
            key:
              String(
                entry.index
              ),

            label:
              '第' +
              (
                entry.index +
                1
              ) +
              'ラウンド',

            tempoMs:
              entry.tempoMs,

            board:
              entry.board ||
              []
          }));

      const views = [
        ...roundViews,

        {
          key: 'overall',
          label: '総合',
          tempoMs: null,

          board:
            overallBoard ||
            []
        }
      ];

      const selectedExists =
        views.some(
          entry =>
            entry.key ===
            selectedTempoView
        );

      if (!selectedExists) {
        selectedTempoView =
          roundViews[0]
            ?.key ||
          'overall';
      }

      $('tempoTopTabs')
        .innerHTML =
          views
            .map(entry => `
              <button
                type="button"
                class="${
                  entry.key ===
                  selectedTempoView
                    ? 'on'
                    : ''
                }"
                data-tempo-view="${
                  entry.key
                }"
              >
                ${entry.label}
              </button>
            `)
            .join('');

      document
        .querySelectorAll(
          '[data-tempo-view]'
        )
        .forEach(button => {
          button.onclick =
            () => {
              selectedTempoView =
                button.dataset
                  .tempoView;

              page = 1;

              renderTempoViews(
                history,
                overallBoard
              );
            };
        });

      const selected =
        views.find(
          entry =>
            entry.key ===
            selectedTempoView
        ) ||
        views.at(-1);

      $('title').textContent =
        '🎵 テンポゲーム ' +
        selected.label +
        'ランキング';

      $('tempoInfo')
        .textContent =
          selected.tempoMs
            ? (
                selected.label +
                '　見本テンポ ' +
                (
                  selected.tempoMs /
                  1000
                ).toFixed(1) +
                '秒'
              )
            : (
                '本番3ラウンドすべての平均による総合ランキング'
              );

      renderStandardBoard(
        selected.board,
        'ms'
      );
    }

    /* =====================================================
       ランキング画面切替
       ===================================================== */

    function renderBoard(data) {
      const stats =
        data.stats || {};

      const board =
        data.board || [];

      const isUnique =
        stats.mode ===
        'unique';

      const isTempo =
        stats.mode ===
        'tempo';

      $('board')
        .classList.toggle(
          'hidden',
          isUnique
        );

      $('podium')
        .classList.toggle(
          'hidden',
          !isUnique
        );

      $('awards')
        .classList.toggle(
          'hidden',
          isUnique ||
          isTempo
        );

      $('uniqueHistory')
        .classList.toggle(
          'hidden',
          !isUnique
        );

      $('tempoTopTabs')
        .classList.toggle(
          'hidden',
          !isTempo
        );

      $('tempoInfo')
        .classList.toggle(
          'hidden',
          !isTempo
        );

      if (isUnique) {
        $('title').textContent =
          '🎃 最大ユニークナンバー 結果';

        $('pager').innerHTML =
          '';

        renderUniquePodium(
          data.uniqueHistory ||
          []
        );

        renderUniqueHistory(
          data.uniqueHistory ||
          []
        );

        return;
      }

      if (isTempo) {
        renderTempoViews(
          data.tempoHistory ||
          [],
          board
        );

        return;
      }

      $('tempoTopTabs').innerHTML =
        '';

      const unit =
        stats.mode === 'tap'
          ? '回'
          : 'ms';

      if (
        stats.mode === 'tap'
      ) {
        $('title').textContent =
          '🏆 連打5秒ランキング';
      } else {
        $('title').textContent =
          '🏆 反射神経ランキング';
      }

      renderStandardBoard(
        board,
        unit
      );

      $('booby').textContent =
        data.booby?.prize
          ?.join('、') ||
        '該当なし';

      $('maker').textContent =
        data.booby?.maker
          ?.join('、') ||
        '該当なし';
    }

    /* =====================================================
       SSE
       ===================================================== */

    const eventSource =
      new EventSource(
        '/events/host'
      );

    eventSource.addEventListener(
      'leaderboard',
      event => {
        render(
          JSON.parse(
            event.data
          )
        );
      }
    );

    createQrCode();
    selectRanking();
  </script>
</body>
</html>
  process.env.PORT || 3000;

const RESULT_MS = Math.max(
  20,
  Number(
    process.env.RESULT_MS || 5000
  )
);

const PUBLIC = path.join(
  __dirname,
  'public'
);

const uid = () =>
  crypto
    .randomBytes(12)
    .toString('hex');

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

/* =========================================================
   参加者データ
   ========================================================= */

function newPlayer(
  name,
  clientKey = ''
) {
  return {
    clientKey:
      String(clientKey || ''),

    name,

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

function clean(value) {
  return (
    String(value || '')
      .normalize('NFKC')
      .replace(
        /[\s\u3000]+/g,
        ' '
      )
      .trim()
      .slice(0, 40) ||
    '名無し'
  );
}

function nameKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(
      /[\s\u3000]+/g,
      ''
    )
    .toLocaleLowerCase(
      'ja-JP'
    );
}

/* =========================================================
   HTTP共通処理
   ========================================================= */

function json(
  res,
  status,
  data
) {
  res.writeHead(status, {
    'Content-Type':
      'application/json; charset=utf-8',

    'Cache-Control':
      'no-store'
  });

  res.end(
    JSON.stringify(data)
  );
}

function read(req) {
  return new Promise(resolve => {
    let requestBody = '';

    req.on('data', chunk => {
      requestBody += chunk;

      if (
        requestBody.length >
        1000000
      ) {
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        resolve(
          JSON.parse(
            requestBody || '{}'
          )
        );
      } catch {
        resolve({});
      }
    });

    req.on('error', () => {
      resolve({});
    });
  });
}

/* =========================================================
   SSE共通処理
   ========================================================= */

function sse(
  res,
  event,
  data
) {
  try {
    res.write(
      `event: ${event}\n` +
      `data: ${JSON.stringify(data)}\n\n`
    );
  } catch {
    // 接続切断済みの場合は何もしない
  }
}

function emitAll(
  event,
  data
) {
  for (
    const res of
      playerStreams.values()
  ) {
    sse(
      res,
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
  const res =
    playerStreams.get(playerId);

  if (res) {
    sse(
      res,
      event,
      data
    );
  }
}

function emitHosts() {
  const data = payload();

  for (
    const res of
      hostStreams
  ) {
    sse(
      res,
      'leaderboard',
      data
    );
  }
}

/* =========================================================
   参加者検索とセッション確認
   ========================================================= */

function byName(name) {
  const searchKey =
    nameKey(name);

  if (!searchKey) {
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
      searchKey
    ) {
      return [
        playerId,
        player
      ];
    }
  }

  return null;
}
function byClientKey(
  clientKey
) {
  const searchKey =
    String(clientKey || '');

  if (!searchKey) {
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
      searchKey
    ) {
      return [
        playerId,
        player
      ];
    }
  }

  return null;
}

function valid(body) {
  return (
    body &&
    body.sessionGeneration ===
      generation &&
    players.has(
      String(body.id || '')
    )
  );
}

function setState(
  playerId,
  nextState,
  visible = true
) {
  const player =
    players.get(playerId);

  if (!player) {
    return;
  }

  player.state =
    nextState || player.state;

  player.visible =
    visible !== false;

  player.lastSeen =
    Date.now();
}

/* =========================================================
   ランキング計算
   ========================================================= */

function rank(
  rows,
  ascending
) {
  let previousScore = null;
  let previousRank = 0;

  return rows
    .sort((a, b) => {
      if (ascending) {
        return a.score - b.score;
      }

      return b.score - a.score;
    })
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

  for (
    const [
      playerId,
      player
    ] of players
  ) {
    const completedAllRounds =
      player.tempoRounds.every(
        result =>
          result &&
          result.valid
      );

    if (!completedAllRounds) {
      continue;
    }

    const total =
      player.tempoRounds.reduce(
        (
          sum,
          result
        ) =>
          sum + result.avg,
        0
      );

    const score =
      Math.round(
        total / 3 * 10
      ) / 10;

    rows.push({
      id: playerId,
      name: player.name,
      score,

      rounds:
        player.tempoRounds.map(
          result => result.avg
        ),

      tries: 3
    });
  }

  return rank(
    rows,
    true
  );
}

function leaderboard() {
  if (view.mode === 'tempo') {
    return tempoOverall();
  }

  if (view.mode === 'unique') {
    const rows =
      [...players.values()]
        .map(player => ({
          name: player.name,
          score:
            player.uniquePoints,
          tries:
            player.uniqueWins
        }))
        .filter(
          row => row.score > 0
        );

    return rank(
      rows,
      false
    );
  }

  if (view.mode === 'tap') {
    const durationKey =
      String(view.duration);

    const rows =
      [...players.values()]
        .map(player => ({
          name: player.name,

          score:
            player.tapBest[
              durationKey
            ],

          tries:
            player.tapTries[
              durationKey
            ] || 0
        }))
        .filter(row =>
          Number.isFinite(
            row.score
          )
        );

    return rank(
      rows,
      false
    );
  }

  const reflexRows =
    [...players.values()]
      .filter(player =>
        Number.isFinite(
          player.reflexBest
        )
      )
      .map(player => ({
        name: player.name,
        score:
          player.reflexBest,
        tries:
          player.reflexTries
      }));

  return rank(
    reflexRows,
    true
  );
}

function booby(board) {
  if (
    [
      'unique',
      'tempo'
    ].includes(view.mode) ||
    board.length < 2
  ) {
    return {
      prize: [],
      maker: []
    };
  }

  const scoreGroups =
    [
      ...new Set(
        board.map(
          row => row.score
        )
      )
    ];

  if (
    scoreGroups.length < 2
  ) {
    return {
      prize: [],

      maker:
        board.map(
          row => row.name
        )
    };
  }

  const makerScore =
    scoreGroups.at(-1);

  const prizeScore =
    scoreGroups.at(-2);

  return {
    prize:
      board
        .filter(
          row =>
            row.score ===
            prizeScore
        )
        .map(
          row => row.name
        ),

    maker:
      board
        .filter(
          row =>
            row.score ===
            makerScore
        )
        .map(
          row => row.name
        )
  };
}

/* =========================================================
   接続・待機状態
   ========================================================= */

function presence() {
  const currentTime =
    Date.now();

  let standby = 0;
  let connected = 0;
  let playing = 0;

  const detail = [];

  for (
    const [
      playerId,
      player
    ] of players
  ) {
    const online =
      playerStreams.has(
        playerId
      ) &&
      currentTime -
        player.lastSeen <
        30000;

    if (online) {
      connected += 1;
    }

    /*
     * 「直前の結果を確認」を開いている場合、
     * player.html側からstandbyとして通知されます。
     */
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
   ホストへ送る状態
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

function stats() {
  return {
    joined: players.size,
    answered:
      completedCount(),

    round: roundNo,

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

    mode: view.mode,
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
  const board =
    leaderboard();

  return {
    board,

    stats:
      stats(),

    booby:
      booby(board),

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

function push() {
  emitHosts();
}

/* =========================================================
   結果表示共通処理
   ========================================================= */

function readyForAuto() {
  return (
    players.size > 0 &&
    completedCount() >=
      players.size
  );
}

function personalRanking(
  board,
  playerId,
  rawResult
) {
  const playerName =
    players.get(
      playerId
    )?.name;

  const self =
    board.find(
      row =>
        row.id ===
          playerId ||
        row.name ===
          playerName
    );

  return {
    top3:
      board.slice(0, 3),

    self,
    raw:
      rawResult,

    durationMs:
      RESULT_MS
  };
}

function returnPlayersToStandby() {
  for (
    const player of
      players.values()
  ) {
    player.state =
      'standby';
  }

  emitAll(
    'standby',
    {}
  );

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

        ...personalRanking(
          board,
          playerId,
          rawMap?.get(playerId)
        ),

        ...extra
      }
    );
  }

  push();

  setTimeout(
    returnPlayersToStandby,
    RESULT_MS
  );
}

/* =========================================================
   反射神経・連打
   ========================================================= */

function finishSpeedRound() {
  if (
    active.type !== 'speed'
  ) {
    return;
  }

  const completedRound =
    active;

  let board;

  if (
    completedRound.practice
  ) {
    const practiceRows =
      [
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
            ...result,
            id: playerId
          })
        )
        .filter(
          result =>
            result.valid
        )
        .map(result => ({
          id: result.id,
          name: result.name,
          score: result.score,
          tries: 1
        }));

    board = rank(
      practiceRows,

      completedRound.mode ===
        'reflex'
    );
  } else {
    board =
      leaderboard();
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

function tempoBoard(resultMap) {
  const rows =
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
      );

  return rank(
    rows,
    true
  );
}

function finishTempoRound() {
  if (
    active.type !== 'tempo'
  ) {
    return;
  }

  const completedRound =
    active;

  const board =
    tempoBoard(
      completedRound.results
    );

  if (
    completedRound.practice
  ) {
    tempoPracticeDone = true;
  } else {
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
    at: Date.now(),

    tempoMs:
      completedRound.tempoMs
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

        ...personalRanking(
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

  push();

  setTimeout(() => {
    returnPlayersToStandby();

    if (
      !completedRound.practice &&
      completedRound.index === 2
    ) {
      setTimeout(
        showTempoOverall,
        Math.min(
          600,
          RESULT_MS + 20
        )
      );
    }
  }, RESULT_MS);
}

function showTempoOverall() {
  const board =
    tempoOverall();

  lastReveal = {
    kind: 'tempo-overall',

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

        ...personalRanking(
          board,
          playerId,
          null
        ),

        durationMs:
          RESULT_MS
      }
    );
  }

  push();

  setTimeout(() => {
    emitAll(
      'standby',
      {}
    );

    push();
  }, RESULT_MS);
}

function maybeFinish() {
  if (!readyForAuto()) {
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
   最大ユニークナンバー
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

  const uniqueNumbers =
    [...counts]
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
        (a, b) =>
          b - a
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
            place: index + 1,
            number,
            id: playerId,
            name: playerName
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
      winner.uniquePoints += 1;
      winner.uniqueWins += 1;
    }
  }

  const result = {
    historyId: uid(),
    roundId: roundNo,

    roundNumber:
      uniqueHistory.length +
      1,

    winningNumber,
    winners,
    podium,

    answerCount:
      active.answers.size,

    distribution:
      [...counts]
        .sort(
          (a, b) =>
            a[0] - b[0]
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

  if (!active.practice) {
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
      answers.get(playerId);

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

  push();

  setTimeout(
    returnPlayersToStandby,
    RESULT_MS
  );

  return result;
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

  tempoPracticeDone =
    false;

  tempoNext = 0;
  lastReveal = null;

  active = {
    type: 'idle'
  };
}

/* =========================================================
   静的HTML配信
   ========================================================= */

function serve(
  res,
  file
) {
  fs.readFile(
    file,
    (
      error,
      fileData
    ) => {
      if (error) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      res.writeHead(200, {
        'Content-Type':
          'text/html; charset=utf-8',

        'Cache-Control':
          'no-store'
      });

      res.end(fileData);
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
      const requestUrl =
        new URL(
          req.url,
          `http://${req.headers.host || 'localhost'}`
        );

      const pathname =
        requestUrl.pathname;

      /* -------------------------------
         Health Check
         ------------------------------- */

      if (
        pathname === '/healthz'
      ) {
        return json(
          res,
          200,
          {
            ok: true
          }
        );
      }

      /* -------------------------------
         HTML
         ------------------------------- */

      if (
        pathname === '/' ||
        pathname === '/player' ||
        pathname ===
          '/player.html'
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
        pathname ===
          '/host.html'
      ) {
        return serve(
          res,
          path.join(
            PUBLIC,
            'host.html'
          )
        );
      }

      /* -------------------------------
         プレイヤー用SSE
         ------------------------------- */

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
          return json(
            res,
            409,
            {
              staleSession: true
            }
          );
        }

        if (
          !players.has(
            playerId
          )
        ) {
          return json(
            res,
            404,
            {
              playerMissing: true
            }
          );
        }

        res.writeHead(200, {
          'Content-Type':
            'text/event-stream',

          'Cache-Control':
            'no-store',

          Connection:
            'keep-alive',

          'X-Accel-Buffering':
            'no'
        });

        res.write('\n');

        const previousStream =
          playerStreams.get(
            playerId
          );

        if (
          previousStream &&
          previousStream !== res
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

        setState(
          playerId,
          'standby',
          true
        );

        sse(
          res,
          'hello',
          {
            generation
          }
        );

        push();

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

            push();
          }
        );

        return;
      }

      /* -------------------------------
         ホスト用SSE
         ------------------------------- */

      if (
        pathname ===
          '/events/host'
      ) {
        res.writeHead(200, {
          'Content-Type':
            'text/event-stream',

          'Cache-Control':
            'no-store',

          Connection:
            'keep-alive',

          'X-Accel-Buffering':
            'no'
        });

        res.write('\n');

        hostStreams.add(res);

        sse(
          res,
          'leaderboard',
          payload()
        );

        req.on(
          'close',
          () => {
            hostStreams.delete(res);
          }
        );

        return;
      }

      /* -------------------------------
         新規参加
         ------------------------------- */

      if (
        req.method === 'POST' &&
        pathname === '/api/join'
      ) {
        const body =
          await read(req);

        const name =
          clean(body.name);

        const clientKey =
          String(
            body.clientKey || ''
          );

        const existing =
          byClientKey(
            clientKey
          ) ||
          byName(name);

        if (existing) {
          const [
            existingId,
            existingPlayer
          ] = existing;

          if (clientKey) {
            existingPlayer.clientKey =
              clientKey;
          }

          setState(
            existingId,
            'standby',
            true
          );

          push();

          return json(
            res,
            200,
            {
              id: existingId,

              name:
                existingPlayer.name,

              sessionGeneration:
                generation,

              restored: true
            }
          );
        }

        const newId = uid();

        players.set(
          newId,
          newPlayer(
            name,
            clientKey
          )
        );

        push();

        return json(
          res,
          200,
          {
            id: newId,
            name,

            sessionGeneration:
              generation,

            restored: false
          }
        );
      }

      /* -------------------------------
         再入場
         ------------------------------- */

      if (
        req.method === 'POST' &&
        pathname ===
          '/api/rejoin'
      ) {
        const body =
          await read(req);

        const requestedId =
          String(
            body.id || ''
          );

        const clientKey =
          String(
            body.clientKey ||
            ''
          );

        const requestedName =
          String(
            body.name || ''
          ).trim();

        /*
         * 1. 保存していた参加者IDが
         *    現在のセッションで有効
         */
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

          setState(
            requestedId,
            'standby',
            true
          );

          push();

          return json(
            res,
            200,
            {
              id: requestedId,
              name: player.name,

              sessionGeneration:
                generation,

              restored: true
            }
          );
        }

        /*
         * 2. 端末キーまたは同じ名前から
         *    既存参加者を復元
         */
        const existing =
          byClientKey(
            clientKey
          ) ||
          (
            requestedName
              ? byName(
                  requestedName
                )
              : null
          );

        if (existing) {
          const [
            existingId,
            existingPlayer
          ] = existing;

          if (clientKey) {
            existingPlayer.clientKey =
              clientKey;
          }

          setState(
            existingId,
            'standby',
            true
          );

          push();

          return json(
            res,
            200,
            {
              id: existingId,

              name:
                existingPlayer.name,

              sessionGeneration:
                generation,

              restored: true
            }
          );
        }

        /*
         * 3. Render再起動などで
         *    参加者一覧が消えた場合は、
         *    保存済みの名前で再作成
         */
        if (requestedName) {
          const recreatedId =
            uid();

          players.set(
            recreatedId,
            newPlayer(
              clean(
                requestedName
              ),
              clientKey
            )
          );

          setState(
            recreatedId,
            'standby',
            true
          );

          push();

          return json(
            res,
            200,
            {
              id: recreatedId,

              name:
                clean(
                  requestedName
                ),

              sessionGeneration:
                generation,

              restored: true,
              recreated: true
            }
          );
        }

        return json(
          res,
          404,
          {
            playerMissing: true,

            sessionGeneration:
              generation
          }
        );
      }

      /* -------------------------------
         参加者状態通知
         ------------------------------- */

      if (
        req.method === 'POST' &&
        pathname ===
          '/api/state'
      ) {
        const body =
          await read(req);

        if (!valid(body)) {
          return json(
            res,
            409,
            {
              staleSession: true
            }
          );
        }

        setState(
          String(body.id),
          body.state,
          body.visible
        );

        push();

        return json(
          res,
          200,
          {
            ok: true
          }
        );
      }

      /* -------------------------------
         ランキング表示切替
         ------------------------------- */

      if (
        req.method === 'POST' &&
        pathname ===
          '/api/select-ranking'
      ) {
        const body =
          await read(req);

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
        ].includes(
          Number(body.duration)
        )
          ? Number(
              body.duration
            )
          : 7;

        push();

        return json(
          res,
          200,
          payload()
        );
      }

      /* -------------------------------
         反射神経・連打開始
         ------------------------------- */

      if (
        req.method === 'POST' &&
        pathname === '/api/start'
      ) {
        if (
          active.type !== 'idle'
        ) {
          return json(
            res,
            409,
            {
              busy: true
            }
          );
        }

        const body =
          await read(req);

        const mode =
          body.mode === 'tap'
            ? 'tap'
            : 'reflex';

        const duration = [
          5,
          7,
          10
        ].includes(
          Number(body.duration)
        )
          ? Number(
              body.duration
            )
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
            Boolean(
              body.practice
            ),

          results:
            new Map(),

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

        push();

        return json(
          res,
          200,
          {
            ok: true
          }
        );
      }

      /* -------------------------------
         反射神経・連打結果
         ------------------------------- */

      if (
        req.method === 'POST' &&
        pathname === '/api/result'
      ) {
        const body =
          await read(req);

        if (
          !valid(body) ||
          active.type !==
            'speed'
        ) {
          return json(
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
          active.mode === 'tap'
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
            const durationKey =
              String(
                active.duration
              );

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

        setState(
          playerId,
          'result',
          true
        );

        push();

        setTimeout(
          maybeFinish,
          120
        );

        return json(
          res,
          200,
          {
            ok: true
          }
        );
      }

      /* -------------------------------
         未完了者ありで結果確定
         ------------------------------- */

      if (
        req.method === 'POST' &&
        pathname ===
          '/api/finish-active'
      ) {
        if (
          active.type === 'speed'
        ) {
          finishSpeedRound();
        } else if (
          active.type === 'tempo'
        ) {
          finishTempoRound();
        } else {
          return json(
            res,
            409,
            {
              wrongState: true
            }
          );
        }

        return json(
          res,
          200,
          {
            ok: true
          }
        );
      }

      /* -------------------------------
         最大ユニーク操作
         ------------------------------- */

      if (
        req.method === 'POST' &&
        pathname === '/api/unique'
      ) {
        const body =
          await read(req);

        if (
          body.action === 'open'
        ) {
          if (
            active.type !== 'idle'
          ) {
            return json(
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

          push();

          return json(
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

          push();

          return json(
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
          const result =
            revealUnique();

          return json(
            res,
            200,
            {
              ok: true,
              result
            }
          );
        }

        return json(
          res,
          409,
          {
            wrongState: true
          }
        );
      }

      /* -------------------------------
         最大ユニーク回答
         ------------------------------- */

      if (
        req.method === 'POST' &&
        pathname ===
          '/api/unique-answer'
      ) {
        const body =
          await read(req);

        if (
          !valid(body) ||
          active.type !==
            'unique-open'
        ) {
          return json(
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
          return json(
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

        setState(
          String(body.id),
          'answering',
          true
        );

        push();

        return json(
          res,
          200,
          {
            ok: true,
            number
          }
        );
      }

      /* -------------------------------
         テンポゲーム開始
         ------------------------------- */

      if (
        req.method === 'POST' &&
        pathname ===
          '/api/tempo/start'
      ) {
        const body =
          await read(req);

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
          active.type !== 'idle'
        ) {
          return json(
            res,
            409,
            {
              busy: true
            }
          );
        }

        if (
          !practiceMode &&
          index !== tempoNext
        ) {
          return json(
            res,
            409,
            {
              wrongRound: true
            }
          );
        }

        if (!tempoPlan.length) {
          const choice =
            values =>
              values[
                Math.floor(
                  Math.random() *
                    values.length
                )
              ];

          tempoPlan = [
            choice([
              700,
              800,
              900
            ]),

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
            : tempoPlan[index];

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
              : (
                  'テンポゲーム ' +
                  '本番 第' +
                  (
                    index + 1
                  ) +
                  'ラウンド'
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

        push();

        return json(
          res,
          200,
          {
            ok: true
          }
        );
      }

      /* -------------------------------
         テンポゲーム結果
         ------------------------------- */

      if (
        req.method === 'POST' &&
        pathname ===
          '/api/tempo/result'
      ) {
        const body =
          await read(req);

        if (
          !valid(body) ||
          active.type !==
            'tempo' ||
          Number(
            body.roundId
          ) !== roundNo
        ) {
          return json(
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

            const averageError =
              errors.reduce(
                (
                  total,
                  errorValue
                ) =>
                  total +
                  errorValue,
                0
              ) / 9;

            result = {
              name:
                player.name,

              valid: true,

              avg:
                Math.round(
                  averageError *
                  10
                ) / 10,

              max:
                Math.round(
                  Math.max(
                    ...errors
                  ) *
                  10
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

        setState(
          playerId,
          'result',
          true
        );

        push();

        setTimeout(
          maybeFinish,
          120
        );

        return json(
          res,
          200,
          {
            ok: true,
            record: result
          }
        );
      }

      /* -------------------------------
         記録リセット
         ------------------------------- */

      if (
        req.method === 'POST' &&
        pathname === '/api/reset'
      ) {
        resetScores();

        emitAll(
          'reset',
          {}
        );

        push();

        return json(
          res,
          200,
          {
            ok: true
          }
        );
      }

      /* -------------------------------
         全リセット
         ------------------------------- */

      if (
        req.method === 'POST' &&
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

        generation = uid();
        roundNo = 0;

        view = {
          mode: 'reflex',
          duration: 7
        };

        resetScores();
        push();

        return json(
          res,
          200,
          {
            ok: true
          }
        );
      }

      res.writeHead(404);
      res.end('Not found');
    }
  );

/* =========================================================
   定期更新
   ========================================================= */

setInterval(
  push,
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
      `Halloween complete v5.2 on ${PORT}`
    );
  }
);
