# Modern DB Admin 仕様書 v4

## 0. Codexへの依頼内容

この仕様書をもとに、phpMyAdminのようにブラウザからデータベースを管理できるWebアプリケーションを新規作成してください。

ただし、phpMyAdminの完全コピーではなく、以下を重視した新しいDB管理ツールとして実装してください。

- MySQL / MariaDB / PostgreSQL に対応する
- React + TypeScript + Tailwind CSS で現代的なUIにする
- ダークモードに対応する
- SQLエディタを使いやすくする
- テーブル閲覧・検索・編集を直感的にする
- アプリ自体のユーザー管理機能を実装する
- DBごとのユーザー権限管理機能を実装する
- DBごとの差異はAdapter層で吸収する
- セキュリティ上危険な操作には必ず確認を入れる

---

# 1. プロジェクト概要

## 1.1 プロジェクト名

仮名：Modern DB Admin

あとで変更できるように、アプリ名は定数化してください。

```ts
// packages/shared/src/constants.ts
export const APP_NAME = "Modern DB Admin";
```

## 1.2 目的

phpMyAdminは便利だが、主にMySQL/MariaDB向けであり、UIが古く、PostgreSQLなどのDBを扱うには別ツールが必要になる。

本プロジェクトでは、ブラウザ上で複数種類のDBを操作できる、現代的なUIのDB管理ツールを作る。

さらに、DB管理ツールとして実用的に使うため、アプリにログインするユーザー管理と、各DBに対するユーザー権限管理機能を必須機能として実装する。

## 1.3 対象ユーザー

- 開発者
- サーバー管理者
- 個人開発者
- チーム開発者
- ローカル環境やVPS上のDBを管理したい人
- phpMyAdminのUIに不満がある人
- PostgreSQLも同じUIで管理したい人
- DBユーザーや権限もGUIで管理したい人

## 1.4 基本方針

- phpMyAdmin風の便利さは維持する
- UIは古くならないように、現代的な管理画面にする
- 操作ミスでDBを壊さないよう、安全確認を強めに入れる
- アプリ内ユーザーごとに操作権限を分けられるようにする
- DBユーザー・DB権限をGUIから確認・変更できるようにする
- DBごとの差異はAdapter層に閉じ込める
- 最初から多機能にしすぎない
- ただし、実用上必須となるユーザー管理・権限管理はMVPに含める

---

# 2. 技術スタック

## 2.1 フロントエンド

| パッケージ                | 用途                   | 選定理由                           |
| ------------------------- | ---------------------- | ---------------------------------- |
| `react` + `react-dom`     | UIフレームワーク       | 標準                               |
| `typescript`              | 型安全                 | 標準                               |
| `vite`                    | ビルドツール           | 高速HMR                            |
| `tailwindcss`             | スタイリング           | ユーティリティファースト           |
| `shadcn/ui`               | UIコンポーネント       | Tailwind統合済み、カスタマイズ性高 |
| `lucide-react`            | アイコン               | shadcn/uiと統合済み                |
| `@tanstack/react-table`   | テーブルUI             | ヘッドレス、高機能                 |
| `@tanstack/react-virtual` | 仮想スクロール         | 大量行を効率的にレンダリング       |
| `@tanstack/react-query`   | サーバー状態管理       | キャッシュ・再取得を自動化         |
| `@monaco-editor/react`    | SQLエディタ            | Monaco EditorのReactラッパー       |
| `react-router-dom` v6     | ルーティング           | 標準                               |
| `zustand`                 | クライアント状態管理   | 軽量、簡潔                         |
| `sonner`                  | Toast通知              | shadcn/ui推奨、軽量                |
| `react-resizable-panels`  | リサイズ可能なパネル   | サイドバー・エディタの分割         |
| `sql-formatter`           | SQL整形                | 複数DB方言に対応                   |
| `papaparse`               | CSVエクスポート        | 軽量・高速                         |
| `date-fns`                | 日時フォーマット       | Tree-shaking対応                   |
| `clsx` + `tailwind-merge` | クラス結合             | shadcn/uiで使用                    |
| `zod`                     | フォームバリデーション | バックエンドと型共有可能           |
| `react-hook-form`         | フォーム管理           | zodと統合可能                      |

> **注意**: `@monaco-editor/react` は Monaco Editor の公式 React ラッパーです。
> `monaco-editor` を直接インストールするとViteビルド設定が複雑になるため、必ずラッパー経由で導入してください。

## 2.2 バックエンド

| パッケージ                                 | 用途                       | 選定理由                                |
| ------------------------------------------ | -------------------------- | --------------------------------------- |
| `fastify` v4                               | HTTPサーバー               | 高速、TypeScript対応                    |
| `@fastify/jwt`                             | JWT認証                    | httpOnly Cookie + JWTで安全なセッション |
| `@fastify/cookie`                          | Cookie処理                 | JWTをhttpOnly Cookieで発行              |
| `@fastify/cors`                            | CORS設定                   | 開発/本番環境別に設定                   |
| `@fastify/helmet`                          | セキュリティヘッダー       | XSS・クリックジャッキング対策           |
| `@fastify/rate-limit`                      | レート制限                 | ログイン試行制限など                    |
| `@fastify/swagger` + `@fastify/swagger-ui` | API仕様書                  | 開発時の確認用                          |
| `typescript`                               | 型安全                     | 標準                                    |
| `zod`                                      | スキーマバリデーション     | フロントと型共有可能                    |
| `mysql2`                                   | MySQL/MariaDB接続          | Promise対応、接続プール                 |
| `pg`                                       | PostgreSQL接続             | 標準ライブラリ                          |
| `better-sqlite3`                           | 内部DB（アプリデータ保存） | 同期API、軽量、サーバー不要             |
| `drizzle-orm`                              | 内部DB ORM                 | TypeScript型安全、マイグレーション      |
| `drizzle-kit`                              | マイグレーション管理       | スキーマからSQL自動生成                 |
| `argon2`                                   | パスワードハッシュ         | bcryptより安全（Argon2id）              |
| `pino`                                     | ロギング                   | Fastify組み込み、高速                   |
| `pino-pretty`                              | ログ整形（開発用）         | 読みやすいログ出力                      |
| `tsx`                                      | TypeScript実行             | 開発時のサーバー起動                    |

> **内部DB選定理由**: アプリユーザー・ロール・接続情報などを保存する内部DBとして `better-sqlite3` + `drizzle-orm` を採用します。
> `lowdb` はシンプルですが型安全性が低く、マイグレーション管理が困難なため不採用。
> `better-sqlite3` は同期APIなのでFastifyのライフサイクルと相性が良く、ファイル1つでデプロイできます。

> **認証方式**: JWTをhttpOnly Cookieに保存する方式を採用します。
> LocalStorageへのJWT保存はXSS脆弱性があるため不採用。
> `@fastify/jwt` + `@fastify/cookie` の組み合わせで安全に実装します。

## 2.3 開発補助

| パッケージ                          | 用途                                     |
| ----------------------------------- | ---------------------------------------- |
| `docker` + `docker-compose`         | 開発環境のMySQL/PostgreSQL起動           |
| `eslint` + `eslint-config-prettier` | Lint                                     |
| `prettier`                          | コードフォーマット                       |
| `pnpm`                              | パッケージマネージャ                     |
| `vitest`                            | ユニットテスト（フロント・バック両対応） |
| `@testing-library/react`            | Reactコンポーネントテスト                |
| `msw` v2                            | APIモック（フロントエンドテスト用）      |
| `supertest`                         | APIエンドポイントテスト                  |

## 2.4 方針

- フロントエンドとバックエンドは分離する
- `packages/shared` に共通型・zodスキーマを置く
- APIの入力値はzodで検証する（shared packageのスキーマを共有）
- DBごとの差異はDatabaseAdapterで吸収する
- アプリ内ユーザー、ロール、権限はバックエンド側で必ず検証する
- フロントエンドだけで権限制御を完結させない
- JWTはhttpOnly Cookieで発行し、LocalStorageには保存しない

---

# 3. 対応DB

## 3.1 対応するDB

対応DBは以下とする。

- MySQL
- MariaDB
- PostgreSQL

## 3.2 DBごとの注意点

### MySQL / MariaDB

- database = schemaのように扱える
- 識別子のクォートはバッククォート
- LIMIT句を使用できる
- プレースホルダは `?`
- ユーザーは `'user'@'host'` 形式で扱う
- 権限は `GRANT`, `REVOKE`, `SHOW GRANTS` を中心に扱う

### PostgreSQL

