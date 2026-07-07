# Handoff: Fog Explorer — 現実世界フォグ・オブ・ウォー探索アプリ

> **実装済み**: この仕様を PWA として再実装しました（Vite + React フロント / Node+Express バックエンド / PostgreSQL、Docker Compose 3構成、GitHub Actions でイメージビルド）。
> 起動・iOSインストール手順は **[DEPLOYMENT.md](DEPLOYMENT.md)** を参照。コードは [`frontend/`](frontend/) と [`backend/`](backend/) にあります。
> 以下は元のデザイン・ハンドオフ仕様（デザインの最終意図のソース）です。

## Overview
GTA5のミニマップのように、訪れたことのない場所は霧で隠れ、実際に歩いた場所だけ地図が「解放」されていく探索アプリ。ナビ用途ではなく、霧が晴れていく体験そのものと探索率・レベル・スポット発見のゲーム性が主目的。ターゲットはiOS（開発者はWindowsのみ → Expo/EASクラウドビルド、またはPWAを推奨）。

## About the Design Files
このバンドルの `Fog Explorer.dc.html` は **HTMLで作られたデザインリファレンス（動くプロトタイプ）** であり、そのまま出荷するコードではない。タスクはこのデザイン・挙動を**ターゲット環境で再実装**すること。推奨スタック:

- **iOS ネイティブ**: React Native (Expo) + `react-native-maps` or Mapbox GL + Skia/Canvas で霧レイヤー。WindowsからはEAS Buildでビルド可能
- **PWA**: Leaflet + Canvas マスク（プロトタイプと同じ手法がそのまま使える）+ Geolocation API + Service Worker

プロトタイプは擬似GPS（自動歩行シミュレーション + 地図タップで移動）。実装では実GPS（バックグラウンド位置取得が理想）に置き換える。

## Fidelity
**High-fidelity**。色・タイポグラフィ・レイアウト・挙動は最終意図。ただしiOSベゼル（`ios-frame.jsx`）はプレビュー用の枠であり実装対象外。

## Screens / Views

### 1. メインマップ
- 全画面ダーク地図。タイル: CARTO dark_all (`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`, © OpenStreetMap © CARTO)。初期中心: 渋谷 35.6595, 139.7005 / zoom 14
- **霧オーバーレイ**: 地図の上に全面レイヤー。訪問点の集合で「穴」を開けたマスクを適用
  - デフォルト表現: `background: rgba(5,8,13,.62)` + `backdrop-filter: blur(9px) brightness(.4) saturate(.4)`
  - 代替1「漆黒(GTA風)」: 不透明 `#04070c`
  - 代替2「グリッド」: `#050a12` 地 + 22px間隔の `rgba(20,30,45,.9)` 1pxグリッド線
  - 穴はプレイヤー訪問点ごとの radial gradient: 中心〜65%まで完全透過、65→100%でフェード。半径はデフォルト1000m（設定可能 100–2000m）
