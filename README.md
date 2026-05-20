# Modern DB Admin

複数DBをブラウザから管理するための、管理ツールです。

## 構成

- `apps/frontend`: React + TypeScript + Vite + Tailwind のフロントエンド
- `apps/backend`: Fastify + TypeScript のバックエンド
- `packages/shared`: 共通定数・型
- `docker-compose.yml`: 本番用 Docker Compose
- `docker-compose.dev.yml`: 開発用 MySQL / PostgreSQL

## 本番環境セットアップ

### 最短手順

1. DNS で `admin.example.com` のような公開ドメインをこのサーバーへ向ける
2. このリポジトリをサーバーへ配置する
3. Node.js 20 系と `pnpm@10.11.0` をインストールする
4. `pnpm docker:init` を実行して `.env` を作る
5. `.env` の `MODERN_DB_ADMIN_DOMAIN` と `MODERN_DB_ADMIN_ACME_EMAIL` を本番値へ直す
6. `pnpm docker:up` を実行する
7. `https://<あなたのドメイン>` を開いて初期管理者を作成する

これで以下がまとめて起動します。

- backend: Node.js + SQLite
- web: Caddy による静的配信 + `/api` リバースプロキシ
- HTTPS: Caddy が自動で証明書を取得して終端

補足:

- 80/443 番ポートが開いている必要があります
- `MODERN_DB_ADMIN_DOMAIN` は必ず実在する公開ドメインにしてください
- 保存データは Docker volume `modern_db_admin_data` に永続化されます

### Docker で使うコマンド

- 本番初期化: `pnpm docker:init`
- 本番起動: `pnpm docker:up`
- 本番停止: `pnpm docker:down`
- 本番ログ: `pnpm docker:logs`
- 開発DB起動: `pnpm docker:dev:up`
- 開発DB停止: `pnpm docker:dev:down`

### 前提

- Node.js 20 系を使用する
- `pnpm` は `10.11.0` を使用する
- フロントエンドは静的配信、バックエンドは Node.js プロセスとして常駐させる
- ブラウザからは必ず HTTPS でアクセスする
- `docker-compose.dev.yml` は開発用サンプルDB用

### 推奨構成

- フロントエンド: `apps/frontend/dist` を Nginx などで静的配信
- バックエンド: `node apps/backend/dist/server.js` を `systemd` などで常駐化
- 内部データ: `SQLITE_DB_PATH` に指定した SQLite ファイルを永続ボリュームに配置
- 接続先DB: 管理対象の MySQL / PostgreSQL 本体は外部サーバーまたはマネージドDBを使用

Modern DB Admin 自身のユーザー、ロール、監査ログ、保存済み接続情報は SQLite に保存されます。  
MySQL / PostgreSQL は「このアプリが管理する対象」であり、このアプリの内部ストレージではありません。

Docker 構成ファイル:

- `docker-compose.yml`: 本番用 compose
- `docker-compose.dev.yml`: 開発用 sample DB compose
- `docker/backend.Dockerfile`: backend 用イメージ
- `docker/web.Dockerfile`: frontend + Caddy 用イメージ
- `docker/Caddyfile`: HTTPS / 静的配信 / `/api` プロキシ設定
- `.env.example`: 本番環境変数の見本

### 1. アプリをビルドする

```bash
npm install -g pnpm@10.11.0
pnpm install --frozen-lockfile
pnpm build
```

ビルド後の配置先:

- フロントエンド成果物: `apps/frontend/dist`
- バックエンド成果物: `apps/backend/dist/server.js`

### 2. バックエンド環境変数を決める

本番では少なくとも次を設定します。

```env
NODE_ENV=production
PORT=3001
JWT_SECRET=32文字以上の十分に長いランダム文字列
ENCRYPTION_KEY=32文字以上の十分に長いランダム文字列
SQLITE_DB_PATH=/opt/modern-db-admin/data/app.sqlite
CORS_ORIGIN=https://admin.example.com
```

Docker 構成では `.env` に以下を置けば十分です。

```env
MODERN_DB_ADMIN_DOMAIN=admin.example.com
MODERN_DB_ADMIN_ACME_EMAIL=admin@example.com
JWT_SECRET=32文字以上の十分に長いランダム文字列
ENCRYPTION_KEY=32文字以上の十分に長いランダム文字列
```

注意:

- `JWT_SECRET`、`ENCRYPTION_KEY`、`CORS_ORIGIN` は本番で未設定のままだとバックエンドが起動しません
- `ENCRYPTION_KEY` を変更すると、保存済み接続パスワードを復号できなくなります
- `SQLITE_DB_PATH` は本番では相対パスではなく絶対パスを推奨します
- `CORS_ORIGIN` はフロントエンド公開URLと完全一致させます

### 3. バックエンド用の永続ディレクトリを作る

```bash
sudo mkdir -p /opt/modern-db-admin/data
sudo chown -R <backend-user>:<backend-user> /opt/modern-db-admin
```

SQLite は `app.sqlite` に加えて `-wal`、`-shm` ファイルも作るため、ディレクトリ単位で永続化してください。

### 4. バックエンドを常駐化する

`systemd` 例:

```ini
[Unit]
Description=Modern DB Admin Backend
After=network.target

[Service]
Type=simple
User=<backend-user>
WorkingDirectory=/opt/modern-db-admin/app
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=JWT_SECRET=<strong-random-secret>
Environment=ENCRYPTION_KEY=<strong-random-encryption-key>
Environment=SQLITE_DB_PATH=/opt/modern-db-admin/data/app.sqlite
Environment=CORS_ORIGIN=https://admin.example.com
ExecStart=/usr/bin/node /opt/modern-db-admin/app/apps/backend/dist/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

反映:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now modern-db-admin.service
sudo systemctl status modern-db-admin.service
```