- databaseとschemaが別概念
- 通常は `public` schemaを使う
- 識別子のクォートはダブルクォート
- LIMIT句を使用できる
- プレースホルダは `$1`, `$2` 形式
- 接続先databaseを切り替えるには再接続が必要
- ユーザーはroleとして扱う
- 権限は `GRANT`, `REVOKE`, role membership, schema/table privilegesを中心に扱う

## 3.3 内部モデルでの扱い

フロントエンドではDB差異を直接意識しすぎないように、以下のように扱う。

- Connection
- AppUser
- AppRole
- AppPermission
- DatabaseUser
- DatabasePrivilege
- Database
- Schema
- Table
- View
- Column
- Index
- Row
- QueryResult

MySQLの場合は、schemaをdatabase名と同一扱いにしてもよい。

---

## 3.4 MySQL/MariaDBとPostgreSQLの重要な設計差分

このプロジェクトでは、MySQL/MariaDBとPostgreSQLを同じUIで扱うが、内部構造や権限モデルは大きく異なる。

そのため、フロントエンドでは共通モデルとして扱い、バックエンドのAdapter層でDBごとの差分を吸収する。

特に以下の違いは必ず実装時に考慮する。

---

### 3.4.1 database / schema / table の違い

#### MySQL / MariaDB

MySQL/MariaDBでは、一般的に `database` がPostgreSQLの `schema` に近い役割を持つ。

基本階層：

```txt
server
  database
    table
    view
```

例：

```txt
mysql_server
  app_db
    users
    posts
```

MySQL/MariaDBでは、以下のようにデフォルトdatabaseを切り替えられる。

```sql
USE app_db;
```

そのため、アプリ上ではMySQL/MariaDBのschemaはdatabase名と同じものとして扱ってよい。

内部モデル例：

```ts
{
  database: "app_db",
  schema: "app_db",
  table: "users"
}
```

#### PostgreSQL

PostgreSQLでは、`database` と `schema` は別概念。

基本階層：

```txt
server
  database
    schema
      table
      view
```

例：

```txt
postgres_server
  app_db
    public
      users
      posts
    auth
      accounts
```

PostgreSQLでは接続先databaseは接続時に決まる。  
MySQLの `USE database` のように、同一接続のまま別databaseへ簡単に切り替える設計ではない。

そのため、PostgreSQLではdatabaseを切り替える場合、原則として接続を作り直す。

内部モデル例：

```ts
{
  database: "app_db",
  schema: "public",
  table: "users"
}
```

#### 実装ルール

- UIではMySQL/MariaDBもPostgreSQLも `database > schema > table` の共通構造で扱う
- MySQL/MariaDBでは `schema = database` として扱う
- PostgreSQLではschemaを必ず明示的に扱う
- PostgreSQLでschema未指定の場合は `public` を初期値にする
- PostgreSQLでは `search_path` に依存しすぎず、可能な限り `"schema"."table"` のように完全修飾する

---

### 3.4.2 search_pathの扱い

PostgreSQLには `search_path` がある。

例：

```sql
SHOW search_path;
```

`search_path` により、以下のSQLで参照されるschemaが変わる。

```sql
SELECT * FROM users;
```

この場合、`users` が `public.users` なのか `auth.users` なのかは `search_path` に依存する。

#### 実装ルール

- アプリ内部で生成するSQLは、PostgreSQLでは原則として `"schema"."table"` 形式にする
- ユーザーがSQLエディタに直接書いたSQLは、そのまま実行してよい
- テーブル閲覧、行編集、削除、権限変更など、アプリが自動生成するSQLでは `search_path` に依存しない
- PostgreSQLのschema一覧をUIに明示する
- SQLエディタ画面では、現在選択中のdatabaseとschemaを表示する

---

### 3.4.3 識別子クォートの違い

#### MySQL / MariaDB

識別子はバッククォートで囲む。

```sql
SELECT `id`, `name`
FROM `app_db`.`users`;
```

#### PostgreSQL

識別子はダブルクォートで囲む。

```sql
SELECT "id", "name"
FROM "public"."users";
```

#### 実装ルール

- テーブル名、カラム名、database名、schema名、role名などの識別子は必ずAdapter側でエスケープする
- Adapter以外で識別子を含むSQLを組み立てない
- 値はプレースホルダで渡す
- 識別子と値を混同しない
- ユーザー入力された識別子をそのままSQL文字列に結合しない

---

### 3.4.4 プレースホルダの違い

#### MySQL / MariaDB

```sql
SELECT *
FROM `users`
WHERE `id` = ?;
```

#### PostgreSQL

```sql
SELECT *
FROM "users"
WHERE "id" = $1;
```

#### 実装ルール

- 値のプレースホルダ生成はAdapterで行う
- 共通Service層では `params: unknown[]` として値を渡す
- Adapter側でMySQL形式またはPostgreSQL形式に変換する
- SQLインジェクション対策として、値を文字列結合しない

---

### 3.4.5 LIMIT / OFFSETの扱い

MySQL/MariaDBとPostgreSQLはどちらも `LIMIT` と `OFFSET` を使える。

例：

```sql
SELECT *
FROM users
LIMIT 50 OFFSET 0;
```

ただし、ORDER BYなしのページング結果は安定しない場合がある。

#### 実装ルール

- ページング時は可能な限り主キーでORDER BYする
- 主キーがある場合は初期ソートに主キーを使う
- 主キーがない場合はORDER BYなしでもよいが、UIに「順序は保証されない」と表示できるとよい
- SELECT結果はデフォルトで最大1000件までに制限する

---

## 3.5 メタデータ取得の違い

DBごとにテーブル一覧、カラム一覧、インデックス一覧、ユーザー一覧の取得方法が異なる。

これらは必ずAdapter内に閉じ込める。

---

### 3.5.1 MySQL / MariaDBのメタデータ取得

MySQL/MariaDBでは主に以下を使う。

```txt
information_schema.SCHEMATA
information_schema.TABLES
information_schema.COLUMNS
information_schema.STATISTICS
information_schema.KEY_COLUMN_USAGE
mysql.user
SHOW DATABASES
SHOW TABLES
SHOW GRANTS
```

#### database一覧

```sql
SELECT SCHEMA_NAME
FROM information_schema.SCHEMATA
ORDER BY SCHEMA_NAME;
```

#### table一覧

```sql
SELECT
  TABLE_SCHEMA,
  TABLE_NAME,
  TABLE_TYPE,
  TABLE_ROWS,
  DATA_LENGTH,
  INDEX_LENGTH,
  TABLE_COMMENT,
  CREATE_TIME,
  UPDATE_TIME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = ?
ORDER BY TABLE_NAME;
```

#### column一覧

```sql
SELECT
  COLUMN_NAME,
  COLUMN_TYPE,
  IS_NULLABLE,
  COLUMN_KEY,
  COLUMN_DEFAULT,
  EXTRA,
  COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = ?
  AND TABLE_NAME = ?
ORDER BY ORDINAL_POSITION;
```

#### index一覧

```sql
SELECT
  INDEX_NAME,
  COLUMN_NAME,
  NON_UNIQUE,
  SEQ_IN_INDEX,
  INDEX_TYPE
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = ?
  AND TABLE_NAME = ?
ORDER BY INDEX_NAME, SEQ_IN_INDEX;
```

#### DBユーザー一覧

MySQL/MariaDBでは `mysql.user` を使う。

```sql
SELECT
  User,
  Host
FROM mysql.user
ORDER BY User, Host;
```

ただし、接続ユーザーに `mysql.user` を参照する権限がない場合がある。  
その場合は、権限不足として分かりやすいエラーを返す。

---

### 3.5.2 PostgreSQLのメタデータ取得

PostgreSQLでは主に以下を使う。

```txt
information_schema.schemata
information_schema.tables
information_schema.columns
information_schema.role_table_grants
pg_catalog.pg_roles
pg_catalog.pg_user
pg_catalog.pg_namespace
pg_catalog.pg_class
pg_catalog.pg_attribute
pg_catalog.pg_index
pg_catalog.pg_indexes
```

#### schema一覧

```sql
SELECT schema_name
FROM information_schema.schemata
WHERE schema_name NOT IN ('information_schema')
  AND schema_name NOT LIKE 'pg_%'
ORDER BY schema_name;
```

#### table一覧

```sql
SELECT
  table_schema,
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema = $1
ORDER BY table_name;
```

#### column一覧

```sql
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = $1
  AND table_name = $2
ORDER BY ordinal_position;
```

#### index一覧

```sql
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = $1
  AND tablename = $2
ORDER BY indexname;
```

#### role一覧

PostgreSQLではユーザーもroleとして扱う。

```sql
SELECT
  rolname,
  rolcanlogin,
  rolsuper,
  rolcreatedb,
  rolcreaterole,
  rolreplication
FROM pg_roles
ORDER BY rolname;
```

