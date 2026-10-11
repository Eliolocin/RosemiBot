---
title: "セットアップ: slop-guard"
sidebar:
  order: 8
aiGenerated: true
---

ルールベースの文章校正ツールである [slop-guard](https://github.com/eric-tramel/slop-guard) を、[下書きレビュー](/ja/features/chatting-personality/behavior-tweaking/#response-drafting) のルールチェッカーとして実行します。保留された各返答を定型的な執筆パターンについてスコアリングし、レビュアーにレポートを渡します。チェックはルールベースで行われるため、トークンを消費しません。

slop-guard はローカルの stdio プロセスとしてのみ配布されています。`servers/slop-guard/` は固定されたリリース（`0.5.0`）を小さなコンテナにラップし、同じツールを MCP Streamable HTTP 経由で提供します。これが TomoriBot が MCP サーバーに接続する方法です。

## サーバーの起動

### オプションA: Docker Compose（TomoriBot が Docker で実行されている場合）

```sh
docker compose --profile slop-guard up -d
```

コンテナは `slop-guard` として TomoriBot の Docker ネットワークに参加します。ホストポートは公開しません。

### オプションB: スタンドアロン Docker（TomoriBot がローカルマシンで実行されている場合）

`bun run dev` の代わりに校正ツールを付けてボットを起動します：

```sh
bun run launch --slopguard
```

これによりイメージがビルドされ、`127.0.0.1:8765` で `slop-guard` コンテナが起動し、接続を受け入れるまで待機してからウォッチモードでボットが実行されます。コンテナは `Ctrl+C` の後も実行を続けます。終了時は `docker stop slop-guard` で停止してください。`servers/slop-guard/` を変更した後は、古いコンテナを削除（`docker rm -f slop-guard`）して、launch がリビルドされたイメージから新しいコンテナを作成できるようにしてください。

## 登録

1. `/config` > プラグイン > MCPサーバー を開き、`+ MCPを追加` を選択します。
2. `サーバーURL` を `http://slop-guard:8765/mcp`（オプションA）または `http://localhost:8765/mcp`（オプションB）に設定します。`認証トークン` は空のままにします。
3. `サーバータイプ` を `文章校正` に設定します。
4. `/config` > プラグイン > 下書きレビュー を開き、`ルールチェック` で `<サーバー名> / check_slop` を選択します。

`文章校正` は、サーバーのツールが Tomori 自身に渡らないように隔離します。slop-guard にはコンテナ内のファイルパスを読み取る `check_slop_file` もありますが、返答テキストを受け取らないためルールチェッカーには表示されません。

セルフホストの TomoriBot は `RUN_ENV=development` で実行されるため（Compose がこれを固定します）、ローカルアドレスが機能します。`RUN_ENV=production` の場合、TomoriBot はプライベートアドレスやループバックアドレスに解決される MCP URL を拒否します。

## 設定

| 変数 | デフォルト | 目的 |
|---|---|---|
| `SLOP_GUARD_CONFIG` | パッケージ化されたルール | コンテナ内の JSONL ルール設定ファイルへのパス。ファイルをマウントしてここを指定します。 |
| `SLOP_GUARD_PORT` | `8765` | リッスンポート。 |
| `SLOP_GUARD_ALLOWED_HOSTS` | `slop-guard:*,localhost:*,127.0.0.1:*` | サーバーが受け入れる `Host` ヘッダー値。このリストにない場合は `サーバーURL` に指定したホスト名を追加してください。それ以外のホストは HTTP 421 を受け取ります。 |

slop-guard のデフォルトルールは、ドキュメントや記事の生成テキストを対象としています。箇条書きや3項目の並列チェックなど、一部のチェックはカジュアルなロールプレイ返答にも引っかかるため、レポートは助言的なものとなります：その結果がキャラクターにとって重要かどうかはレビュアーが判断します。レビュアーに特定の方法で評価させたい場合は、レビュアープロンプトでレポートについて言及してください。slop-guard の `sg-fit` ツールを使用すると、独自の適切な例や不適切な例に合わせてルール設定を調整できます。

## アップグレード

`servers/slop-guard/Dockerfile` 内のバージョンを変更してリビルドし、下書きレビューを有効にした状態でテストメッセージを送信します。新しいリリースでは、ルールやレビュアーが読み取るレポートの形式が変更される可能性があります。
