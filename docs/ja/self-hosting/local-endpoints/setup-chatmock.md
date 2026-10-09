---
title: "セットアップ: ChatMock経由のCodex CLI"
sidebar:
  order: 5
---

[ChatMock](https://github.com/RayBytes/ChatMock) を使用して、ローカルのOpenAI互換ブリッジ経由でTomoriBotをChatGPTアカウントに接続します。

ChatMockは、標準のOpenAIリクエストを受け入れるローカルAPIサーバーを実行し、TomoriBotの`custom`プロバイダーがアカウントを通じてチャット完了をルーティングできるようにします。

## 1. ChatMockを起動する

[ChatMockリポジトリ](https://github.com/RayBytes/ChatMock) の手順に従って、ChatMockをインストールします。

ローカルサーバーを認証して起動します。

```sh
chatmock login
chatmock serve
```

デフォルトでは、ChatMockは`http://127.0.0.1:8000/v1`をリッスンします。

## 2.TomoriBotを設定する

Discordで、TomoriBotの`custom`プロバイダーを次の設定で構成します。

- **エンドポイントURL**: `http://127.0.0.1:8000/v1`
- **モデル名**: ChatMockが予期するモデル識別子 (`gpt-5.4`や`gpt-5.3-codex`など)

裸の`http://127.0.0.1:8000`も機能します。TomoriBotは、`/chat/completions`を追加する前に、`/v1`に正規化します。

ChatMockの次の機能フラグを有効にします。
- **関数呼び出し/ツール**: はい
- **画像の理解**: はい
- **ビデオの理解**: いいえ
- **構造化された出力**: はい

:::note[System prompt handling and port configuration]
Codex CLIではカスタム`system`プロンプトが許可されていないため、TomoriBotは`system`命令を最初の`user`ターンに変換します。`.env`の`CHATMOCK_PORT`をChatMockポート (デフォルトは`8000`) に一致するように設定します。これにより、TomoriBotはエンドポイントを認識し、このプロンプト調整を適用します。
:::
