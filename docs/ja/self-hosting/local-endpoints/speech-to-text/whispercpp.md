---
title: "whisper.cppの文字起こし"
sidebar:
  order: 2
---

[whisper.cpp](https://github.com/ggerganov/whisper.cpp) を使用して、TomoriBot向けの高性能かつ軽量の音声認識を実行します。

TomoriBotは、OpenAI互換のオーディオトランスクリプションエンドポイント (`POST /v1/audio/transcriptions`) を介してWhisper.cppに接続します。

## セットアップ

whisper.cppのHTTPサーバーを起動し、OpenAI互換の文字起こしエンドポイントを公開していることを確認します。

- `POST /v1/audio/transcriptions`
- `GET /v1/models`または`GET /models`

TomoriBotが使用している間は、サーバーを実行したままにしてください。エンドポイントURLはサーバーのルート（例: `http://127.0.0.1:8022`）です。

whisper.cppのビルドが異なるエンドポイント形式を公開している場合は、リクエストをTomoriBotが想定するOpenAI互換の形式にマッピングする薄いラッパーをその前に配置してください。

## TomoriBotへの登録

`/providers`を実行し、`新しいカスタムエンドポイントを追加`を選んで、文字起こしのAPI互換性を使用します。

- API互換性：`openai-compatible-transcription`
- `endpoint_url`：使用しているwhisper.cppサーバーのルートURL

接続を保存したら、それを選択し、モデルのドロップダウンからサーバーが文字起こしモデルとして報告するモデル名を追加します。

エンドポイントの登録とモデルのセットアップには`/providers`を使用してください。その後、`/config` > モデル > モデルの切り替えを開き、登録したエンドポイントを選択して有効化します。

## トランスクリプトを使用する

登録後、TomoriBotはバックグラウンドで音声添付ファイルを文字起こしし、テキストをチャットコンテキストに追加します。トランスクリプトをチャットに視覚的に投稿したい場合にのみ、「`/config`」>「エンジン」>「通知」を使用します。