- **ビネット**: `inset 0 0 90px 30px rgba(0,0,0,.55)`
- **プレイヤーマーカー**: アクセント色の三角矢印（進行方向に回転、`drop-shadow(0 0 6px accent)`）+ 2s無限パルスリング（scale .6→2.4, opacity .8→0）
- **HUD 上部**（左右2カード, `rgba(8,11,16,.78)` + blur 8px, border `rgba(255,255,255,.09)`, radius 10px, padding 10×14）:
  - 左: ラベル「探索率」(Oswald 11px, letter-spacing 2.5px, #7e8ba0) + 値 (Oswald 700 32px, アクセント色) + %
  - 右: 「LEVEL」+ 値 (Oswald 700 32px, #e8ecf4)
- **発見トースト**（中央上, 3.4sで自動退場）: 黒カード + アクセント色ボーダー + glow。「NEW AREA DISCOVERED」(Oswald 10px, ls 3px, アクセント) + スポット名 (Noto Sans JP 700 16px, #fff)
- **右下ボタン列**: ▶/❚❚（自動歩行トグル、アクセント色）と ◎（現在地へ）。54px円形, `rgba(8,11,16,.85)` + blur, border `rgba(255,255,255,.14)`
- **ヒントピル**（下中央）: 「自動歩行中 — 地図タップで目的地へ」等, 11px #8a96aa

### 2. 発見ログ（タイムライン）
- 全面パネル `rgba(7,10,14,.94)` + blur 10px
- 見出し「DISCOVERY LOG — 発見の記録」(Oswald 13px, ls 3px, #7e8ba0)
- 各行: アクセント色ドット(10px, glow) + 縦ライン、スポット名 (700 15px #eef2f8)、時刻 + 「x.x km 地点」(11px #6b7788)。新しい順
- 空状態: 「まだ発見はありません。マップを歩いて霧を晴らしましょう。」

### 3. 統計
- 2×2カードグリッド（`rgba(255,255,255,.04)`, border `rgba(255,255,255,.08)`, radius 12px, padding 16px）: 探索率(都心部)% / 解放面積 km² / 発見スポット n/12 / 総移動距離 km。値は Oswald 700 30px
- レベルカード: 「LEVEL n」+「次のレベルまで x セル」+ XPバー（8px, アクセント色 + glow）
- 危険ボタン「霧をリセット（全消去）」: `rgba(255,60,60,.08)` 地, border `rgba(255,80,80,.35)`, 文字 #ff7a7a

### タブバー（全画面共通・下部）
- フローティング: `rgba(8,11,16,.85)` + blur 12px, border `rgba(255,255,255,.1)`, radius 16px
- 3タブ: マップ ◈ / 発見 ◷ / 統計 ▦（実装ではSF Symbols等に置換）。アクティブ: 地 `rgba(255,255,255,.1)` + アクセント色、非アクティブ #77839a。ラベル Noto Sans JP 700 10px

## ロケーションブリップ（GTA風）
- 枠なしのフラットピクトグラムを地図に直接描画。約24px、暗い縁取り(`#0a0d12` stroke 1.6) + `drop-shadow(0 1px 2px rgba(0,0,0,.9))`
- カテゴリと色: 駅=電車アイコン #5EC8FF / 公園=木 #7CFC9B / 神宮=鳥居 #FF7A5C / 商業=バッグ #fff / 川=波線 #5EC8FF / 競技場=旗 #FFD166 / 交差点=星 #FFD166
- 状態遷移: **霧の中 = 非表示** → **霧が晴れた圏内 = 白い「?」が1.6s点滅** → **600m以内に接近 = 発見**（正体のアイコンに変化 + トースト + ログ記録）
- タップでスポット名ポップアップ

## Interactions & Behavior
- 地図タップ → その地点へ歩行（プロトタイプのみ。実アプリは実GPS追跡）
- 訪問点の記録間隔: 前回記録点から max(80m, 半径×0.12) 移動ごと
- 霧マスクは地図の move/zoom ごとに再計算（rAFスロットル）
- トースト: 3.4s アニメ（下がって出현→静止→フェード）

## State Management
- `visited: {lat,lng}[]`（間引き済み軌跡）、`cells: Set<string>`（250mグリッドの解放セル。探索率の分母は都心バウンディング 35.62–35.72 / 139.65–139.77）
- `discoveries: {name,time,dist,t}[]`、`totalDist`、`playing`、`tab`
- 探索率 = 解放セル数 / 総セル数。面積 = セル数 × 0.0625km²。レベル = floor(√(セル/30))+1
- 永続化: 全状態をローカル保存（プロトタイプはlocalStorage。実装はAsyncStorage/SQLite等）

## Design Tokens
- 背景: `#0a0d12` / パネル `rgba(8,11,16,.78–.94)` / カード `rgba(255,255,255,.04)`
- 文字: 主 `#e8ecf4` `#eef2f8` / 副 `#7e8ba0` `#77839a` `#6b7788` `#8a96aa`
- アクセント（選択式）: `#7CFC9B`(デフォルト) / `#5EC8FF` / `#FFD166` / `#FF7A5C`。glow = アクセント+55(alpha)
- フォント: **Oswald**（HUD数値・英字ラベル, 400–700）+ **Noto Sans JP**（本文, 400/500/700）
- radius: カード10–12px, タブバー16px, ピル999px。ボーダー: `rgba(255,255,255,.06–.14)`

## 設定可能パラメータ（プロトタイプのTweaks）
- fogStyle: blur / black / grid、revealRadius: 100–2000m (default 1000)、walkSpeed: 2–40 m/s、accent色

## Assets
外部アセットなし。地図タイルはCARTO（利用規約・attribution必須）。アイコンは全てインラインSVG/CSS。

## Files
実装は [`frontend/`](frontend/)（PWA）と [`backend/`](backend/) にあります。起動手順は [DEPLOYMENT.md](DEPLOYMENT.md) を参照。
（元のデザイン参照 `Fog Explorer.dc.html`（プロトタイプ本体）と `ios-frame.jsx`（iPhoneベゼル）は削除済み。必要なら git 履歴から復元できます。）
