# Fog Explorer — 実装・デプロイガイド

ハンドオフ仕様（[README.md](README.md)）と動くプロトタイプ（`Fog Explorer.dc.html`）を、**iOS PWA として動作する実アプリ**に再実装したものです。擬似GPS（自動歩行シミュレーション）は **実GPS（Geolocation API）のみ** に置き換え、状態はローカル保存 + バックエンド同期の両対応です。

## 構成（docker compose の3サービス）

```
┌────────────┐     /api/*     ┌────────────┐     SQL      ┌────────────┐
│   front    │ ─────────────▶ │  backend   │ ───────────▶ │    db      │
│ nginx +    │  reverse proxy │ Node/Express│              │ PostgreSQL │
│ PWA(静的)  │                │  (pg)       │              │    16      │
└────────────┘                └────────────┘              └────────────┘
   :8080                          :3000(内部)                :5432(内部)
```

| サービス | 技術 | 役割 |
|---|---|---|
| **front** | Vite + React + `vite-plugin-pwa` を nginx で配信 | PWA本体（地図・霧・HUD・統計）。`/api` を backend へプロキシ |
| **backend** | Node 20 + Express + `pg` | デバイスIDベースの匿名状態同期 API |
| **db** | PostgreSQL 16 | 探索状態（訪問点・セル・発見・距離）を永続化 |

- フロントのロジックは全て Node/JS（`frontend/src/`）。nginx は「静的配信 + `/api` プロキシ」のインフラ用途のみです。
- backend が落ちていてもフロントは localStorage だけで完全動作します（同期は自動でスキップ）。

## 前提

- **Docker Desktop（Docker daemon が起動していること）** と Docker Compose v2。
  - ⚠️ 現在 Docker daemon が動いていないとのことなので、下の「起動」を実行する際は **先に Docker Desktop を起動**してください。
- ローカル開発だけなら Node 20+ でも可（Docker不要、下の「Dockerなし開発」参照）。

## 起動（Docker）

```bash
cp .env.example .env          # POSTGRES_PASSWORD などを編集
docker compose up --build     # 初回はイメージをビルド
```

- ブラウザで **http://localhost:8080** を開く。
- 停止: `docker compose down`（DBデータは残る） / 完全削除: `docker compose down -v`。
- ヘルスチェック: `curl http://localhost:8080/api/health` → `{"ok":true,"db":true}`。

> 初回ビルドは frontend で `npm install` + `vite build`（+ sharp によるアイコン生成）を行うため数分かかります。

### GHCR のプレビルドイメージを使う場合（ビルドしない）

`.env` に `FRONT_IMAGE` / `BACKEND_IMAGE`（GitHub Actions が push したタグ）を設定し:

```bash
docker compose pull
docker compose up -d
```

## Dockerなし開発（Node）

2つのターミナルで:

```bash
# backend（DBが必要。DBだけ docker で建てるのが楽: docker compose up -d db）
cd backend && npm install
DATABASE_URL=postgres://fog:fogpass@localhost:5432/fogexplorer npm run dev

# frontend（http://localhost:5173、/api は上の backend にプロキシ）
cd frontend && npm install && npm run dev
```

`localhost` は「安全なコンテキスト」扱いなので、PC のブラウザでも Geolocation / Service Worker が動きます。移動は実GPSのみなので、PCで霧が晴れる様子を試すには **ブラウザ DevTools の位置情報オーバーライド**（Chrome: More tools → Sensors → Location）で座標を渋谷付近（35.66, 139.70）に変えながら動かすと確認できます。

## iOS で PWA としてインストール

1. アプリを **HTTPS** で配信する（重要 — 下記参照）。
2. iPhone の **Safari** でその URL を開く。
3. 共有ボタン →「**ホーム画面に追加**」。
4. ホーム画面のアイコンから起動するとフルスクリーン（standalone）で動作します。初回に位置情報の許可を求められます。

### ⚠️ HTTPS が必須

iOS では `http://localhost` 以外だと **Geolocation API と Service Worker が HTTPS でしか動きません**。実機テストには次のいずれかで HTTPS の URL を用意してください:

- **Cloudflare Tunnel**: `cloudflared tunnel --url http://localhost:8080`（無料・即時HTTPS）
- **ngrok**: `ngrok http 8080`
- 本番: front の前段にリバースプロキシ（Caddy/Traefik/nginx + Let's Encrypt）を置いて TLS 終端。

自己署名証明書は iOS で信頼されにくいため、トンネルか正式証明書を推奨します。