Docker を使うなら、この手順は不要です。`pnpm docker:up` が backend の常駐化までまとめて行います。

### 5. フロントエンドを配置する

同一オリジンで `/api` をリバースプロキシする構成を推奨します。  
この場合、`VITE_API_BASE_URL` は未設定でも動作します。

例:

```bash
sudo mkdir -p /var/www/modern-db-admin
sudo cp -R apps/frontend/dist/* /var/www/modern-db-admin/
```

フロントエンドとAPIを別オリジンにする場合のみ、フロントエンドビルド時に `VITE_API_BASE_URL` を公開APIのURLへ設定してください。

例:

```bash
VITE_API_BASE_URL=https://api.example.com pnpm --filter @modern-db-admin/frontend build
```

Docker を使う場合、この手順は不要です。frontend のビルドと配信は `docker/web.Dockerfile` と Caddy が担当します。

### 6. リバースプロキシを設定する

Nginx 例:

```nginx
server {
    listen 80;
    server_name admin.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name admin.example.com;

    ssl_certificate /etc/letsencrypt/live/admin.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/admin.example.com/privkey.pem;

    root /var/www/modern-db-admin;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`BrowserRouter` を使っているため、`/app/...` への直接アクセスでも `index.html` にフォールバックする設定が必要です。

Docker を使う場合、この役割は `docker/Caddyfile` が担当します。

### 7. 初期セットアップと疎通確認

1. バックエンドのヘルスチェックを確認する: `curl http://127.0.0.1:3001/api/health`
2. ブラウザで `https://admin.example.com` を開く
3. 初回セットアップ画面で管理者アカウントを作成する
4. ログイン後に管理対象の MySQL / PostgreSQL 接続を登録する
5. 接続一覧から `Test` を実行して疎通確認する

### 8. 運用時の注意

- バックアップ対象は SQLite ディレクトリと `ENCRYPTION_KEY`、`JWT_SECRET` です
- `ENCRYPTION_KEY` を失うと保存済み接続情報の復旧ができません
- 更新時は `pnpm install --frozen-lockfile && pnpm build` を再実行し、フロントエンド配信物を差し替えた後にバックエンドを再起動します
- HTTPS を使わないと本番では `Secure` クッキーが機能せずログインできません
- Docker 構成を更新する場合は `pnpm docker:up` を再実行すれば再ビルド込みで反映できます

## 開発環境セットアップ

前提:

- Node.js 20 系
- `pnpm@10.11.0`

Ubuntu などで `pnpm` が未導入なら、例えば以下で入れてください。

```bash
npm install -g pnpm@10.11.0
```

手順:

1. `pnpm install`
2. `pnpm docker:dev:up`
3. `pnpm dev`

起動後:

- フロントエンド: `http://localhost:5173`
- バックエンド: `http://localhost:3001`
- 初回アクセス時はセットアップ画面で管理者アカウントを作成

## 権限管理の場所

- `DBユーザー・権限`: MySQL / PostgreSQL 側に存在する実ユーザー・role と、その `GRANT` / `REVOKE` を管理します。接続一覧、左の接続ツリー、またはテーブル画面から対象接続ごとに開きます。
- `管理画面ユーザー`: Modern DB Admin 自体にログインする内部ユーザーと内部ロールを管理します。

この 2 つは別物です。DB の権限を変えたい場合は、必ず対象接続の `DBユーザー・権限` 画面を使ってください。

## 開発用DBを新しい接続として追加する

`pnpm docker:dev:up` を実行すると、開発用の MySQL / PostgreSQL がローカルに立ち上がります。  
Modern DB Admin から接続する手順は次の通りです。

1. `http://localhost:5173` を開く
2. 初回なら管理者アカウントを作成してログインする
3. サイドバーまたは画面遷移から接続一覧を開く
4. `新規接続` を押す
5. 接続情報を入力して `接続を作成` を押す
6. 保存後に `Test` または `この接続をテスト` を押して疎通確認する

### PostgreSQL の入力例

- 接続名: `Local PostgreSQL`
- DB種別: `PostgreSQL`
- ホスト: `127.0.0.1`
- ポート: `5432`
- 接続ユーザー: `postgres`
- パスワード: `rootpassword`
- 初期 database: `sample_db`
- SSL を使用: `OFF`
- 読み取り専用にする: 用途に応じて設定

### MySQL の入力例

- 接続名: `Local MySQL`
- DB種別: `MySQL`
- ホスト: `127.0.0.1`
- ポート: `3307`
- 接続ユーザー: `root`
- パスワード: `rootpassword`
- 初期 database: `sample_db`
- SSL を使用: `OFF`
- 読み取り専用にする: 用途に応じて設定

### 補足

- `初期 database` は任意です。空でも保存できます。
- 接続先ホストはブラウザではなくバックエンドから見える値です。ローカル起動なら `127.0.0.1` で問題ありません。
- ローカルに別の MySQL / MariaDB が常駐している場合の衝突を避けるため、開発用 MySQL は `3307` に公開しています。
- 開発用DBの初期データは `docker/mysql/init.sql` と `docker/postgres/init.sql` で投入されます。

## 主要コマンド

- `pnpm dev`
- `pnpm reset:setup`
- `pnpm build`
- `pnpm lint`
- `pnpm test`
- `pnpm format`

## 開発環境変数

バックエンド:

- `NODE_ENV=development`
- `PORT=3001`
- `JWT_SECRET=change-me`
- `ENCRYPTION_KEY=0123456789abcdef0123456789abcdef`
- `SQLITE_DB_PATH=./data/app.sqlite`
- `CORS_ORIGIN=http://localhost:5173`

フロントエンド:

- `VITE_API_BASE_URL=http://localhost:3001`
