---
title: "手動セットアップ"
sidebar:
  order: 2
aiGenerated: false
---

:::note
Docker Composeを使用したいユーザーはこのウィザードをスキップし、コンテナ化されたインストールパスについては[Docker Compose](/ja/self-hosting/docker-compose/)を参照してください。
:::

これは、ガイド付きウィザードを使用したくない技術的なユーザー向けの手動インストール手順です。
手厚いガイドラインが必要な場合は、代わりに[セットアップウィザード](/ja/self-hosting/setup-wizard/)を使用してください。
ウィザードが`.env`を作成し、安全な`CRYPTO_SECRET`を生成し、PostgreSQLを設定し、インストールを実行してくれます。

## 前提条件

- [Bun](https://bun.sh/)
- ネイティブにインストールされたPostgreSQL、またはDockerコンテナで実行されているPostgreSQL（ステップ2を参照）

PostgreSQLスキーマ、`pgcrypto`、シード、および移行は、ボットの起動時に自動的に初期化されます。

## 1. インストール

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
bun install --frozen-lockfile
```

## 2. 設定

例から環境ファイルを作成し、必要な値を入力します。

```sh
cp .env.example .env
```

必須：

- `DISCORD_TOKEN`: Discordボットトークン (`GuildMembers`、`MessageContent`、および`GuildPresences`特権インテントを有効にします)。
- `CRYPTO_SECRET`: 32文字の暗号化キー (保存されているAPIキーの暗号化に使用されます)。
- PostgreSQL接続: `POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB`。

データベースのバックアップとは別に、暗号化シークレットの保護されたコピーを保管してください。新しいバックアップには `.env` が含まれません。ローテーションには、`CRYPTO_SECRET_V1`、`CRYPTO_SECRET_V2`、またはそれ以降の正の整数バージョンを使用し、オプションで `CRYPTO_SECRET_CURRENT` を選択できます。`CRYPTO_SECRET` は V1 のままです。起動コマンドとメンテナンスコマンドは同じソースを読み込みます：開発環境ではローカルの環境変数の値、本番環境ではマウントされたJSONまたはAWS Secrets Managerです。シークレットを置き換える前に、[暗号化キーのローテーション](/ja/self-hosting/maintenance/#rotating-encryption-keys) を参照してください。

JSONシークレットソースでは、マスターキーは文字列である必要があります。`CRYPTO_SECRET_CURRENT` は、利用可能なバージョンを指定する `"2"` などの文字列、または `2` などの正の安全な整数値を受け入れます。

:::note[No native PostgreSQL?]
コンテナー内でデータベースのみを実行し、そのデータベースに`POSTGRES_*`値を指定します。

```sh
docker run -d --name tomori-db \
  -e POSTGRES_USER=tomori -e POSTGRES_PASSWORD=yourpassword -e POSTGRES_DB=tomori \
  -p 5432:5432 pgvector/pgvector:pg16
```

次に、`POSTGRES_HOST=localhost`、`POSTGRES_PORT=5432`、および上記のユーザー/パスワード/データベースを設定します。`pgvector/pgvector`イメージには、RAG拡張機能がプリインストールされて出荷されます。ドキュメント/RAGメモリが必要ない場合は、`postgres:16`と交換してください。これにより、Dockerのデータベースのみが実行され、ボットは引き続きホストBunで実行されます。完全にコンテナ化されたボットとデータベースの場合は、代わりに [Docker Compose](/ja/self-hosting/docker-compose/) を使用してください。
:::

オプションのチューニングは`.env.optional.example`にあります。カスタマイズしたい値 (制限、タイムアウト、機能の切り替え、ローカルサーバー URLなど) をコピーします。

カスタム表現のアップロードは、デフォルトで`data/custom-expressions/`の下のローカルファイルにアップロードされます。そのディレクトリを永続ストレージに保存します。`EXPRESSION_STORAGE_BACKEND`は、`local`、`gcs`、または`s3`を受け入れます。クラウドバックエンドには、`EXPRESSION_STORAGE_BUCKET`と対応するSDK認証情報が必要です。S3は、`AWS_REGION` (デフォルト`us-east-1`) とオプションの`S3_ENDPOINT`も使用します。GCSはアプリケーションのデフォルトの資格情報を使用します。式は独自のバケット設定を使用します。アバターのストレージ設定では式バケットは選択されません。オブジェクトはSDKを通じて読み取り可能であり、バイトとして添付されるため、公開されているメディアURLは必要ありません。既存の参照を復元するときに、バックエンド、バケット、およびオブジェクトのキーを保持します。

`MAX_CUSTOM_EXPRESSIONS_PER_SERVER` はサーバーあたりのカスタム表現を制限します（デフォルト `20`、最小 `1`）。リンクとアップロードされたファイルは、すべてのペルソナ間で制限を共有します。ネイティブの絵文字とスタンプは除外されます。変更後はボットを再起動してください。制限を引き下げても既存の表現は保持され、編集や削除は可能ですが、数が制限を下回るまで新規追加はブロックされます。

## 3. 実行

```sh
bun run dev
```

`TomoriBot up and running!`と表示されたら、Discordに移動してサーバーで`/setup`を実行し、AIプロバイダーを接続してボットを初期化します。
このコマンドはガイド付きのチェックリストパネルを開き、`セットアップを完了`（セットアップを完了）を押すまで何も書き込まれません。
手順については[`/setup`コマンド](/ja/self-hosting/setup-wizard/#setup-コマンド)を、Discord側の操作については[クイックスタート](/ja/introduction/quickstart/)を参照してください。

オプションのローカルサーバー（SearXNG、Crawl4AI、ローカルTTS/STT）をボットと一緒に起動したい場合は、`bun run dev`の代わりに`bun run launch`を使用します。

```sh
bun run launch --searxng --crawl4ai
bun run launch --help        # see all flags
```

## オプションの追加機能（手動での「フルインストール」）
<!-- anchor: optional-extras-the-manual-full-install -->

[セットアップウィザード](/ja/self-hosting/setup-wizard/)のフルインストールパスでは、基本インストールの上に4つの軽量な追加機能がレイヤー化されます。
ボットの実行に必須のものはありませんが、それぞれが特定の機能をアンロックします。
手動でインストールする場合は、必要なものを追加してください。

### `pgvector`：ドキュメント/RAGメモリー

RAG（ドキュメントのアップロードとチャンネル間のリコール）は、エンベディングを`vector`カラムに保存するため、[pgvector](https://github.com/pgvector/pgvector)拡張機能が必要です。
お使いのPostgreSQLのメジャーバージョンに合わせてインストールします。

```sh
# Debian/Ubuntu, e.g. for PostgreSQL 16
sudo apt-get install -y postgresql-16-pgvector
```

次に、データベースで一度だけ有効にします。`.env`の`POSTGRES_*`の値を使って`psql`で接続します（`POSTGRES_PASSWORD`の入力を求められます）。

:::note[Windows]
ネイティブのWindows版PostgreSQL向けにビルド済みのpgvectorパッケージは存在しません。
インストールするには、Visual StudioのC++と`nmake`を使い、お使いのPostgreSQLのバージョンに合わせてソースからビルドする必要があります（pgvectorの[Windows向け手順](https://github.com/pgvector/pgvector#windows)を参照）。
Windowsでのより簡単な方法は、上記の[設定](#2-設定)に示した`pgvector/pgvector`コンテナでデータベースを実行することです。
このイメージには拡張機能がプレインストールされています。
:::

```sh
# Native / host psql (substitute your own POSTGRES_USER and POSTGRES_DB):
psql -h localhost -p 5432 -U tomori -d tomodb

# Or, if the database runs in the Docker container from step 2:
docker exec -it tomori-db psql -U tomori -d tomori
```

接続したら、次を実行します。

```sql
CREATE EXTENSION vector;
```

pgvectorがなくてもボットは動作しますが、RAG機能は完全に利用できなくなります。
この拡張機能は、バックアップを復元する前にターゲットデータベースにも必要です。
詳細については[安全な移行](/ja/self-hosting/safe-migration/)を参照してください。

### `pg_cron`：スケジュールされたクリーンアップジョブ

`pg_cron`は、オプションの定期的なデータベースメンテナンス（クールダウン/リマインダー行のクリーンアップ）を強力にサポートします。このリポジトリのDocker Composeでは既に設定されています。

:::caution[リマインダーやトリガーには必須ではありません]
`pg_cron`は古い行をクリーンアップするだけであり、純粋なハウスキーピング目的です。リマインダーの配信やランダムなトリガーはアプリ自体で実行されるため、これらの機能は`pg_cron`の有無にかかわらず機能します。
:::

自己管理のPostgreSQLの場合は、アクティブな設定ファイルを見つけます。

```sql
SHOW config_file;
```

`postgresql.conf`で拡張機能を有効にします。`shared_preload_libraries`に他のライブラリがすでにリストされている場合は末尾に追加します。

```ini
shared_preload_libraries = 'pg_cron'   # e.g. 'pg_stat_statements,pg_cron'
cron.database_name = 'your_dbname'
```

PostgreSQLを再起動した後、以下を実行します。

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

### トークナイザーアセット：モデルを意識したロジットバイアス

ロジットバイアス（絵文字/単語の繰り返しペナルティ）にはローカルのトークナイザーアセットが必要です。

```sh
bun run setup:tokenizers
```

一部のファミリー（例: Gemma）はゲートで保護されており、ライセンスに同意した後に[HuggingFaceトークン](https://huggingface.co/settings/tokens)が必要です。

```sh
# Windows (PowerShell)
$env:HF_TOKEN="hf_xxx"; bun run setup:tokenizers

# macOS/Linux
HF_TOKEN=hf_xxx bun run setup:tokenizers
```

この手順を行わないとロジットバイアスは暗黙のうちに無効化されますが、その他のすべては正常に動作します。

安全な `fetch_url` フォールバックと DuckDuckGo の `web_search` フォールバックはどちらもプロセス内で実行されるため、どちらも追加のインストールは不要です。

## メンテナンス、更新とバックアップ

インストールが完了したら、ホスト側のスクリプト（`bun run update`、`bun run backup`、`bun run restore-backup`、`bun run nuke-db`、`bun run rotate-keys`など）、および更新とバックアップの手順はすべて[メンテナンスとバックアップ](/ja/self-hosting/maintenance/)ページにあります。
新しいバージョンをプルする前に、まずは[安全な移行](/ja/self-hosting/safe-migration/)から始めてください。