---

## 3.6 DBユーザー・roleモデルの違い

---

### 3.6.1 MySQL / MariaDBのユーザー

MySQL/MariaDBでは、ユーザーは `user` と `host` の組み合わせで一意に扱う。

例：

```txt
'app_user'@'localhost'
'app_user'@'%'
'app_user'@'192.168.0.%'
```

同じ `app_user` でもhostが違えば別ユーザーとして扱う。

#### 実装ルール

- MySQL/MariaDBのDBユーザーIDは `username@host` のような内部IDにする
- UIではusernameとhostを別々に表示する
- DBユーザー作成時はhost入力欄を表示する
- hostの初期値は `%` とする
- `root` や管理者ユーザーの削除・権限変更には強い警告を出す

---

### 3.6.2 PostgreSQLのrole

PostgreSQLでは、ユーザーとroleは基本的に同じ仕組みで扱われる。

ログインできるroleが、一般的な意味でのユーザーに近い。

例：

```sql
CREATE ROLE app_user LOGIN PASSWORD 'password';
CREATE ROLE readonly_role;
GRANT readonly_role TO app_user;
```

#### 実装ルール

- PostgreSQLのDBユーザー管理画面ではroleを表示する
- `rolcanlogin = true` のroleは「ログイン可能」と表示する
- role membershipを表示できるようにする
- role membershipの付与・剥奪をサポートする
- `postgres` やsuperuser roleの削除・権限変更には強い警告を出す

---

## 3.7 権限モデルの違い

---

### 3.7.1 MySQL / MariaDBの権限

MySQL/MariaDBでは、権限は主に以下の単位で付与される。

```txt
global: *.*
database: database.*
table: database.table
column: database.table.column
```

例：

```sql
GRANT SELECT ON app_db.* TO 'app_user'@'%';
GRANT SELECT, INSERT ON app_db.users TO 'app_user'@'%';
REVOKE INSERT ON app_db.users FROM 'app_user'@'%';
SHOW GRANTS FOR 'app_user'@'%';
```

#### 代表的な権限

- SELECT
- INSERT
- UPDATE
- DELETE
- CREATE
- DROP
- ALTER
- INDEX
- REFERENCES
- CREATE USER
- GRANT OPTION
- ALL PRIVILEGES

#### 実装ルール

- 権限表示は `SHOW GRANTS FOR 'user'@'host'` を基本にする
- 可能であればGRANT文をパースしてGUI表示する
- パースが難しい場合は、生のGRANT文も表示する
- `GRANT OPTION` は危険権限として扱う
- `ALL PRIVILEGES` は危険権限として扱う

---

### 3.7.2 PostgreSQLの権限

PostgreSQLでは、権限対象が多層的。

主な対象：

```txt
database
schema
table
sequence
function
role membership
```

例：

```sql
GRANT CONNECT ON DATABASE app_db TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT ON TABLE public.users TO app_user;
GRANT USAGE, SELECT ON SEQUENCE public.users_id_seq TO app_user;
GRANT readonly_role TO app_user;
```

PostgreSQLでは、テーブルをSELECTするだけでもschemaへの `USAGE` が必要になる場合がある。

#### 代表的な権限

Database: `CONNECT`, `CREATE`, `TEMPORARY`

Schema: `USAGE`, `CREATE`

