---
title: "音声: TTS & STT"
sidebar:
  order: 3
---

TomoriBotは、Discordで話したり聞いたりすることができます。テキスト読み上げ (TTS) で音声応答を送信し、音声テキスト変換 (STT) で音声メッセージを会話コンテキストに書き起こします。

どちらもプロバイダー エンドポイントシステムを使用します。ElevenLabsは最も速いクラウドオプションです。セルフホストエンジンを使用して、独自のハードウェア上でローカル音声モデルを実行することもできます。

## テキスト読み上げ（TTS）
<!-- anchor: text-to-speech -->

### ElevenLabs（クラウド、最も簡単）

1. [ElevenLabs](https://elevenlabs.io/app/settings/api-keys) からAPIキーを取得します。
2. `/providers`を実行し、`新しいプロバイダーを追加`、`ElevenLabs`を選択して、キーを貼り付けます。このフロー:
   - ElevenLabs音声エンドポイントと文字起こしエンドポイントを登録します。
   - 両方のエンドポイントをアクティブ化します。
   - オプションで、すぐに1人のペルソナに音声を割り当てます。
3. `/config` > `ペルソナ` > [音声] で追加のペルソナに音声を割り当てます。[ElevenLabsボイスライブラリ](https://elevenlabs.io/app/voice-library) でボイスを参照し、独自のクローンを作成することもできます。

`/providers`でElevenLabsを選択し、キーを更新する必要がある場合は常に`エンドポイントを編集`を選択します。

注:

- 無料プランでは、既製の音声のみが機能します。[プリメイドボイスリスト](https://elevenlabs-sdk.mintlify.app/voices/premade-voices)を参照してください。
- 音声メッセージを生成するときに文字数がカウントされます。無料枠には月ごとの制限があるため、ElevenLabsダッシュボードを監視してください。
- 音声応答には`/config` > `権限`の`voice_message_enabled`が必要で、アクティブなペルソナには音声が割り当てられている必要があります。
- `/config` > `ペルソナ` > [音声] を変更するには、サーバーでの [サーバーの管理] 権限が必要ですが、所有者はDMで引き続き使用できます。

`/help`で、`機能`を選択し、次に`音声`を選択して、Discordの対話型ウォークスルーを実行します。

### ローカルの音声クローンエンジン（セルフホスト）

セルフホスト型インスタンスでは、ローカルの音声クローンサーバーを実行できます。ワークフロー: サーバーを起動し、`/providers`でその接続とモデルを登録し、`/providers`で選択し、`/config` > `モデル` > TTSパラメーターとボイスでリファレンスサンプルをアップロードし、それを`/config` > `ペルソナ` > ボイスで割り当てます。あらゆるオーディオ形式が受け入れられます (モノラルWAVに自動的に変換されます)。BGMなしの10 ～ 20秒のクリップが最適です。

各エンジンには独自のセットアップガイドがあります。

- [Chatterbox-Turbo/Nano](/ja/self-hosting/local-endpoints/text-to-speech/chatterbox/): `[laugh]`などの感情タグを使用した高速英語音声クローン作成。
- [Qwen3-TTS](/ja/self-hosting/local-endpoints/text-to-speech/qwen3tts/): 多言語 (10言語) に加えて、自然言語のVoiceDesignモード。
- [MOSS-TTS](/ja/self-hosting/local-endpoints/text-to-speech/moss/): 多言語クローンと英語または中国語の音声デザイン。
- [いろどりTTS](/ja/self-hosting/local-endpoints/text-to-speech/irodoritts/): 絵文字を感情の手がかりとして読み取る日本語に特化したエンジン。

ハードウェアのガイダンスと完全なエンジンのリストについては、[Text-to-Speech比較表](/ja/self-hosting/local-endpoints/text-to-speech/) を参照してください。

## 音声認識（STT）
<!-- anchor: speech-to-text -->

文字起こしエンドポイントは、ユーザーの音声添付ファイルを会話コンテキストのテキストに変換します。トランスクリプトをチャットに公開するかどうかは、`/config` > `動作` > 通知動作で制御されます。

### ElevenLabs（クラウド）

`/providers`からElevenLabsを追加すると、音声とともに文字起こしエンドポイントが登録されます。`/providers`を使用して、アクティブな転写エンドポイントを切り替えます。

### ローカルエンジン（セルフホスト）

- [WhisperX](/ja/self-hosting/local-endpoints/speech-to-text/whisperx/): 推奨されるローカルパス。約100の言語、GPUアクセラレーション、複数のモデルサイズ。
- [KoboldCPP](/ja/self-hosting/local-endpoints/speech-to-text/koboldcpp/): ビルドがOpenAI互換の転写エンドポイントを公開している場合に機能します。
- [ささやき.cpp](/ja/self-hosting/local-endpoints/speech-to-text/whispercpp/)。

エンジンの完全なリストについては、[Speech-to-Text](/ja/self-hosting/local-endpoints/speech-to-text/) ハブを参照してください。Discord概要の場合は、`/help`を実行し、`機能`および`文字起こし`を選択します。
