---
title: "Docker Compose"
sidebar:
  order: 3
---

Docker Composeは、TomoriBotとPostgreSQLをコンテナー内で一緒に実行します。これは、[セットアップウィザード](/ja/self-hosting/setup-wizard/) および [手動セットアップ](/ja/self-hosting/manual-setup/) と並ぶ3番目のインストールオプションです。ホストシステムにBunまたはPostgreSQLをインストールせずに、Dockerですべてを実行したい場合に選択します。対話型セットアップウィザードをバイパスし、データベース接続を自動的に構成します。

:::caution[Host tools for updates]
`bun run update --docker`がコード変更をプルするには、ホストBunおよびGitが必要です。データベースのバックアップはアプリケーションコンテナ内で実行されます。Composeを通じて手動バックアップと復元を実行することもできます。[メンテナンスとバックアップ](/ja/self-hosting/maintenance/)を参照してください。
:::

## 1. コードを取得する

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 2. 必要な`.env`の値

サンプルファイルから始めます。

```sh
cp .env.example .env
```

これらの必須変数を`.env`に設定します。

| 変数 | 価値 |
|---|---|
| `DISCORD_TOKEN` | Discordボットトークン (`GuildMembers`、`MessageContent`、および`GuildPresences`特権インテントを有効にします)。|
| `CRYPTO_SECRET` | 保存されたAPIキーの暗号化に使用される32文字の暗号化キー。|
| `POSTGRES_PASSWORD` | データベースのパスワード。他のすべての`POSTGRES_*`値は自動構成されます。|

Dockerを使用して`CRYPTO_SECRET`のランダムな32文字の値を生成し、それを`.env`にコピーします。

```sh
docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"
```

`POSTGRES_PASSWORD`用に別のパスワードを生成します。`.env.optional.example`からオプションのチューニング設定をコピーできます。

:::note[Database connection is automatic]
Compose PostgreSQLサービスは、内部Dockerネットワーク上で開発モード (SSLなし) で実行されます。バンドルされたイメージには`pgvector`と`pg_cron`が含まれているため、ドキュメントメモリ、ベクトル検索、スケジュールされたクリーンアップがすぐに機能します。`.env`には`POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_USER`、または`POSTGRES_DB`を設定しないでください。Composeはそれらを自動的に構成します。
:::

Linuxでは、コンテナーを起動する前に、ホスト上にバインドマウントディレクトリを作成し、所有権をUID 1001に割り当てます。Dockerは、不足しているマウントポイントをrootとして作成します。これにより、ボットコンテナーはバックアップ、ログ、またはアップロードを保存できなくなります。

```sh
mkdir -p backups logs data
sudo chown 1001:1001 backups logs data
```

## 3. ビルドと実行

```sh
docker compose build   # first time, or after code/dependency changes
docker compose up      # bot + database
```

後で開始する場合は、コードや依存関係を変更しない限り、`docker compose up`だけで十分です。ボットがDiscordに接続したら、任意のサーバー チャネルで`/setup`を実行してAIプロバイダー キーを追加します。Discordのセットアップオプションについては、[クイックスタート](/ja/introduction/quickstart/) を参照してください。

`.env`シークレットとローカルHTTPエンドポイントが機能するように、サービス定義で`RUN_ENV=development`ピンを構成します。コンテナーのヘルスチェックは、ボットプロセスが実行されているかどうかを報告します。Discordゲートウェイ接続はテストされません。運用モード (`RUN_ENV=production`) の違い (シークレットマネージャー、ネットワーク制限、メトリック) については、[セキュリティアーキテクチャ](/en/architecture/subsystems/security/) を参照してください。

## 4. オプションのローカルサーバー（Composeプロファイル）

Composeプロファイルを使用してオプションのローカルヘルパー サーバーを実行して、必要なものだけを開始できるようにします。

```sh
# SearXNG (private web search) + Crawl4AI (browser-rendered fetch)
docker compose --profile searxng --profile fetch-crawl4ai up
```

SearXNGを有効にする場合は、`.env`に`SEARXNG_BASE_URL=http://searxng:8080/`を設定してください。それ以外の場合は未設定のままにしてください。`SEARXNG_SECRET`をSearXNGリクエスト署名用の別のランダム値に設定します。

サーバー固有の設定については、[SearXNG](/ja/self-hosting/local-endpoints/setup-searxng/)、[Crawl4AI](/ja/self-hosting/local-endpoints/setup-crawl4ai/)、および [ローカルモニタリング](/ja/self-hosting/local-monitoring/) を参照してください。

## メンテナンス、アップデート、バックアップ

Composeデプロイメントでのバックアップ優先更新には、`bun run update --docker`を使用します。Composeデータベースをバックアップまたは復元するには、[メンテナンスとバックアップ](/ja/self-hosting/maintenance/) を参照してください。新しいバージョンをプルする前に、[安全な移行](/ja/self-hosting/safe-migration/) を確認してください。