Table: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`

Sequence: `USAGE`, `SELECT`, `UPDATE`

Role: role membership, `ADMIN OPTION`

#### 実装ルール

- PostgreSQLではtable権限だけでなくschema権限も表示する
- table権限を付与するUIでは、必要に応じてschema USAGEも付与できるようにする
- serial / identity列を使うINSERTではsequence権限が必要になることがあるため、sequence権限も考慮する
- role membershipを権限管理UIに含める
- `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION`, `BYPASSRLS` は危険権限として扱う

---

### 3.7.3 PUBLIC権限の違い

PostgreSQLには `PUBLIC` という特別なroleがある。

`PUBLIC` に付与された権限は、すべてのroleに適用される。

例：

```sql
GRANT SELECT ON TABLE public.announcements TO PUBLIC;
REVOKE SELECT ON TABLE public.announcements FROM PUBLIC;
```

#### 実装ルール

- PostgreSQLの権限表示では、対象roleに直接付与された権限とPUBLIC由来の権限を区別できるとよい
- PUBLICへのGRANTは危険操作として確認を出す
- PUBLICからのREVOKEも影響範囲が大きいため確認を出す

---

### 3.7.4 権限継承の違い

PostgreSQLではrole membershipにより権限が継承される。

例：

```sql
GRANT readonly_role TO app_user;
```

この場合、`app_user` は `readonly_role` の権限を利用できる場合がある。

#### 実装ルール

- PostgreSQLでは「直接付与された権限」と「role membership由来の権限」を区別して表示できるとよい
- MVPでは、最低限role membership一覧を表示する
- 権限の完全な継承解決が難しい場合は、TODOとして残してよい
- ただし、誤って「権限なし」と断定しない

---

## 3.8 DBユーザー作成・変更SQLの違い

---

### 3.8.1 MySQL / MariaDB

#### ユーザー作成

```sql
CREATE USER 'app_user'@'%' IDENTIFIED BY 'password';
```

#### パスワード変更

```sql
ALTER USER 'app_user'@'%' IDENTIFIED BY 'new_password';
```

#### ユーザー削除

```sql
DROP USER 'app_user'@'%';
```

#### 権限付与

```sql
GRANT SELECT, INSERT ON app_db.users TO 'app_user'@'%';
```

#### 権限剥奪

```sql
REVOKE INSERT ON app_db.users FROM 'app_user'@'%';
```

#### 権限確認

```sql
SHOW GRANTS FOR 'app_user'@'%';
```

---

### 3.8.2 PostgreSQL

#### role作成

```sql
CREATE ROLE app_user LOGIN PASSWORD 'password';
```

#### パスワード変更

```sql
ALTER ROLE app_user WITH PASSWORD 'new_password';
```

#### role削除

```sql
DROP ROLE app_user;
```

#### table権限付与

```sql
GRANT SELECT, INSERT ON TABLE public.users TO app_user;
```

#### table権限剥奪

```sql
REVOKE INSERT ON TABLE public.users FROM app_user;
```

#### schema権限付与

```sql
GRANT USAGE ON SCHEMA public TO app_user;
```

#### role membership付与

```sql
GRANT readonly_role TO app_user;
```

#### role membership剥奪

```sql
REVOKE readonly_role FROM app_user;
```

---

## 3.9 権限管理UIでのDB差分表示

権限管理UIでは、MySQL/MariaDBとPostgreSQLで表示内容を切り替える。

### MySQL / MariaDBの表示項目

- username
- host
- global privileges
- database privileges
- table privileges
- raw SHOW GRANTS
- GRANT OPTIONの有無

### PostgreSQLの表示項目

- role name
- login可否
- superuserかどうか
- createdb
- createrole
- replication
- bypassrls
- database privileges
- schema privileges
- table privileges
- sequence privileges
- role memberships
- PUBLIC由来の権限

---

## 3.10 Adapter Capability

DBごとに対応できる機能が異なる可能性があるため、Adapterはcapabilityを返せるようにする。

例：

```ts
export interface DatabaseCapabilities {
  supportsSchemas: boolean;
  supportsRoles: boolean;
  supportsUserHost: boolean;
  supportsRoleMembership: boolean;
  supportsSequencePrivileges: boolean;
  supportsShowGrants: boolean;
  supportsPublicPrivileges: boolean;
}
```

MySQL/MariaDB例：

```ts
{
  supportsSchemas: false,
  supportsRoles: false,
  supportsUserHost: true,
  supportsRoleMembership: false,
  supportsSequencePrivileges: false,
  supportsShowGrants: true,
  supportsPublicPrivileges: false
}
```

PostgreSQL例：

```ts
{
  supportsSchemas: true,
  supportsRoles: true,
  supportsUserHost: false,
  supportsRoleMembership: true,
  supportsSequencePrivileges: true,
  supportsShowGrants: false,
  supportsPublicPrivileges: true
}
```

#### 実装ルール

- UIはcapabilityを見て表示項目を切り替える
- DBに存在しない概念は表示しない
- DBに存在するがMVP未対応の機能はdisabledにしてTODO扱いにする
- capabilityはDatabaseAdapterから取得できるようにする

---

# 4. MVP範囲

## 4.1 MVPで必ず実装する機能

- アプリの基本レイアウト
- ライトモード / ダークモード
- アプリ内ログイン
- アプリ内ユーザー管理
- アプリ内ロール管理
- アプリ内権限管理
- DB接続情報の登録
- DB接続テスト
- 接続一覧表示
- MySQL接続
- MariaDB接続
- PostgreSQL接続
- データベース一覧表示
- schema一覧表示
- テーブル一覧表示
- テーブル構造表示
- レコード一覧表示
- SQLエディタ
- SQL実行
- SQL実行結果表示
- SQLエラー表示
- SELECT結果のページング
- 危険なSQL実行前の確認
- DBユーザー一覧表示
- DBユーザー作成
- DBユーザー編集
- DBユーザー削除
- DBユーザーの権限表示
- DBユーザーへの権限付与
- DBユーザーからの権限剥奪

## 4.2 MVPでできれば実装する機能

- レコード追加
- レコード編集
- レコード削除
- CSVエクスポート（papaparseを使用）
- SQL実行履歴
- よく使うSQLの保存
- 接続情報の暗号化保存（Node.js crypto + AES-256-GCM）
- DB権限変更履歴
- SQL整形（sql-formatterを使用）

## 4.3 MVPでは実装しない機能

- バックアップ
- リストア
- ER図生成
- ストアドプロシージャ編集
- トリガー編集
- ジョブスケジューラ
- DBマイグレーション管理
- 外部SSO連携
- LDAP連携
- OAuthログイン
- 監査ログの高度な検索

---

# 5. 権限管理の全体方針

本プロジェクトでは、権限管理を2種類に分ける。

## 5.1 アプリ内ユーザー権限

Modern DB Admin自体にログインするユーザーを管理する。

例：

- 管理者
- 開発者
- 閲覧専用ユーザー

この権限は、アプリ内でどの画面・操作を許可するかを決める。

## 5.2 DBユーザー権限

MySQL / MariaDB / PostgreSQL側に存在するDBユーザーやroleを管理する。

例：

- DBユーザー作成
- DBユーザー削除
- パスワード変更
- SELECT権限付与
- INSERT権限付与
- UPDATE権限付与
- DELETE権限付与
- CREATE権限付与
- DROP権限付与
- 権限剥奪
- 現在の権限確認

この権限は、実際のDBサーバー側の権限を変更する。

## 5.3 重要な注意

アプリ内ユーザー権限とDBユーザー権限は別物として扱う。

例：

- アプリ内でAdmin権限を持つユーザーでも、接続先DBの接続ユーザーにGRANT権限がなければDB権限変更はできない
- アプリ内でViewer権限のユーザーは、DB接続ユーザーに強い権限があっても、アプリ側で変更操作を禁止する
- DBユーザー管理画面は、アプリ内で `manage_db_users` 権限を持つユーザーだけが使用できる

---

# 6. アプリ内ユーザー管理仕様

## 6.1 初期管理者

初回起動時、管理者ユーザーが存在しない場合は初期セットアップ画面を表示する。

初期セットアップで入力する内容：

- 管理者ユーザー名
- メールアドレス
- パスワード

初期管理者はすべてのアプリ内権限を持つ。

## 6.2 ログイン

ログイン画面を実装する。

入力項目：

- メールアドレスまたはユーザー名
- パスワード

ログイン成功後、JWTをhttpOnly Cookieとして発行する。

JWTのペイロード例：

```ts
{
  sub: userId,
  username: string,
  permissions: AppPermission[],
  iat: number,
  exp: number   // デフォルト: 24時間
}
```

## 6.3 ユーザー一覧画面

表示項目：

- ユーザー名
- メールアドレス
- ロール
- 有効 / 無効
- 最終ログイン日時
- 作成日時
- 編集ボタン
- 無効化ボタン

## 6.4 ユーザー作成・編集

入力項目：

- ユーザー名
- メールアドレス
- パスワード
- ロール
- 有効 / 無効

パスワードはargon2id（`argon2` ライブラリ）でハッシュ化して保存する。

## 6.5 ロール

初期ロールは以下とする。

### Admin

すべての操作が可能。

### Developer

通常のDB閲覧・SQL実行・レコード編集が可能。  
ただし、アプリユーザー管理とDBユーザー権限管理は不可。

### Viewer

閲覧のみ可能。  
SQL実行はSELECTのみ許可。  
INSERT / UPDATE / DELETE / DROP / ALTER / CREATE / GRANT / REVOKEは禁止。

## 6.6 アプリ内権限一覧

最低限、以下の権限を定義する。

- `manage_app_users`
- `manage_app_roles`
- `manage_connections`
- `view_connections`
- `view_schema`
- `view_table_rows`
- `edit_table_rows`
- `execute_select_sql`
- `execute_mutation_sql`
- `execute_ddl_sql`
- `manage_db_users`
- `manage_db_privileges`
- `export_data`
- `view_audit_logs`

---

# 7. DBユーザー・DB権限管理仕様

## 7.1 目的

DBサーバー上のユーザー・role・権限をGUIから管理できるようにする。

phpMyAdminのように、ユーザーや権限を画面から確認・追加・変更できることを目標にする。

## 7.2 DBユーザー一覧画面

接続ごとにDBユーザー一覧を表示する。

表示項目：

- ユーザー名
- ホスト
- 種別（user / role）
- ログイン可能か
- スーパーユーザー相当か
- 作成権限を持つか
- 権限詳細ボタン
- 編集ボタン
- 削除ボタン

DBによって取得できない項目は `-` を表示する。

## 7.3 DBユーザー作成

入力項目：

- ユーザー名
- ホスト（MySQL / MariaDBのみ）
- パスワード
- ログインを許可するか
- 初期権限
- 対象database
- 対象schema
- 対象table

PostgreSQLでは、内部的にはrole作成として扱う。

## 7.4 DBユーザー編集

編集可能項目：

- パスワード変更
- ログイン可否
- 権限変更
- role membership変更

危険な変更の場合は確認ダイアログを表示する。

## 7.5 DBユーザー削除

削除前に確認ダイアログを表示する。

確認文言例：

```txt
DBユーザーを削除します。

この操作により、対象ユーザーはデータベースへ接続できなくなる可能性があります。
本当に削除しますか？
```

## 7.6 権限表示

DBユーザーごとに現在の権限を表示する。

表示対象：

- グローバル権限
- database権限
- schema権限
- table権限

MySQL / MariaDBでは、可能な範囲で `SHOW GRANTS` の内容をパースして表示する。

PostgreSQLでは、system catalogとinformation_schemaから権限を取得する。

## 7.7 権限付与

GUIから以下の権限を付与できるようにする。

- SELECT
- INSERT
- UPDATE
- DELETE
- CREATE
- ALTER
- DROP
- INDEX
- REFERENCES
- TRIGGER
- EXECUTE

DBによって存在しない権限は非表示またはdisabledにする。

## 7.8 権限剥奪

GUIから付与済み権限を剥奪できるようにする。

剥奪前に確認ダイアログを表示する。

## 7.9 危険な権限

以下のような強い権限を付与する場合は、強い警告を表示する。

- ALL PRIVILEGES
- SUPER相当
- CREATE USER
- GRANT OPTION
- DROP
- ALTER
- PostgreSQLのSUPERUSER
- PostgreSQLのCREATEDB
- PostgreSQLのCREATEROLE
- PostgreSQLのREPLICATION

確認文言例：

```txt
この権限は非常に強力です。

誤って付与すると、DB全体の破壊や情報漏洩につながる可能性があります。
本当に付与しますか？
```

## 7.10 接続ユーザーの権限不足

DBユーザー・権限管理には、接続に使用しているDBユーザー自身に十分な権限が必要。

権限不足の場合は以下のように表示する。

```txt
現在の接続ユーザーには、この操作を行うためのDB権限がありません。
管理者権限を持つDBユーザーで接続してください。
```

---

# 8. 画面仕様

## 8.1 全体レイアウト

画面は以下の構成にする。

- 左：サイドバー（`react-resizable-panels` でリサイズ可能）
- 上：ヘッダー
- 中央：メインコンテンツ
- 必要に応じて右：詳細パネル
- Toast通知：`sonner` を使用、右下に表示

## 8.2 サイドバー

サイドバーには以下を表示する。

- アプリ名
- 接続一覧
- 選択中の接続
- DBツリー
- SQLエディタへのショートカット
- DBユーザー管理へのショートカット
- アプリユーザー管理へのショートカット
- 設定画面へのショートカット

DBツリーの例：

```txt
Local MySQL
  sample_db
    tables
      users
      posts
      comments
    views
      active_users
    users & privileges

PostgreSQL Dev
  app_db
    schemas
      public
        tables
          users
          posts
      auth
        tables
          accounts
    roles & privileges
