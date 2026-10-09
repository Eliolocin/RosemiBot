---
title: "TTSエンジンの比較"
sidebar:
  order: 1
aiGenerated: false
---

TomoriBotは複数のローカルText-to-Speechサーバーに対応しており、それぞれ異なる言語、ハードウェア条件、遅延要件に適しています。

このページでは、同一のテスト環境で同じボイスクローン用参照音声を用いて記録した、実測のベンチマーク結果、合成にかかった時間、音声比較クリップを掲載しています。

## 多言語・英語のボイスクローン

### ベンチマークプロンプト

- 標準プロンプト（Chatterbox Standard/Turbo/Nano、MOSS-TTS、CosyVoice 3、VoxCPM2、Qwen3-TTSで使用）:
  > *"Pain and pleasure are two sides of the same coin. Go on now... flip it. Either way, I'll let you feel all of me."*
- Fish Audio S2 Proプロンプト（角括弧の表現タグ付きでテスト）:
  > *"Pain and pleasure are two sides of the same coin. [laughs] Go on now... flip it. [whispers] Either way, I'll let you feel all of me."*

### パフォーマンスと音声の比較

計測結果は、全体の生成時間（リクエストから音声完成までの実時間の合計、秒）と、生成時間を音声の長さで割ったリアルタイムファクター（RTF）の両方を示します。

- RTF < 1.0（太字）: エンジンがリアルタイムより速く音声を生成します（例えば`0.50× RTF`は10秒のクリップを5秒で生成します）。ライブの音声通話に追従できるのはこれらのエンジンだけですが、TomoriBotは今のところそれを実装していません。
- RTF > 1.0: 生成に発話音声そのものよりも長い時間がかかります。TomoriBotは各音声メッセージを完成した1つのファイルとして送信するため、RTFが高いことは単に待ち時間が長くなることを意味します。

