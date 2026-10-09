---
title: "セットアップ: SearXNG"
sidebar:
  order: 3
---

[SearXNG](https://docs.searxng.org/) を使用して、プライベートの自己ホスト型Web検索をTomoriBotに追加します。

`web_search`ツールは、エンジンフォールバックチェーン (Brave、SearXNG、DuckDuckGo) をクエリします。ローカルのSearXNGインスタンスを実行すると、外部プロバイダーがレート制限に達するか失敗したときに自己ホスト型の検索ソースが提供され、特殊な検索カテゴリ (`science`、`it`、`files`、および`music`) が有効になります。

セットアップパスを選択します。

### オプションA: Docker Compose (TomoriBotがDockerで実行される場合)

リポジトリのDocker ComposeスタックでTomoriBotを実行する場合は、このパスを使用します。次に、`searxng`プロファイルを使用して実行します。

```sh
docker compose --profile searxng up -d
```

このプロファイルを開始する前に、`.env`に`SEARXNG_BASE_URL=http://searxng:8080/`を設定してください。ボットはそのアドレスを使用して`searxng`サービスにアクセスします。プロファイルがオフの場合は、変数を未設定のままにしておきます。

TomoriBotを`bun run dev`とともに直接実行する場合は、代わりに以下のスタンドアロンパスを使用してください。

`.env`の`SEARXNG_SECRET`を、コンテナーの署名キーの別のランダムな値に設定します。

---

### オプションB: スタンドアロンDocker (`bun run dev`実行時)

まず、ボットが接続先を認識できるように、`.env`に`SEARXNG_BASE_URL=http://localhost:8080/`を設定します。

次に、TomoriBotを`bun run dev`で直接実行する代わりに、`bun run launch --searxng`を使用します。これにより、コンテナーのライフサイクルが自動的に処理され、コンテナーが正常になるまで待機してからボットが開始されます。

```sh
bun run launch --searxng
```

コンテナを自分で管理したい場合は、`SEARXNG_BASE_URL=http://localhost:8080/`を`.env`のままにしておきます。最初にリポジトリのイメージを構築して、JSON検索設定をロードし、署名キーを置き換えます。

```sh
docker build -t tomoribot-searxng:latest -f servers/searxng/Dockerfile servers/searxng
```

次に、それを実行します。

パワーシェル:

```powershell
docker run -d --name searxng -p 8080:8080 `
  --tmpfs /etc/searxng `
  tomoribot-searxng:latest
```

Bash (Linux/macOS):

```bash
docker run -d --name searxng -p 8080:8080 \
  --tmpfs /etc/searxng \
  tomoribot-searxng:latest
```

次に、コンテナーが正常になったら、`bun run dev`を実行します (`docker ps`は`(healthy)`を示します)。コンテナー環境に`SEARXNG_SECRET`がないと、イメージは一時的な署名キーを生成します。

---

### オプションC: SearXNGなし

`SEARXNG_BASE_URL`は未設定のままにしておきます。チェーンは`Brave → DuckDuckGo`にフォールバックします。

SearXNGサーバーが構成されていない場合、アセンブルされた`web_search`スキーマはSearXNGのみのカテゴリをアドバタイズしなくなります。Braveが設定されている場合でも、共通カテゴリ (`text`、`image`、`video`、`news`) が表示され、組み込みのDuckDuckGoフォールバックのみが使用可能な場合はテキストのみの検索が表示されます。

---

## 画像結果のチューニング

SearXNG画像結果はHEAD検証され、必要に応じて圧縮され、Discord添付ファイルとして投稿されます。これはBrave画像と同一のUXです。すべての候補URLが検証に失敗した場合、SearXNGはハード失敗ではなく画像リンクのテキストリストを返します。

| 変数 | デフォルト | 説明 |
|---|---|---|
| `SEARXNG_IMAGE_COUNT` | `3` (最大10) | Discordに送信される有効な画像の数。LLMの`count`引数によってオーバーライドされます。|
| `SEARXNG_IMAGE_POOL` | `10` | LLMが`count`を指定しない場合の候補URLプール。`count`が指定されている場合、ホットリンク保護の障害を吸収するために、プールは`count × 3` (上限は30) になります。|
| `WEB_SEARCH_TIMEOUT_MS` | — | エンジンごとのリクエストのタイムアウト。|

*(すべての調整可能パラメータについては、`.env.optional.example`を参照してください。)*