```

## 8.3 ヘッダー

ヘッダーには以下を表示する。

- 現在の接続名
- 現在のDB名
- 現在のschema名
- ログイン中のアプリユーザー名
- SQLエディタボタン
- 更新ボタン
- テーマ切り替えボタン（shadcn/uiのDropdownMenu使用）
- 設定ボタン
- ログアウトボタン

## 8.4 ログイン画面

表示項目：

- アプリロゴまたはアプリ名
- メールアドレスまたはユーザー名
- パスワード
- ログインボタン
- エラー表示

## 8.5 接続一覧画面

表示項目：

- 接続名
- DB種別
- ホスト
- ポート
- 最終接続日時
- 接続ボタン
- 編集ボタン
- 削除ボタン

操作：

- 新規接続作成
- 接続テスト
- 接続開始
- 接続編集
- 接続削除

削除時は確認ダイアログを出す。

## 8.6 接続作成・編集画面

入力項目：

- 接続名
- DB種別
- ホスト
- ポート
- ユーザー名
- パスワード
- デフォルトDB
- SSLを使用するか
- 読み取り専用モードにするか

読み取り専用モードがONの場合、INSERT / UPDATE / DELETE / DROP / TRUNCATE / GRANT / REVOKEなどを実行できないようにする。

## 8.7 ダッシュボード画面

接続後に表示する。

表示内容：

- DB種別
- バージョン
- 接続ユーザー
- ホスト
- データベース数
- テーブル数
- DBユーザー数
- 現在の接続状態
- 最近実行したSQL
- 最近の権限変更

## 8.8 テーブル一覧画面

表示内容：

- テーブル名
- 種別（table / view）
- 行数
- サイズ
- コメント
- 作成日時
- 更新日時

DBによって取得できない項目は `-` を表示する。

## 8.9 テーブル詳細画面

タブ形式にする。

タブ：

- Browse
- Structure
- Indexes
- SQL
- Info

### Browseタブ

レコード一覧を表示する。

`@tanstack/react-table` + `@tanstack/react-virtual` を組み合わせて使用する。

機能：

- ページング
- 表示件数変更（25 / 50 / 100 / 500、初期値50）
- カラムソート
- 簡易検索
- WHERE条件入力
- 更新
- CSVエクスポート（papaparse使用）
- 行追加
- 行編集
- 行削除

セルの特殊表示：

- NULL値は `NULL` バッジで表示（テキストとは明確に区別）
- 長い文字列は省略表示し、クリックで全文表示（shadcn/uiのDialog使用）
- JSONらしき値は `{}` バッジで表示し、クリックで整形表示

### Structureタブ

カラム一覧を表示する（`@tanstack/react-table` 使用）。

表示項目：

- カラム名
- 型
- NULL許可
- 主キー
- デフォルト値
- auto increment / identity
- コメント

### Indexesタブ

インデックス一覧を表示する。

表示項目：

- インデックス名
- カラム
- uniqueかどうか
- primaryかどうか
- 種別

### SQLタブ

現在のテーブルに対してSQLを実行しやすくする。

初期SQL例：

```sql
SELECT *
FROM table_name
LIMIT 50;
```

### Infoタブ

表示内容：

- テーブル名
- schema
- 推定行数
- サイズ
- 作成日時
- 更新日時
- コメント

---

# 9. SQLエディタ仕様

## 9.1 使用ライブラリ

`@monaco-editor/react` を使用する（Monaco EditorのReactラッパー）。

> **注意**: `monaco-editor` を直接インストールするとViteのビルド設定にWorkerの設定が必要で複雑になる。
> `@monaco-editor/react` はこれを抽象化しており、Viteとの相性も良い。

## 9.2 基本機能

- SQL入力（SQLシンタックスハイライト）
- SQL実行
- `Ctrl + Enter` で実行
- 実行結果表示
- エラー表示
- 実行時間表示
- 取得行数表示
- 複数SQL対応
- SQL整形（`sql-formatter` を使用、MVP任意）
- 接続中のDB・schemaをエディタ上部に表示

## 9.3 実行結果

SQL実行結果はテーブル形式で表示する（`@tanstack/react-table` 使用）。

表示内容：

- カラム名
- 行データ
- 実行時間
- 取得件数
- affected rows
- エラー内容

`react-resizable-panels` でエディタと結果テーブルの高さをリサイズ可能にする。

## 9.4 危険SQLチェック

以下のSQLは危険として扱い、実行前に確認ダイアログを表示する。

- DROP DATABASE
- DROP SCHEMA
- DROP TABLE
- TRUNCATE
- DELETE without WHERE
- UPDATE without WHERE
- ALTER TABLE
- CREATE USER
- DROP USER
- GRANT
- REVOKE

確認ダイアログの例：

```txt
このSQLは危険な操作を含んでいます。

実行するとデータが削除・変更される可能性があります。
本当に実行しますか？

[キャンセル] [実行する]
```

## 9.5 読み取り専用モード

接続設定で読み取り専用モードがONの場合、以下のSQLは実行不可。

- INSERT
- UPDATE
- DELETE
- DROP
- TRUNCATE
- ALTER
- CREATE
- CREATE USER
- DROP USER
- GRANT
- REVOKE

エラー表示例：

```txt
この接続は読み取り専用モードです。変更系SQLは実行できません。
```

## 9.6 アプリ内権限との連動

SQL実行前に、ログイン中のアプリユーザーの権限を確認する。

例：

- `execute_select_sql` のみ持つユーザーはSELECTのみ実行可能
- `execute_mutation_sql` を持つユーザーはINSERT / UPDATE / DELETEが実行可能
- `execute_ddl_sql` を持つユーザーはCREATE / ALTER / DROPが実行可能
- `manage_db_privileges` を持つユーザーのみGRANT / REVOKEが実行可能

---

# 10. レコード操作仕様

## 10.1 行追加

- Add Rowボタンから行追加モーダルを開く
- カラムごとに入力欄を表示する
- NULL許可カラムはNULL指定できる
- デフォルト値を使う項目は未入力にできる
- 保存前に確認する
- `edit_table_rows` 権限がないユーザーには表示しない

## 10.2 行編集

- 行のEditボタンから編集モーダルを開く
- 主キーをもとに対象行を更新する
- 主キーがないテーブルは、MVPでは編集不可にする
- 保存前に変更差分を表示する
- `edit_table_rows` 権限がないユーザーには表示しない

## 10.3 行削除

- 行のDeleteボタンから削除確認を表示する
- 主キーをもとに対象行を削除する
- 主キーがないテーブルは、MVPでは削除不可にする
- `edit_table_rows` 権限がないユーザーには表示しない

確認例：

```txt
この行を削除しますか？
この操作は元に戻せません。
```

---

# 11. API仕様

## 11.1 認証

### POST /api/auth/setup

初回管理者を作成する。管理者作成後は再実行不可。

### POST /api/auth/login

ログインする。成功時にJWTをhttpOnly Cookieで発行する。

Request:

```json
{
  "login": "admin@example.com",
  "password": "password"
}
```

### POST /api/auth/logout

ログアウトする。Cookieを無効化する。

### GET /api/auth/me

現在ログイン中のユーザー情報を取得する。

---

## 11.2 アプリユーザー管理

### GET /api/app-users

アプリユーザー一覧を取得する。

### POST /api/app-users

アプリユーザーを作成する。

### PUT /api/app-users/:userId

アプリユーザーを更新する。

### DELETE /api/app-users/:userId

アプリユーザーを削除または無効化する。

---

## 11.3 アプリロール管理

### GET /api/app-roles

ロール一覧を取得する。

### POST /api/app-roles

ロールを作成する。

### PUT /api/app-roles/:roleId

ロールを更新する。

### DELETE /api/app-roles/:roleId

ロールを削除する。

---

## 11.4 接続管理

### GET /api/connections

接続一覧を取得する。

### POST /api/connections

接続情報を作成する。

Request:

```json
{
  "name": "Local MySQL",
  "type": "mysql",
  "host": "localhost",
  "port": 3306,
  "username": "root",
  "password": "password",
  "defaultDatabase": "sample",
  "ssl": false,
  "readOnly": false
}
```

### PUT /api/connections/:connectionId

接続情報を更新する。

### DELETE /api/connections/:connectionId

接続情報を削除する。

### POST /api/connections/:connectionId/test

接続テストを行う。

Response:

```json
{
  "ok": true,
  "message": "Connection successful"
}
```

---

## 11.5 DB情報取得

### GET /api/connections/:connectionId/server-info

サーバー情報を取得する。

### GET /api/connections/:connectionId/databases

データベース一覧を取得する。

### GET /api/connections/:connectionId/databases/:database/schemas

schema一覧を取得する。

MySQLの場合はdatabase名をschemaとして返してもよい。

### GET /api/connections/:connectionId/databases/:database/schemas/:schema/tables

テーブル一覧を取得する。

### GET /api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/columns

カラム一覧を取得する。

### GET /api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/indexes

インデックス一覧を取得する。

---

## 11.6 レコード取得

### GET /api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/rows

Query parameters:

- `page`
- `pageSize`
- `orderBy`
- `orderDirection`
- `where`

Response:

```json
{
  "columns": [
    { "name": "id", "type": "int" },
    { "name": "name", "type": "varchar" }
  ],
  "rows": [{ "id": 1, "name": "Alice" }],
  "page": 1,
  "pageSize": 50,
  "hasNextPage": false
}
```

---

## 11.7 レコード操作

### POST /api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/rows

行を追加する。

### PUT /api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/rows

行を更新する。

### DELETE /api/connections/:connectionId/databases/:database/schemas/:schema/tables/:table/rows

行を削除する。

---

## 11.8 SQL実行

### POST /api/connections/:connectionId/query

Request:

```json
{
  "database": "sample",
  "schema": "public",
  "sql": "SELECT * FROM users LIMIT 50;"
}
```

Response:

```json
{
  "results": [
    {
      "columns": [{ "name": "id", "type": "int" }],
      "rows": [{ "id": 1 }],
      "rowCount": 1,
      "affectedRows": 0,
      "executionTimeMs": 12
    }
  ]
}
```

---

## 11.9 DBユーザー・権限管理

### GET /api/connections/:connectionId/db-users

DBユーザー一覧を取得する。

### POST /api/connections/:connectionId/db-users

DBユーザーを作成する。

### PUT /api/connections/:connectionId/db-users/:dbUserId

DBユーザーを更新する。

### DELETE /api/connections/:connectionId/db-users/:dbUserId

DBユーザーを削除する。

### GET /api/connections/:connectionId/db-users/:dbUserId/privileges

DBユーザーの権限一覧を取得する。

### POST /api/connections/:connectionId/db-users/:dbUserId/privileges

DBユーザーに権限を付与する。

Request:

```json
{
  "database": "sample",
  "schema": "public",
  "table": "users",
  "privileges": ["SELECT", "INSERT"]
}
```

### DELETE /api/connections/:connectionId/db-users/:dbUserId/privileges

DBユーザーから権限を剥奪する。

Request:

```json
{
  "database": "sample",
  "schema": "public",
  "table": "users",
  "privileges": ["INSERT"]
}
```

---

# 12. DatabaseAdapter設計

DBごとの差異はAdapterで吸収する。

## 12.1 Interface

```ts
export interface DatabaseAdapter {
  getCapabilities(): DatabaseCapabilities;

