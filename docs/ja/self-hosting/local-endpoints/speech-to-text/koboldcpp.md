---
title: "KoboldCPPの文字起こし"
sidebar:
  order: 3
---

既存の [KoboldCPP](https://github.com/LostRuins/koboldcpp) インスタンスを使用して、TomoriBotで音声添付ファイルと音声メッセージを文字起こしします。

KoboldCPPには、Whisperベースの音声テキスト変換機能が含まれています。TomoriBotは、OpenAI互換のオーディオトランスクリプションエンドポイント (`POST /v1/audio/transcriptions`) を使用してKoboldCPPに接続します。

## セットアップ

Whisper/STTを有効にしてKoboldCPPを起動し、ビルドが以下を公開していることを確認します。

- `POST /v1/audio/transcriptions`
- `GET /v1/models`または`GET /models`

TomoriBotが使用している間は、KoboldCPPを実行したままにしてください。ビルドが`/api/extra/transcribe`または別のカスタム形式のみを公開している場合は、TomoriBotに専用のアダプターが搭載されるまでラッパーを使用してください。

## TomoriBotへの登録

`/providers`を実行し、`新しいカスタムエンドポイントを追加`を選んで、文字起こしのAPI互換性を使用します。

- API互換性：`openai-compatible-transcription`
- `endpoint_url`：使用しているKoboldCPPサーバーのルートURL

接続を保存したら、それを選択し、モデルのドロップダウンからサーバーが文字起こしモデルとして報告するモデル名を追加します。

エンドポイントの登録とモデルのセットアップには`/providers`を使用してください。その後、`/config` > モデル > モデルの切り替えを開き、登録したエンドポイントを選択して有効化します。

## トランスクリプトを使用する

登録後、TomoriBotはバックグラウンドで音声添付ファイルを文字起こしし、テキストをチャットコンテキストに追加します。トランスクリプトをチャットに視覚的に投稿したい場合にのみ、「`/config`」>「エンジン」>「通知」を使用します。