### iOS PWA の制約（仕様として正直に）

- **バックグラウンド位置取得は不可**。iOS の PWA はアプリが前面にある間のみ位置を追跡します（バックグラウンドでJS/SWが停止するため）。ハンドオフ仕様の「バックグラウンド取得が理想」は、真のバックグラウンド追跡が必要なら **ネイティブ（Expo/EAS）** 側の課題になります。
- 追跡は画面を開いている間だけ動く、という前提の実装です。

## アカウント / 状態同期の仕様

- **ゲスト（登録なし）**: 初回に匿名 **デバイスID**（`crypto.randomUUID`、localStorage）を生成し `X-Device-Id` で送信。状態は `device:<id>` をキーに保存。
- **アカウント（メール+パスワード）**: 統計タブの「アカウント」から登録/ログイン。`bcrypt` でハッシュ、**JWT**（`Authorization: Bearer`）で認証。状態は `user:<id>` をキーに保存。ログイン中はデバイスIDより優先。
- **引き継ぎ**: 登録/ログイン時に、現在の進捗とアカウント側の状態をユニオンマージ（セル和集合 / 発見は名前でユニーク / 距離は最大）してから同期。→ ゲストで貯めた探索がアカウントに移行し、複数端末で共有できます。
- 認証エンドポイント: `POST /api/auth/register`・`POST /api/auth/login`（`{token,user}` を返す）・`GET /api/auth/me`。
- `JWT_SECRET` 環境変数でトークンを署名（compose に配線済み。本番は `openssl rand -hex 32` 等で長いランダム値を）。
- パスワードは8文字以上・メール確認は省略（SMTP不要）。公開運用ではレート制限の追加を推奨。

## 固定パラメータ / UI

- 固定（設定UIからは除外）: **解放半径 500m / 霧=ブラー / アクセント=グリーン**。ユーザ変更可能な設定項目はなし。
- マップ画面の操作は **現在地ボタン（◎）のみ**（デモ歩行は廃止し、移動は実GPSのみ）。「霧をリセット」ボタンも廃止。
- アカウントは統計タブの「アカウント」ボタン → **モーダル**でログイン/登録/ログアウト。

## CI / イメージビルド（GitHub Actions）

- ワークフロー: [.github/workflows/docker-build.yml](.github/workflows/docker-build.yml)
- トリガー: `main` への push / `v*` タグ / PR / 手動（`workflow_dispatch`）。
- front・backend を **matrix で並列ビルド**し、`main` push とタグ時に **GHCR**（`ghcr.io/<owner>/<repo>-frontend` / `-backend`）へ push。PR ではビルド検証のみ（push しない）。
- タグ付け: ブランチ名 / semver（`v1.2.3`）/ commit SHA / `latest`（デフォルトブランチ）。
- 追加設定は不要（`GITHUB_TOKEN` を使用）。パッケージを public にするか、pull 時に GHCR ログインするかは GitHub のパッケージ設定で調整してください。

## ディレクトリ

```
.
├── docker-compose.yml          # front / backend / db
├── .env.example
├── .github/workflows/docker-build.yml
├── frontend/                   # Vite + React PWA
│   ├── Dockerfile              # build(node) -> nginx
│   ├── nginx.conf              # 静的配信 + /api プロキシ + SW no-cache
│   ├── scripts/generate-icons.mjs
│   └── src/
│       ├── App.jsx             # UI（HUD/ログ/統計/設定/タブ）
│       ├── lib/mapController.js# 地図・霧マスク・GPS・スポット発見・同期
│       ├── lib/landmarks.js    # スポット定義・ブリップSVG
│       ├── lib/storage.js      # localStorage + デバイスID
│       └── lib/api.js          # backend 同期（失敗時は無視）
├── backend/                    # Express + pg
│   ├── Dockerfile
│   ├── db/schema.sql
│   └── src/{index.js,db.js}
├── README.md                   # 元のデザイン・ハンドオフ仕様
├── Fog Explorer.dc.html        # 参考プロトタイプ（実装対象外）
└── ios-frame.jsx               # プレビュー用ベゼル（実装対象外）
```

## 既知の注意点 / 今後

- `package-lock.json` はコミット済みで、両 Dockerfile は再現性のため `npm ci` を使用。依存を更新したら `npm install` でロックを更新してください。
- 地図タイルは CARTO（利用規約・attribution 必須。地図上に表示済み）。
- 認証なしの匿名同期です。公開運用ではレート制限・認証の追加を検討してください。