  testConnection(config: ConnectionConfig): Promise<TestConnectionResult>;

  getServerInfo(config: ConnectionConfig): Promise<ServerInfo>;

  listDatabases(config: ConnectionConfig): Promise<DatabaseInfo[]>;

  listSchemas(config: ConnectionConfig, database: string): Promise<SchemaInfo[]>;

  listTables(config: ConnectionConfig, database: string, schema: string): Promise<TableInfo[]>;

  getColumns(
    config: ConnectionConfig,
    database: string,
    schema: string,
    table: string,
  ): Promise<ColumnInfo[]>;

  getIndexes(
    config: ConnectionConfig,
    database: string,
    schema: string,
    table: string,
  ): Promise<IndexInfo[]>;

  selectRows(config: ConnectionConfig, params: SelectRowsParams): Promise<QueryResult>;

  insertRow(config: ConnectionConfig, params: InsertRowParams): Promise<MutationResult>;

  updateRow(config: ConnectionConfig, params: UpdateRowParams): Promise<MutationResult>;

  deleteRow(config: ConnectionConfig, params: DeleteRowParams): Promise<MutationResult>;

  executeSql(config: ConnectionConfig, params: ExecuteSqlParams): Promise<QueryExecutionResult>;

  listDatabaseUsers(config: ConnectionConfig): Promise<DatabaseUser[]>;

  createDatabaseUser(
    config: ConnectionConfig,
    params: CreateDatabaseUserParams,
  ): Promise<MutationResult>;

  updateDatabaseUser(
    config: ConnectionConfig,
    params: UpdateDatabaseUserParams,
  ): Promise<MutationResult>;

  deleteDatabaseUser(
    config: ConnectionConfig,
    params: DeleteDatabaseUserParams,
  ): Promise<MutationResult>;

  listDatabasePrivileges(
    config: ConnectionConfig,
    params: ListDatabasePrivilegesParams,
  ): Promise<DatabasePrivilege[]>;

  grantPrivileges(config: ConnectionConfig, params: GrantPrivilegesParams): Promise<MutationResult>;

  revokePrivileges(
    config: ConnectionConfig,
    params: RevokePrivilegesParams,
  ): Promise<MutationResult>;
}
```

## 12.2 Adapter実装

作成するAdapter：

- MySqlAdapter（MySQL / MariaDB両対応）
- PostgreSqlAdapter

MariaDBはMySqlAdapterを利用する。

## 12.3 識別子エスケープ

テーブル名やカラム名は必ずAdapter側でエスケープする。

例：

- MySQL: `` `users` ``
- PostgreSQL: `"users"`

ユーザー入力されたテーブル名を直接SQLに結合しない。

## 12.4 DBユーザー名の扱い

DBユーザー名やrole名も必ずAdapter側で安全に扱う。

MySQL / MariaDBでは、ユーザー名とホスト名を分ける。

例：

```txt
username: app_user
host: %
```

PostgreSQLではrole名として扱う。

---

## 12.5 Adapterごとの実装責務

DatabaseAdapterは、単にSQLを実行するだけでなく、MySQL/MariaDBとPostgreSQLの設計差分を吸収する責務を持つ。

### MySqlAdapterの責務

- `database = schema` として扱う
- 識別子をバッククォートでエスケープする
- 値のプレースホルダに `?` を使う
- ユーザーを `username` と `host` の組み合わせで扱う
- `SHOW GRANTS` を使って権限を取得する
- `CREATE USER 'user'@'host'` 形式でユーザーを作る
- `GRANT ... ON database.table TO 'user'@'host'` 形式で権限を付与する
- `REVOKE ... ON database.table FROM 'user'@'host'` 形式で権限を剥奪する

### PostgreSqlAdapterの責務

- `database > schema > table` を明確に分けて扱う
- 識別子をダブルクォートでエスケープする
- 値のプレースホルダに `$1`, `$2` 形式を使う
- PostgreSQLのユーザーをroleとして扱う
- `pg_roles` からrole一覧を取得する
- role membershipを取得・変更する
- schema privilegesを取得・変更する
- table privilegesを取得・変更する
- sequence privilegesを必要に応じて扱う
- `PUBLIC` 由来の権限を考慮する
- アプリが生成するSQLでは、可能な限り `"schema"."table"` の完全修飾名を使う

### 共通Service層でやってはいけないこと

- DB種別ごとのSQLを直接書かない
- 識別子のクォートを行わない
- `user@host` やrole membershipなどのDB固有概念を直接処理しない
- MySQL前提のdatabase/schemaモデルでPostgreSQLを扱わない
- PostgreSQL前提のroleモデルでMySQL/MariaDBを扱わない

---

# 13. 型定義

## 13.1 ConnectionConfig

```ts
export type DatabaseType = "mysql" | "mariadb" | "postgresql";

