---
title: "Qwen3-TTS"
aiGenerated: true
---

音声クローン作成モードとテキスト記述のVoiceDesignモードの両方で [Qwen3-TTS](https://github.com/QwenAudio/Qwen3-TTS) を使用して、高精度の多言語文字音声を合成します。

Qwen3-TTS 12Hz 1.7Bは、高精度のローカル音声合成を提供します。`servers/tts/qwen3tts/server.py`をデフォルトの自動モードで実行すると、各受信リクエストに基づいて、Base voice-cloningモデルまたはVoiceDesignモデルが動的に選択されます。

## セットアップ

TomoriBotリポジトリルート、つまりTomoriBotのクローンを作成したフォルダーから次のコマンドを実行します。

### Windows PowerShell

```powershell
python -m venv servers\tts\qwen3tts\.venv
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r servers\tts\qwen3tts\requirements.txt
python servers\tts\qwen3tts\server.py
```

### LinuxおよびmacOS Bash

```bash
python3 -m venv servers/tts/qwen3tts/.venv
source servers/tts/qwen3tts/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r servers/tts/qwen3tts/requirements.txt
python servers/tts/qwen3tts/server.py
```

デフォルトの自動モードのエンドポイントURLは`http://127.0.0.1:8012`です。別のポートを使用するように`QWEN3TTS_PORT`を設定します。自動モードを明示的に指定することもできます。

```powershell
python servers\tts\qwen3tts\server.py --mode auto
```

自動モードは、各`/synthesize`リクエストを検査します。`ref_audio`のリクエストはクローンモデルを使用し、`instruct`のリクエストはVoiceDesignモデルを使用します。一度にロードされるモデルは1つだけであり、リクエストタイプが変更されるとモデルがスワップされるため、スワップ後の最初のリクエストは遅くなる可能性があります。

## TomoriBotへの登録

ほとんどのユーザーは、1つのエンドポイントでボイスクローンとボイスデザインの両方のペルソナをサポートできるように、オートモードサーバーを登録します。

`/providers`で`新しいカスタムエンドポイントを追加`を選びます。

- API互換性: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8012`

保存したエンドポイントを選択し、モデルの追加・編集ドロップダウンで新しい音声モデルに以下を設定します。

- 音声ソースモード: 自動
- スクリプトマークアップ形式: プレーン

登録すると、エンドポイントはすぐに有効になります。今後、音声エンドポイントを切り替える場合にのみ`/providers`を使用します。

## ペルソナボイスを設定する

### 音声クローン

リファレンスクリップを模倣するペルソナにこれを使用します。

1. 1つのスピーカーを使用し、バックグラウンドミュージックを使用しない、きれいな10 ～ 20秒のボイスクリップを準備します。
2. [モデル] > `TTSパラメーターと音声` で`/config`を開き、クリップをアップロードします。
3. [ペルソナ] > `音声` で`/config`を開き、ペルソナと音声サンプルを選択します。

Qwen3-TTSは、わずか3秒のリファレンスオーディオからの迅速なクローン作成を宣伝しており、そのランタイムにはリファレンス期間の上限が文書化されておらず、強制されていません。したがって、クリップの長さは、サーバーがチェックする制限ではなく、ユーザーが制御できる品質のトレードオフです。

### ボイスデザイン

サンプルの代わりに音声による説明を使用する必要があるペルソナにこれを使用します。

1. [ペルソナ] > `音声` で`/config`を開き、[VoiceDesign] を選択します。
2. ペルソナを選択します。
3. 話者の年齢、口調、アクセント、話し方などの自然言語音声プロンプトを入力します。

`/config`の [ペルソナ] > `音声` からペルソナのVoiceDesignプロンプトを削除します。生成中、TomoriBotは、保存されたプロンプトを`/synthesize` JSON本文に`instruct`として送信します。ツールからのワンオフ`voice_instructions`が追加されます。

自動モードでは両方の設定が維持されます。`/config`の [ペルソナ] > `音声` で設定されたペルソナは、選択に応じてクローン合成またはVoiceDesign合成を使用します。

## オプション: VoiceDesign専用サーバー

`Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`を提供するときは、同じサーバーをVoiceDesignモードで起動します。

Windows PowerShell:

```powershell
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
$env:TOMORI_TTS_MODE = "voice-design"
python servers\tts\qwen3tts\server.py
```

バッシュ:

```bash
source servers/tts/qwen3tts/.venv/bin/activate
TOMORI_TTS_MODE=voice-design python servers/tts/qwen3tts/server.py
```

`TOMORI_TTS_MODE`を設定する代わりに、`--mode voice-design`を渡すこともできます。デフォルトのVoiceDesign専用エンドポイントURLは`http://127.0.0.1:8014`です。

自動モードと同じ方法で登録しますが、エンドポイントURL `http://127.0.0.1:8014`を使用し、音声モデルの音声ソースモードとして`ボイスデザイン`を選択します。
