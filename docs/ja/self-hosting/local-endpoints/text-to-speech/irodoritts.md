---
title: "IrodoriTTS"
aiGenerated: true
---

[Irodori-TTS v4.1](https://github.com/Aratako/Irodori-TTS) を使用して、音声クローン、キャプションベースのVoiceDesign、表現力豊かな絵文字マークアップを使用して、自然な日本語音声を生成します。

Irodori-TTS v4.1は、単一チェックポイント内で音声クローン作成とテキスト記述のVoiceDesignの両方をサポートする、日本語に焦点を当てたテキスト読み上げモデルです。TomoriBotは、`servers/tts/irodoritts/`のローカルFastAPIラッパーを介してIrodriに接続します (デフォルトは`Aratako/Irodori-TTS-v4.1-Small`)。

互換性のあるハグフェイスチェックポイントは、`phasefield-audio/Irodori-TTS-v4.1-Anime`などのコミュニティ微調整を含め、`IRODORI_TTS_MODEL_ID`で選択できます。

## セットアップ

Irodriは依存関係とPyTorchバックエンド管理に`uv`を使用します。サーバーは、再現可能なインストールのために、固定されたIrodriおよび`dacvae`依存関係を持つ独自の`pyproject.toml`を維持します。まず`uv`をインストールしてから、TomoriBotリポジトリルートからセットアップスクリプトを実行します。

### Windows PowerShell（NVIDIA）

```powershell
.\servers\tts\irodoritts\install-irodori.ps1 cu128
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

### Linux Bash（NVIDIA）

```bash
bash servers/tts/irodoritts/install-irodori.sh cu128
servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

セットアップスクリプトは`servers/tts/irodoritts/.venv`を作成するため、インストール後も`bun run launch --irodoritts`は引き続き動作します。

利用可能なバックエンド:

- `cu128`: WindowsおよびLinux上のNVIDIA CUDA 12.8
- `cpu`: CPUのみ、またはPyPIを介したmacOS CPU/MPS
- `rocm`: Linux/WSL上のAMD ROCm
- `xpu`: WindowsおよびLinux上のインテルXPU

デフォルトのエンドポイントURLは`http://127.0.0.1:8013`です。

## 別のチェックポイントを使用する

デフォルトのモデルは`Aratako/Irodori-TTS-v4.1-Small`です。互換性のあるHugging Faceリポジトリ、コミュニティの微調整 (`phasefield-audio/Irodori-TTS-v4.1-Anime`など)、またはローカルチェックポイントファイルは、環境変数を介して構成できます。

サーバーを (Pythonで直接または`bun run launch --irodoritts`経由で) 起動すると、リポジトリルート`.env` (または`servers/tts/irodoritts/`のローカル`.env`) が自動的に読み取られ、起動時にアクティブなモデルIDが記録されます。

### `.env`経由 (永続的)

TomoriBotルートの`.env`に追加します。

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### セッションごとの環境変数経由

Windows PowerShellの場合:

```powershell
$env:IRODORI_TTS_MODEL_ID = "phasefield-audio/Irodori-TTS-v4.1-Anime"
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

Linux Bashの場合:

```bash
IRODORI_TTS_MODEL_ID=phasefield-audio/Irodori-TTS-v4.1-Anime \
  servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

### ローカルチェックポイントファイルの使用

チェックポイントファイル (`.pt`または`.safetensors`) をローカルにダウンロードした場合は、そのパスに`IRODORI_TTS_CHECKPOINT`を設定します。

```dotenv
IRODORI_TTS_CHECKPOINT="/path/to/custom_checkpoint.pt"
```

現在の彩りは、Hugging Faceリポジトリにバンドルされているトークナイザー アセットとともにチェックポイントをダウンロードします。Hugging Faceサブフォルダー バリアントは、モデルリポジトリが提供する場合、`IRODORI_TTS_MODEL_ID`でもサポートされます。

## TomoriBotへの登録

`/providers`で`新しいカスタムエンドポイントを追加`を選びます。

- API互換性: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8013`

保存したエンドポイントを選択し、モデルドロップダウンから音声モデルを追加します。v4.1では以下の設定を推奨します。

- 音声ソースモード: 自動
- スクリプトマークアップ形式: 絵文字

自動では、同じIrodoriエンドポイントでTomoriBotの両方の音声モードを利用できます。エモーション表現も途切れません。

- ペルソナ > 音声で音声サンプルを割り当てたペルソナは、保存済みの参照音声を使ってボイスクローニングします。
- ペルソナ > 音声でボイスデザインプロンプトを設定したペルソナは、保存済みの自然言語プロンプトをIrodoriのキャプション条件として使用します。

参照音声によるボイスクローニングだけを使いたい場合は、音声ソースモードで従来どおり音声クローンを選択しても構いません。

登録すると、エンドポイントはすぐに有効になります。今後、音声エンドポイントを切り替える場合にのみ`/providers`を使用します。

## ペルソナ音声のセットアップ

### ボイスクローニング

1. 1つのスピーカーとBGMなしのきれいな日本語の音声クリップを準備します。約30秒ですでに十分です。その時点を超えると、追加のオーディオによって音色の忠実度はほとんど得られず、アップロードサイズと推論時間が犠牲になります。
2. [モデル] > `TTSパラメーターと音声` で`/config`を開き、クリップをアップロードします。
3. [ペルソナ] > `音声` で`/config`を開き、ペルソナと音声サンプルを選択します。

Irodori v4.1は、以前のモデルよりも長いリファレンスコンディショニングをサポートしていますが、クリーンソースオーディオは依然として生の長さよりも重要です。

v4.1ランタイムは、チェックポイントのデフォルトでリファレンスクリップを制限します。v4.1チェックポイントは120秒に設定します。それより長いものは拒否されるのではなく、その上限に合わせてトリミングされ、`IRODORI_MAX_REF_SECONDS`がそれをオーバーライドします。したがって、TomoriBotの130秒のアップロード上限にあるクリップは引き続き機能します。つまり、最初の120秒でIrodri条件が適用されます。

クリップが長くても音声品質は向上しません。Upstreamの報告によると、約30秒のクリーンな参照音声で、測定可能な話者類似性ゲインのほとんどがすでに捕捉されており、同じ話者からの複数の短いクリップは1つの長い録音よりも優れていると報告されています。長いクリップに伴う追加のリファレンス潜在ステップもすべての合成リクエストを長くします。30秒を超えるのは、発言者の音色が録音全体に漂っている場合のみです。

### ボイスデザイン

1. [ペルソナ] > `音声` で`/config`を開きます。
2. ペルソナを選択します。
3. 希望する音声と配信についての自然言語の説明を入力します。

TomoriBotは、このプロンプトを`instruct`として送信します。Irodriラッパーはそれをv4.1 `caption`条件にマップします。VoiceDesignリクエストには、保存されたリファレンスクリップは必要ありません。

TomoriBotは、テキストをTTSに送信する前に、Discordカスタム絵文字構文を削除します。`script_markup: emoji`を使用すると、Unicode絵文字がIrodriのテキスト条件付けのために保存されます。

### 絵文字スタイル制御

IrodriTTSは、効果音、話し方、感情表現に影響を与える入力テキスト内の絵文字注釈をサポートしています。TomoriBotの`スクリプトのマークアップ形式`を`絵文字`に設定すると、これらのUnicode絵文字が保存され、irodriに送信されます。

| 絵文字 | 意味・感情・スタイル |
| --- | --- |
| 👂 | ささやき声、耳元で聞こえる音 |
| 😮‍💨 | 息、ため息、寝息 |
| ⏸️ | 一時停止、沈黙 |
| 🤭 | くすくす笑う、くすくす笑い、抑えた笑い |
| 🥵 | あえぐ、うめき声、うめき声 |
| 📢 | エコー、リバーブ |
| 😏 | からかう、ふざけて甘い/なだめる |
| 🥺 | 声が震えて、おずおずと/不安そうに |
| 🌬️ | 息切れ、呼吸が荒い |
| 😮 | あえぎ |
| 👅 | 舐める音、噛む音、濡れた音 |
| 💋 | リップスマック / リップノイズ |
| 🫶 | 優しく、優しく |
| 😭 | すすり泣く、泣く、悲しむ/悲しい |
| 😱 | 叫ぶ、叫ぶ、金切り声を上げる |
| 😪 | 眠い、だるい/だるい |
| 😴 | 寝言、いびきをかく |
| ⏩ | 早口、早口、急いで話す |
| 📞 | 電話で、スピーカーを通して |
| 🐢 | ゆっくり |
| 🥤 | ゴクゴク、飲み込む音 |
| 🤧 | 咳、鼻をすする、くしゃみ、咳払い |
| 😒 | タティング、舌打ち |
| 😰 | パニック、興奮、緊張、吃音 |
| 😆 | 楽しく、楽しく |
| 💥 | 勢い・勢いで、勢いよく |
| 😠 | 怒っている、不満を持っている、すねている |
| 😲 | 驚き、畏怖、感嘆 |
| 🥱 | あくび |
| 😖 | 痛々しく、苦痛に |
| 😟 | 不安に、心配に |
| 🫣 | 恥ずかしそうに、恥ずかしそうに |
| 🙄 | イライラして目を丸くする |
| 😊 | 元気に、喜んで |
| 😎 | 自信を持って、誇らしげに |
| 👌 | 裏話、同意の音 |
| 🙏 | 懇願する、懇願する |
| 🥴 | 酔って |
| 🎵 | ハミング |
| 🤐 | くぐもった（口を覆われた） |
| 😌 | 安心した、満足した |
| 🤔 | 疑問の声、疑問 |
| 💪 | 努力して、強く |
| 👃 | 匂いを嗅ぐ/匂いを嗅ぐ音 |
| 📖 | ナレーション、モノローグ |

同じ絵文字を繰り返すと、その効果が強化される可能性があります。絵文字コントロールは完全に一貫しているわけではないため、これらを出力を保証するものではなく、スタイルの手がかりとして扱います。上流リストと将来の更新については、[公式IrodriTTS絵文字注釈](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small/blob/main/EMOJI_ANNOTATIONS.md) を参照してください。

## 長い音声メッセージ

Irodori v4.1は固定長のクリップを生成するのではなく、duration predictorで出力長を予測するため、ローカルサーバー側で1回の発話あたりの長さ上限を設けていません。それでもTomoriBotは長いテキストを合成前に分割し、生成した音声を1つのWAVレスポンスへ連結するため、Discord側には1つの音声メッセージとして届きます。分割によって各推論が短く保たれ、レイテンシが抑えられます。

実装は[公式Irodori OpenAI互換サーバー](https://github.com/Aratako/Irodori-TTS-Server/blob/main/src/irodori_openai_tts/app.py)のチャンク処理を基準にしています。公式サーバーでは80文字の非空白文字を基準にチャンク処理がデフォルトで有効です。TomoriBotではさらに、閉じ引用符や閉じ括弧を直前の句読点と同じチャンクに残し、`！？`や`...`のような連続した終端記号をまとめ、数字に隣接する小数点では分割せず、短すぎる最後のチャンクを直前へ結合します。

設定した最小文字数に達すると、`。`、`！`、`？`、`.`、`!`、`?`、省略記号、改行などの強い文末を優先して分割します。カンマはチャンクがしきい値のおよそ1.5倍まで長くなった場合にだけフォールバック境界として使います。デフォルトの`IRODORI_CHUNK_MIN_CHARS=80`では、強い文末は非空白文字80文字から、カンマはおよそ120文字から分割候補になります。十分に長い文章でも分割候補の記号がなければ、1回の合成リクエストのままになる場合があります。

参照音声を使わないボイスデザインでは、最初のチャンクで実際に使用されたIrodoriのseedを後続チャンクでも再利用し、チャンク間のランダムな変動を抑えます。同じseedを使っても、個別に合成されたチャンク間で声質が完全に一致する保証はありません。参照音声モードでは、同じ参照クリップを各チャンクへ適用します。

長文では複数回の推論を順番に実行するため、低速な環境では処理時間が大きく伸びる場合があります。TomoriBotのTTSクライアントのデフォルトタイムアウトは240秒です。`IRODORI_CHUNKING_ENABLED=false`でチャンク処理を無効化でき、`IRODORI_CHUNK_MIN_CHARS`でおおよその分割しきい値を調整できます。

## 揺れサンプリングによる高速推論

デフォルトは、彩の高品質な40ステップのリニアサンプリングのままです。レイテンシを低くするには、少ないステップでSwayサンプリングを試してください。

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

これは推論の品質と速度のトレードオフであるため、永続化する前に、選択したチェックポイントと音声でテストしてください。

## 環境変数

| 変数 | デフォルト値 | 目的 |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Hugging Faceモデル、または対応するrepo/subfolder指定 |
| `IRODORI_TTS_CHECKPOINT` | 未設定 | 任意のローカル`.pt` / `.safetensors`チェックポイント。設定時はHugging Faceモデルより優先 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | サーバーのバインドアドレス。[ネットワークアクセス](/ja/self-hosting/local-endpoints/text-to-speech/#network-access)を参照 |
| `IRODORI_TTS_PORT` | `8013` | サーバーポート |
| `IRODORI_MODEL_DEVICE` | `auto` | モデルデバイス（`auto`、`cuda`、`cpu`、`mps`、`xpu`） |
| `IRODORI_CODEC_DEVICE` | `auto` | コーデックデバイス |
| `IRODORI_MODEL_PRECISION` | CUDAでは`bf16`、それ以外は`fp32` | モデル精度 |
| `IRODORI_CODEC_PRECISION` | `fp32` | コーデック精度 |
| `IRODORI_COMPILE_MODEL` | `false` | Irodoriモデルで`torch.compile`を有効化 |
| `IRODORI_COMPILE_DYNAMIC` | `false` | コンパイル時にdynamic shapesを有効化 |
| `IRODORI_NUM_STEPS` | `40` | Euler samplingのステップ数 |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | サンプリングスケジュール（`linear` / `sway`） |
| `IRODORI_SWAY_COEFF` | `-1.0` | `sway`使用時の係数 |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | テキスト条件のguidance scale |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | Caption / ボイスデザイン条件のguidance scale |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | 参照話者条件のguidance scale |
| `IRODORI_MAX_REF_SECONDS` | チェックポイント側のデフォルト | 参照音声長の任意上限 |
| `IRODORI_CHUNKING_ENABLED` | `true` | 長文を分割して生成音声を1つに連結 |
| `IRODORI_CHUNK_MIN_CHARS` | `80` | 強い文末で分割可能になる非空白文字数。カンマはこの値のおよそ1.5倍でフォールバック境界になる |