export interface ConnectionConfig {
  id: string;
  name: string;
  type: DatabaseType;
  host: string;
  port: number;
  username: string;
  passwordEncrypted: string;
  defaultDatabase?: string;
  ssl: boolean;
  readOnly: boolean;
  createdAt: string;
  updatedAt: string;
}
```

## 13.2 AppUser

```ts
export interface AppUser {
  id: string;
  username: string;
  email: string;
  roleIds: string[];
  enabled: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

## 13.3 AppRole

```ts
export interface AppRole {
  id: string;
  name: string;
  description?: string;
  permissions: AppPermission[];
  createdAt: string;
  updatedAt: string;
}
```

## 13.4 AppPermission

```ts
export type AppPermission =
  | "manage_app_users"
  | "manage_app_roles"
  | "manage_connections"
  | "view_connections"
  | "view_schema"
  | "view_table_rows"
  | "edit_table_rows"
  | "execute_select_sql"
  | "execute_mutation_sql"
  | "execute_ddl_sql"
  | "manage_db_users"
  | "manage_db_privileges"
  | "export_data"
  | "view_audit_logs";
```

## 13.5 DatabaseUser

```ts
export interface DatabaseUser {
  id: string;
  username: string;
  host?: string;
  type: "user" | "role";
  canLogin?: boolean;
  isSuperuser?: boolean;
  canCreateDatabase?: boolean;
  canCreateUser?: boolean;
  raw?: unknown;
}
```

## 13.6 DatabasePrivilege

```ts
export interface DatabasePrivilege {
  id: string;
  userId: string;
  database?: string;
  schema?: string;
  table?: string;
  privilege: string;
  grantable?: boolean;
  source?: string;
}
```

## 13.7 ColumnInfo

```ts
export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
  autoIncrement: boolean;
  comment?: string;
}
```

## 13.8 TableInfo

```ts
export interface TableInfo {
  name: string;
  schema: string;
  type: "table" | "view";
  estimatedRows?: number;
  sizeBytes?: number;
  comment?: string;
  createdAt?: string;
  updatedAt?: string;
}
```

## 13.9 QueryResult

```ts
export interface QueryResult {
  columns: QueryColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  affectedRows?: number;
  executionTimeMs: number;
}
```

---

# 14. セキュリティ仕様

## 14.1 基本方針

DB管理ツールなので、便利さよりも安全性を優先する場面を作る。

特に、ユーザー管理・権限管理は危険度が高いため、権限チェック・確認ダイアログ・操作ログを必ず実装する。

## 14.2 アプリユーザー

- パスワードは `argon2` ライブラリの argon2id でハッシュ化する（bcryptより安全）
- 平文保存は禁止
- ログイン失敗回数を記録する（`@fastify/rate-limit` で制御）
- 一定回数失敗した場合は一時的にロックする
- 無効化されたユーザーはログイン不可
- 初期管理者作成後、セットアップAPIは再実行できないようにする

## 14.3 接続情報

- パスワードは平文保存しない
- Node.js 組み込みの `crypto` モジュールで AES-256-GCM 暗号化する
- 暗号化キーは環境変数 `ENCRYPTION_KEY` から読む
- ログにパスワードを出さない
- APIレスポンスにパスワードを含めない

## 14.4 SQL実行

- SQL実行にはタイムアウトを設定する（デフォルト30秒）
- SELECT結果は初期状態では最大1000行まで
- 危険SQLは確認必須
- 読み取り専用モードでは変更系SQLを拒否する
- アプリ内権限に応じて実行可能SQLを制限する

## 14.5 DBユーザー・権限管理

- `manage_db_users` 権限がないユーザーはDBユーザー管理不可
- `manage_db_privileges` 権限がないユーザーはGRANT / REVOKE不可
- 強い権限を付与する場合は必ず確認する
- DBユーザー削除は必ず確認する
- 権限変更は操作ログに残す
- 権限不足のDB接続ユーザーで実行した場合、分かりやすいエラーを返す

## 14.6 API

- APIの入力値はzodで検証する
- すべてのAPIで認証チェックを行う（Fastifyの `preHandler` フックで一括処理）
- 権限が必要なAPIでは必ずバックエンドで権限チェックする
- 不正なconnectionIdは404
- DB接続エラーは安全なメッセージに変換する
- stack traceをフロントに返さない
- CORSは開発環境のみ緩くする（`@fastify/cors` + 環境変数制御）
- `@fastify/helmet` でセキュリティヘッダーを付与する

## 14.7 ローカル・セルフホスト利用想定

MVPではローカルまたは信頼できるネットワークでの利用を想定する。

ただし、ユーザー管理と権限管理は必須とする。

---

# 15. UIデザイン仕様

## 15.1 テーマ

ライトモードとダークモードに対応する。

テーマ切り替えはヘッダー右上に配置する。

テーマ状態はZustandで管理し、`localStorage` に永続化する。

## 15.2 色

Tailwind CSSの標準色を基本に、CSS変数でテーマ対応する（shadcn/uiの設計に準拠）。

管理する変数：

- 背景
- カード
- ボーダー
- テキスト
- サブテキスト
- アクセント
- エラー（red-500系）
- 警告（yellow-500系）
- 成功（green-500系）

## 15.3 UIの雰囲気

- 角丸を使う（`rounded-lg` 基調）
- 余白を広めにする
- カード型UIを使う（`shadcn/ui Card` コンポーネント）
- アイコンを使う（`lucide-react`）
- テーブルは見やすくする
- 古い管理画面のような密集感を避ける
- ただし、DB管理画面なので情報量も確保する

## 15.4 テーブルUI

テーブル表示は非常に重要。`@tanstack/react-table` を使用する。

必要仕様：

- 横スクロール対応
- ヘッダー固定（sticky header）
- カラム名固定表示
- NULL値は専用バッジ表示（薄グレー背景の `NULL` ラベル）
- 長い文字列は省略表示（`max-w` + `truncate`）
- セルクリックで全文表示（shadcn/ui Dialog）
- JSONらしき値は整形表示（shadcn/ui Dialog内でコードブロック）

大量行を扱う場合は `@tanstack/react-virtual` で仮想スクロールを実装する。

## 15.5 権限管理UI

権限管理画面は、危険操作を扱うため分かりやすくする。

必要仕様：

- 付与済み権限を一覧表示する
- 追加する権限をチェックボックスで選択できる
- 対象database / schema / tableを明確に表示する
- 危険な権限は赤や警告アイコンで表示する（`lucide-react` の `AlertTriangle`）
- 権限変更前に差分を表示する
- GRANT / REVOKEの実行内容を確認できるようにする

## 15.6 通知

Toast通知は `sonner` を使用する（`shadcn/ui` の推奨ライブラリ）。

表示するケース：

- ログイン成功 / 失敗
- 接続成功 / 失敗
- SQL実行成功 / 失敗
- 保存成功
- 削除成功
- 権限付与成功 / 剥奪成功
- 危険操作の警告

---

# 16. エラー処理

## 16.1 フロントエンド

- APIエラーはToast（sonner）で表示する
- 詳細エラーは折りたたみ表示にする（shadcn/ui Collapsible）
- 通信中はローディング表示を出す（shadcn/ui Skeleton）
- 空データ時はEmpty Stateを出す
- 権限がない操作ボタンは非表示またはdisabledにする
- disabledにする場合は理由をTooltipで表示する（shadcn/ui Tooltip）

## 16.2 バックエンド

- DBエラーをそのまま返さない
- エラーコードと安全なメッセージを返す
- ログには詳細を出してよいが、パスワードはマスクする
- 権限不足は403で返す
- 認証切れは401で返す

エラー形式：

```json
{
  "error": {
    "code": "DB_CONNECTION_FAILED",
    "message": "データベースに接続できませんでした。接続情報を確認してください。"
  }
}
```

---

# 17. 環境変数

## 17.1 バックエンド

```env
# サーバー設定
PORT=3001
NODE_ENV=development

# JWT
JWT_SECRET=your-jwt-secret-here-min-32-chars
JWT_EXPIRES_IN=86400  # 24時間（秒）

# 暗号化（接続情報パスワード用）
ENCRYPTION_KEY=your-encryption-key-here-32-chars

# 内部DB（SQLite）
DATABASE_PATH=./data/app.db

# CORS（開発時のみ）
CORS_ORIGIN=http://localhost:5173
```

## 17.2 フロントエンド

```env
# バックエンドAPIのURL
VITE_API_BASE_URL=http://localhost:3001
```

---

# 18. ディレクトリ構成

```txt
modern-db-admin/
  apps/
    frontend/
      src/
        app/
        components/
          layout/
          ui/
          auth/
          users/
          permissions/
          database/
          editor/
          table/
        pages/
          LoginPage.tsx
          SetupPage.tsx
          ConnectionsPage.tsx
          ConnectionFormPage.tsx
          DashboardPage.tsx
          TablePage.tsx
          SqlEditorPage.tsx
          AppUsersPage.tsx
          AppRolesPage.tsx
          DbUsersPage.tsx
          DbPrivilegesPage.tsx
          SettingsPage.tsx
        hooks/
        lib/
        stores/
        styles/
        main.tsx
    backend/
      src/
        adapters/
          DatabaseAdapter.ts
          MySqlAdapter.ts
          PostgreSqlAdapter.ts
        routes/
          auth.routes.ts
          app-users.routes.ts
          app-roles.routes.ts
          connections.routes.ts
          metadata.routes.ts
          rows.routes.ts
          query.routes.ts
          db-users.routes.ts
          db-privileges.routes.ts
        services/
          AuthService.ts
          AppUserService.ts
          AppRoleService.ts
          PermissionService.ts
          ConnectionService.ts
          QuerySafetyService.ts
          EncryptionService.ts
          AuditLogService.ts
        db/
          schema.ts          # drizzle-orm スキーマ定義
          migrations/        # drizzle-kit 生成マイグレーション
          index.ts           # better-sqlite3 + drizzle 初期化
        schemas/             # zodバリデーションスキーマ
        utils/
        server.ts
  packages/
    shared/
      src/
        types/
        api/
        constants.ts
  docker/
  docker-compose.yml
  package.json
  pnpm-workspace.yaml
  README.md
```

---

# 19. Docker Compose

開発用に以下を起動できるようにする。

- frontend
- backend
- mysql
- postgres

MySQLとPostgreSQLにはテスト用DBを作成する。

また、権限管理機能のテスト用に、複数のDBユーザーを初期作成する。

```yaml
# docker-compose.yml の主要サービス例
services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: rootpassword
      MYSQL_DATABASE: sample_db
    ports:
      - "3306:3306"
    volumes:
      - ./docker/mysql/init.sql:/docker-entrypoint-initdb.d/init.sql

  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: rootpassword
      POSTGRES_DB: sample_db
    ports:
      - "5432:5432"
    volumes:
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
```

---

# 20. 実装順

## Phase 1: 初期構築

- pnpm workspace作成
- frontend作成（Vite + React + TypeScript + Tailwind）
- backend作成（Fastify + TypeScript）
- shared package作成
- drizzle-orm + better-sqlite3 セットアップ
- ESLint / Prettier設定
- Docker Compose作成

完了条件：

- frontendが起動する
- backendが起動する
- `/api/health` が返る

## Phase 2: 認証・アプリユーザー基盤

- 初期セットアップ画面
- 初期管理者作成（argon2idハッシュ化）
- ログイン（httpOnly Cookie JWT発行）
- ログアウト
- `/api/auth/me`
- 権限チェックの基盤（Fastify preHandlerフック）

完了条件：

- 初期管理者を作成できる
- ログインできる
- 認証なしでは管理画面に入れない

## Phase 3: UI基盤

- レイアウト作成（react-resizable-panels）
- サイドバー作成
- ヘッダー作成
- ダークモード実装（Zustand + CSS変数）
- Toast実装（sonner）
- 基本ルーティング作成
- 権限に応じたメニュー表示

完了条件：

- 主要ページに遷移できる
- ライト/ダークを切り替えられる
- 権限がないメニューは表示されない

## Phase 4: アプリユーザー・ロール管理

- アプリユーザー一覧（TanStack Table）
- アプリユーザー作成・編集・無効化
- ロール一覧・作成・編集
- 権限割り当て

完了条件：

- Adminがアプリユーザーを管理できる
- Viewerはユーザー管理画面に入れない

## Phase 5: 接続管理

- 接続一覧
- 接続作成・編集・削除
- 接続テスト
- パスワード暗号化（AES-256-GCM）

完了条件：

- MySQL/MariaDB/PostgreSQLの接続情報を登録できる
- 接続テストができる

## Phase 6: DBメタデータ取得

- DatabaseAdapter作成
- MySqlAdapter作成
- PostgreSqlAdapter作成
- database / schema / table / column / index一覧取得

完了条件：

- サイドバーにDBツリーが表示される
- テーブル構造を表示できる

## Phase 7: レコード閲覧

- rows API作成
- TanStack Table + TanStack Virtual でテーブルUI
- ページング・ソート・WHERE条件

完了条件：

- テーブルの中身をブラウザから確認できる

## Phase 8: SQLエディタ

- `@monaco-editor/react` 導入
- SQL実行API
- 実行結果表示（TanStack Table）
- react-resizable-panels でエディタ/結果を分割
- 危険SQLチェック・権限チェック

完了条件：

- SQLを入力して実行できる
- SELECT結果が表で見える
- 危険SQLで確認が出る

## Phase 9: DBユーザー・権限管理

- DBユーザー一覧・作成・編集・削除
- 権限一覧・付与・剥奪
- 危険権限の警告

完了条件：

- MySQL/MariaDB/PostgreSQLのユーザーと権限を管理できる

## Phase 10: レコード編集

- 行追加・編集・削除
- 確認ダイアログ

完了条件：

- 主キーありテーブルでCRUDできる

## Phase 11: 仕上げ

- CSVエクスポート（papaparse）
- SQL履歴
- SQL整形（sql-formatter）
- 権限変更履歴
- README整備
- エラー表示改善
- UI調整

---

# 21. 受け入れ条件

## 21.1 基本

- `pnpm install` で依存関係を入れられる
- `pnpm dev` で開発環境を起動できる
- READMEに起動方法が書かれている
- Docker ComposeでMySQL/PostgreSQLを起動できる

## 21.2 認証・アプリユーザー

- 初回起動時に管理者ユーザーを作成できる
- ログインできる
- ログアウトできる
- Adminはアプリユーザーを作成・編集・無効化できる
- Adminはロールと権限を管理できる
- Viewerは管理系画面にアクセスできない

## 21.3 DB接続

- MySQLに接続できる
- MariaDBに接続できる
- PostgreSQLに接続できる
- 接続失敗時にわかりやすいエラーが出る

## 21.4 UI

- ダークモードに対応している
- サイドバーでDB構造を確認できる
- テーブルデータを閲覧できる
- SQLエディタが使える
- 権限に応じてボタンやメニュー表示が切り替わる

## 21.5 DBユーザー・権限管理

- DBユーザー一覧を表示できる
- DBユーザーを作成・編集・削除できる
- DBユーザーの権限を表示・付与・剥奪できる
- 危険な権限付与時に警告が表示される
- 権限不足時に分かりやすいエラーが表示される

## 21.6 安全性

- 危険SQL実行前に確認が出る
- 読み取り専用モードで変更系SQLが拒否される
- アプリ内権限によって操作が制限される
- パスワードがAPIレスポンスに含まれない
- パスワードがログに出ない
- ユーザー管理・権限管理APIは認証・権限チェック必須

---

# 22. 今後の拡張案

- ER図表示
- DBバックアップ・リストア
- テーブル作成UI / カラム追加UI / インデックス作成UI
- 外部キー表示
- クエリお気に入り
- AIによるSQL生成
- 実行計画の表示（EXPLAIN）
- 接続ごとの色分け
- 監査ログの高度な検索
- WebSocketでクエリ進行状況表示
- SSO / OAuthログイン

---

# 23. 実装時の注意

- 最初からphpMyAdminの全機能を再現しない
- MVPを小さく作る
- ただし、アプリユーザー管理とDBユーザー権限管理は必須
- DB Adapter層を必ず作る
- UIコンポーネントを使い回せるようにする
- SQL文字列の組み立てはAdapterに閉じ込める
- 識別子のエスケープを忘れない
- 値はプレースホルダで渡す
- 破壊的操作は必ず確認する
- PostgreSQLのdatabase/schema/role差異を軽視しない
- MySQL/MariaDBのuser@host差異を軽視しない
- 大量データを一気に取得しない（`@tanstack/react-virtual` で仮想スクロール）
- エラーに機密情報を含めない
- 権限チェックをフロントエンドだけに任せない
- バックエンドで必ず認証・認可を行う
- JWTはhttpOnly Cookieで管理し、LocalStorageに保存しない

---

# 24. 最初に作るべき最小機能

まずは以下を最優先で作る。

```txt
1. 初期管理者を作成する
2. ログインできるようにする
3. アプリ内ユーザー・ロール・権限の基盤を作る
4. 接続情報を登録する
5. MySQL/MariaDB/PostgreSQLに接続する
6. データベース一覧を表示する
7. schema一覧を表示する
8. テーブル一覧を表示する
9. テーブル構造を表示する
10. SELECTでレコードを表示する
11. SQLエディタからSQLを実行する
12. DBユーザー一覧を表示する
13. DBユーザーの権限を表示する
14. DBユーザーに権限を付与・剥奪できるようにする
```

この段階で、DB管理ツールとして最低限使える状態になる。

---

# 25. Codexへの追加ルール

- 不明点がある場合は、勝手に大規模な機能追加をしない
- 仕様にない高度機能はTODOコメントにする
- セキュリティに関わる部分は簡略化しすぎない
- まずMVPを完成させる
- アプリユーザー管理とDBユーザー権限管理は必須機能として扱う
- UIは見た目だけでなく、実際に操作しやすいことを優先する
- コードはTypeScriptで型安全に書く
- `any` の多用は禁止
- APIレスポンス型はshared packageに置く
- フロントとバックで型を共有する
- エラー処理を省略しない
- 権限チェックを省略しない
- READMEに起動方法と開発方法を書く
- `@monaco-editor/react` を使い、Monaco Editorを直接インストールしない
- Toast通知は `sonner` を使い、独自実装しない
- パスワードハッシュは `argon2` を使い、`bcrypt` は使わない
- 内部DBは `better-sqlite3` + `drizzle-orm` を使い、`lowdb` は使わない
- JWTはhttpOnly Cookieで発行し、LocalStorageには保存しない