| エンジン | Windowsネイティブ<sup>(1)</sup><br/>（RTX 4070 Ti SUPER） | Linux / WSL2 | macOS<br/>（Apple Silicon） | 音声サンプル |
|---|---|---|---|---|
| [Fish Audio S2 Pro](/ja/self-hosting/local-endpoints/text-to-speech/fishs2/) | ~8〜10分<sup>(2)</sup><br/>*(~65× RTF)* | 未計測 | 未計測 | <audio controls preload="none" src="/audio/tts/fish-s2-pro.wav"></audio> |
| [Chatterbox（Turbo、既定）](/ja/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 約5.0秒 *(8.7秒のクリップ)*<br/>0.57× RTF | 未計測 | 未計測 | <audio controls preload="none" src="/audio/tts/chatterbox-turbo.wav"></audio> |
| [Chatterbox（Nano）](/ja/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 約3.0秒 *(8.0秒のクリップ)*<br/>0.38× RTF | 未計測 | 未計測 | <audio controls preload="none" src="/audio/tts/chatterbox-nano.wav"></audio> |
| [Chatterbox（Standard）](/ja/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 約6.0秒 *(7.8秒のクリップ)*<br/>0.77× RTF | 未計測 | 未計測 | <audio controls preload="none" src="/audio/tts/chatterbox.wav"></audio> |
| [MOSS-TTS](/ja/self-hosting/local-endpoints/text-to-speech/moss/) | 約12.0秒 *(8.8秒のクリップ)*<br/>1.36× RTF | 未計測 | 未計測 | <audio controls preload="none" src="/audio/tts/moss-tts.wav"></audio> |
| [CosyVoice 3](/ja/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | 約6.0秒 *(13.9秒のクリップ)*<br/>0.43× RTF | 未計測 | 未計測 | <audio controls preload="none" src="/audio/tts/cosy-voice-3.wav"></audio> |
| [VoxCPM2](/ja/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | 約8.0秒 *(7.4秒のクリップ)*<br/>1.09× RTF | 未計測 | 未計測 | <audio controls preload="none" src="/audio/tts/voxcpm2.wav"></audio> |
| [Qwen3-TTS](/ja/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | 約10.0秒 *(9.2秒のクリップ)*<br/>1.09× RTF | 未計測 | 未計測 | <audio controls preload="none" src="/audio/tts/qwen3-tts.wav"></audio> |

- <sup>(1)</sup> テスト環境: NVIDIA GeForce RTX 4070 Ti SUPER（16 GB GDDR6X、Ada Lovelace）を搭載したWindows 11（ネイティブ実行）で、26.6秒・24 kHzモノラルの参照音声サンプルと、それに対応する逐語的な文字起こしを使用。
- <sup>(2)</sup> Fish Audio S2 Pro: Windowsでの実行は未コンパイルのeagerモードで動作し（~65× RTF）、これは1トークンあたり76層の評価にわたるCUDAカーネル起動の遅延によるものです。この処理のディスパッチストールを避けるには、OpenAI Tritonコンパイラの融合（`torch.compile`）が使えるLinuxまたはWSL2での実行を推奨します。

---

## 日本語のボイスクローン

### 日本語のベンチマークプロンプト

> *「そんな顔して……ほんとは私にやられたいんでしょ？ざぁこざぁこ～♡」*

### 日本語のパフォーマンスと音声の比較

| エンジン | Windowsネイティブ<sup>(1)</sup><br/>（RTX 4070 Ti SUPER） | Linux / WSL2 | macOS<br/>（Apple Silicon） | 音声サンプル |
|---|---|---|---|---|
| [IrodoriTTS](/ja/self-hosting/local-endpoints/text-to-speech/irodoritts/) | 約4.0秒 *(8.5秒のクリップ)*<br/>0.47× RTF | 未計測 | 未計測 | <audio controls preload="none" src="/audio/tts/irodori.wav"></audio> |

- <sup>(1)</sup> 同じRTX 4070 Ti SUPER搭載Windows 11のテスト環境で計測。

---

## どのエンジンを選ぶべきか

- 可能な限り高い声質の忠実度と、細かな表現の角括弧タグ（`[whisper]`、`[laughs]`、`[sigh]`）が必要で、Tritonコンパイラの融合を有効化できるLinuxまたはWSL2を利用できるなら、[Fish Audio S2 Pro](/ja/self-hosting/local-endpoints/text-to-speech/fishs2/)を選んでください。
- VRAMの使用量を抑えた英語の音声クローンには、[Chatterbox（Turbo / Nano / Standard）](/ja/self-hosting/local-endpoints/text-to-speech/chatterbox/)を選んでください。Nano（約3.0秒、0.38× RTF）はCPU/GPUで最大の速度を、Turbo（約5.0秒、0.57× RTF）はパラ言語イベントタグ（`[laughter]`、`[sigh]`）を、Standard（約6.0秒、0.77× RTF）は創造的なCFGガイダンスと感情の誇張調整を提供します。
- 実験的なマルチモーダル音声クローンと、テキストで説明する英語・中国語の音声生成には、[MOSS-TTS](/ja/self-hosting/local-endpoints/text-to-speech/moss/)を選んでください。
- 自然言語による発話方向の指定を伴う、高品質な多言語ゼロショットクローンが必要なら、[CosyVoice 3](/ja/self-hosting/local-endpoints/text-to-speech/cosyvoice3/)を選んでください（「興奮気味に英語で話して」など）。
- 幅広い多言語対応（30言語）、文字起こし支援のUltimate Cloning、自然な音声設計が必要なら、[VoxCPM2](/ja/self-hosting/local-endpoints/text-to-speech/voxcpm2/)を選んでください。
- 柔軟な音声設計と安定したプロンプト追従性を備えた、すっきりとした多言語クローンが欲しいなら、[Qwen3-TTS](/ja/self-hosting/local-endpoints/text-to-speech/qwen3tts/)を選んでください。
- ボットが日本語を話す場合は、[IrodoriTTS](/ja/self-hosting/local-endpoints/text-to-speech/irodoritts/)を選んでください。今回計測した中で唯一の日本語専用エンジンであり（Windowsで約4秒、0.47× RTF）、Unicode絵文字（`😊`、`😭`、`😠`）をネイティブに解釈してキャラクターの感情を調整します。

---

## エンジンを比較する

現在、TomoriBotのすべてのTTSサーバーは完成したWAVをボットに返します。「ストリーミング経路」とは、上流のモデルまたは別の配信バックエンドがその手段を持つという意味であり、Discordの音声チャットへのストリーミングが実装されているという意味ではありません。サイズはモデルのパラメーター数であり、VRAMやダウンロードサイズではありません。また、16 GB欄はセットアップの目安であり、実測されたピーク値ではありません。速度欄は各エンジンが意図するトレードオフを示すものです。上記の計測はいずれも1台のWindowsマシンによるもので、Linuxでの順位付けを示すものではありません。

「参照クリップ」列は、各エンジンがドキュメントに記載しているか、実行時に適用している参照音声の長さをまとめたものです。そのため、公開されている指針と、上流のコードから読み取った制限が混在しています。ほとんどのエンジンはリクエストを拒否するのではなく、自分の窓に合わせて黙って切り詰めます。だからこそ、この列はエンジンが受け入れる長さだけでなく、エンジンが読み取る長さを示しています。これは上流の挙動であり、ここで計測した値ではなく、TomoriBotのアップロード上限とは独立しています。

| エンジン | モデルサイズ・16 GB GPU | 対応言語 | 参照クリップ | 音声ソースと制御 | 速度・ストリーミング経路 | 選ぶ理由 |
|---|---|---|---|---|---|---|
| [Chatterbox](/ja/self-hosting/local-endpoints/text-to-speech/chatterbox/) | Turbo 350M（既定）、Nano 110M、またはStandard 500M。対応、NanoはCPUも使用可 | 英語 | 10秒。それより長い部分は、10秒のプロンプトの窓を超えると黙って無視されます | 参照クローン、対応済みイベントタグ。標準モデルはCFG／誇張表現に対応 | 速度・小型重視。ラッパーは完全なWAVを返却 | 小規模な英語クローンのセットアップやCPUでの実験 |
| [Qwen3-TTS](/ja/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | 各モード1.7B。対応、モデルを入れ替え | 10言語（英語・日本語を含む） | 3秒以上。上限についての記載はなし | クローンまたはテキストによるボイスデザイン | 品質重視。上流はストリーミング対応、ラッパーはバッファリング | 汎用の多言語クローンと日本語のボイスデザイン |
| [MOSS-TTS](/ja/self-hosting/local-endpoints/text-to-speech/moss/) | クローン4B＋設計約1.7Bを入れ替え。16 GBは未検証の試用目標、8Bのフラッグシップはおそらく不可 | クローン: 31言語（日本語を含む）、設計: 英語・中国語 | 上流に記載なし。実行時の上限もなし | クローンまたはテキストによるVoiceGenerator。クローンは言語タグに対応 | 実験的。ローカルクローンには上流のストリーミングバックエンドがあるが、ラッパーはバッファリング | MOSSのクローン品質、または英語・中国語の音声設計を比較する |
| [IrodoriTTS](/ja/self-hosting/local-endpoints/text-to-speech/irodoritts/) | 現行のv4.1 Smallで約0.8B。1件のローカル実行で約3〜4 GBのVRAMを観測 | 日本語のみ | 約30秒。チェックポイントの120秒上限で切り詰められます | クローンまたはボイスデザイン。絵文字によるスタイル指示 | サンプリングステップ数で品質と速度をトレードオフ。ラッパーはバッファリング | 省メモリな日本語音声と絵文字主導の発話 |
| [Fish S2 Pro](/ja/self-hosting/local-endpoints/text-to-speech/fishs2/) | 4B。公式BF16が既定（約16〜18 GB）、16 GB向けの任意のINT8もあり | 上流の公称83言語 | 10〜30秒。実行時の上限なし | 参照クローン（参照文字起こしが必要）、自由形式の角括弧表現タグ | 重いDual-ARモデル。高速な合成にはTritonを使うLinux/WSL2が必要（Windowsのeagerモードでは約65× RTF） | 細かな表現制御。研究ライセンスの条件を確認すること |
| [VoxCPM2](/ja/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | 2B。上流ではBF16で約8 GBと報告 | 30言語 | 5〜30秒。記載された範囲で、実行時の上限はなし | クローン、ボイスデザイン、文字起こし支援のUltimate Cloning、発話指示 | 上流のRTX 4090で約0.30 RTF。上流はストリーミング対応、ラッパーはバッファリング | 幅広い音声ソース制御を備えた1つの多言語モデル |
| [CosyVoice 3](/ja/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | コアは0.5B。16 GBで快適、ダウンロード・実行時のサイズはより大きい | 日本語を含む9言語＋中国語の方言 | 3〜30秒。それより長いものは最初の30秒に切り詰められます | クローン、クロスリンガルクローン、自然言語による発話指示 | 低遅延重視。上流ではネイティブのテキスト・音声ストリーミング、ラッパーはバッファリング | クロスリンガルクローンを備えた将来のストリーミング候補 |

モデルサイズと対応言語数は、[Chatterbox](https://github.com/resemble-ai/chatterbox)、[Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)、[MOSS](https://github.com/OpenMOSS/MOSS-TTS)、[Irodori](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small)、[Fish S2 Pro](https://huggingface.co/fishaudio/s2-pro)、[VoxCPM2](https://huggingface.co/openbmb/VoxCPM2)、[CosyVoice 3](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512)の各上流ページに準拠しています。OS、ドライバー、ライセンス、モデルのリビジョン、メモリの詳細については各ガイドを確認してください。16 GBのGPUが、TTSモデルと大きなローカルLLMを同時にホストできるとは限りません。

IrodoriのVRAM値は1件のローカルでの観測であり、公表された最小要件でもエンジン間のベンチマークでもありません。メモリ使用量はランタイム、精度、スクリプトの長さ、他のGPU処理によって変わります。

Qwen3-TTSの最初のオートモードリクエストにはモデルの読み込みが含まれます。MOSSはセットアップ時に両方のモデルを事前ダウンロードし、既定では起動時にクローンモデルをウォームアップしますが、いずれのオートサーバーもモード切り替え後にはもう一方のモデルを読み込む必要があります。TomoriBotは各完全なレスポンスを`TTS_SYNTHESIZE_TIMEOUT_MS`（既定240000ミリ秒）まで待機します。
