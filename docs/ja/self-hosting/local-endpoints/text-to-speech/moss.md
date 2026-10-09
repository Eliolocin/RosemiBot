---
title: "MOSS-TTS"
---

[MOSS-TTS](https://github.com/OpenMOSS/MOSS-TTS) を使用して、統合音声エンドポイントを通じてローカルで音声クローンと自然言語音声設計を評価します。

`servers/tts/moss/server.py`を使用して、TomoriBotは合成リクエストを動的にルーティングします。ペルソナが`ref_audio`を提供するとクローンモデルをロードし、自然言語`instruct`ガイダンスが提供されるとMOSS-VoiceGeneratorに切り替えます。16 GB VRAMバジェット内で実行するために、一度に1つのモデルのみがGPUメモリに保持されます。

デフォルトのクローンモデルは [MOSS-TTS-Local-Transformer-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5) (4B) で、16 GB GPUの実用的なベースラインとして選択されています。[MOSS-TTS-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-v1.5) は、BF16でより多くのVRAMを必要とする8Bの主力代替品です。音声デザインは[MOSS-VoiceGenerator](https://huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator)(約1.7B)を使用しています。クローン作成と音声設計を切り替えると、モデルの読み込みに遅延が発生します。

## セットアップ

Python 3.12とCUDA 12.8と互換性のあるドライバーを使用して、TomoriBotリポジトリルートからコマンドを実行します。

### Windows PowerShell

```powershell
python -m venv servers\tts\moss\.venv
servers\tts\moss\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers\tts\moss\requirements.txt
python servers\tts\moss\prefetch_models.py
python servers\tts\moss\server.py
```

### LinuxまたはWSL Bash

```bash
python3.12 -m venv servers/tts/moss/.venv
source servers/tts/moss/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers/tts/moss/requirements.txt
python servers/tts/moss/prefetch_models.py
python servers/tts/moss/server.py
```

プリフェッチコマンドは、サーバーを起動する前に、クローンモデル、VoiceGenerator、およびオーディオトークナイザーをHugging Faceキャッシュにダウンロードします。ディスク容量が限られている場合は、`HF_HOME`をより大きなパーティションに設定します。1つのモデルのみをダウンロードするには、`--mode clone`または`--mode voice-design`を渡します。

デフォルトのエンドポイントは`http://127.0.0.1:8018`です。`bun run launch --moss`を実行して、TomoriBotと一緒にサーバーを起動します。自動モードでは、ローカルキャッシュからクローンモデルをプリウォームします。代わりに`MOSS_TTS_WARM_MODE=voice-design`をVoiceGeneratorのプリウォームに設定するか、`MOSS_TTS_WARM_MODE=none`を遅延初期化に設定します。アクティブな`warm_mode`、`active_mode`、および`model_id`については、`GET /health`を確認してください。ラッパーはHugging Face `trust_remote_code=True`を使用するため、更新する前にアップストリームのコードを確認してください。

## TomoriBotへの登録

`/providers`で、`Add New Custom Endpoint`を選択し、API互換性を`tts-clone`に設定し、エンドポイントURL `http://127.0.0.1:8018`を使用します。`音声ソースモード`を`自動`に設定し、`Script Markup`を`プレーン`に設定して音声モデルを追加します。`/config` > `モデル` > `モデルの切り替え` でアクティブ化します。

音声のクローンを作成するには、`/config` > `モデル` > `TTSパラメーターと音声` でクリーンなリファレンスクリップをアップロードし、それを [ペルソナ] > `音声` で割り当てます。短くクリーンなオーディオクリップでは、最も一貫した結果が得られます。音声デザインの場合は、「ペルソナ」>「`音声`」の下に自然言語の説明を保存します。MOSS-VoiceGeneratorは英語と中国語向けに設計されていることに注意してください。4Bクローンモデルは日本語をサポートしていますが、明示的な言語タグにより合成の明瞭さが向上します。

TomoriBotのクローンアダプターは、言語タグを自動的に送信しません。単一言語で使用する場合は、サーバーを起動する前に`MOSS_TTS_DEFAULT_LANGUAGE=Japanese` (または`日本語`、`Chinese`など) を設定します。手動の`/synthesize`呼び出しでは、`language`を直接渡すことができます。

サーバーは独自のシェル環境を読み取ります。ボットの`.env`の設定は、独立して起動されたPythonターミナルには適用されません。

高メモリハードウェアで8Bモデルを実行するには、プリフェッチ前に`MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5`を設定します。`MOSS_TTS_PORT`、`MOSS_TTS_DEVICE`、`MOSS_TTS_DTYPE`、および`MOSS_TTS_MAX_NEW_TOKENS`は、`.env.optional.example`で構成可能です。モデルのスワップやCPUの実行によりタイムアウトが発生する場合は、TomoriBotの`TTS_SYNTHESIZE_TIMEOUT_MS`を増やします。
