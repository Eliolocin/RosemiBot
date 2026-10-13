---
title: "VoxCPM2"
aiGenerated: true
---

OpenBMBの [VoxCPM2](https://github.com/OpenBMB/VoxCPM) テキスト読み上げモデルを使用して、30言語にわたる表現力豊かな48 kHz音声を合成します。

VoxCPM2は、音声クローン作成、トランスクリプト支援による究極のクローン作成、および自然言語音声デザインをサポートする2Bパラメーターの多言語音声モデルです。TomoriBotは、`servers/tts/voxcpm2/`のサーバーを介して公式`voxcpm` Pythonライブラリに接続し、量子化されていない公式の`openbmb/VoxCPM2` BF16チェックポイントを16 GBのVRAM内で快適に実行します。

## ライセンス

VoxCPM2のコードとモデルの重みはApache-2.0のもとで公開されており、ライセンス条件に従う商用利用も含まれます。TomoriBotはこの重みを再配布しません。インストーラーは公式のHugging Faceリポジトリからダウンロードします。

公式の上流リソース:

- [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM)
- [Hugging FaceのOpenbmb/VoxCPM2](https://huggingface.co/openbmb/VoxCPM2)
- [VoxCPMのドキュメント](https://voxcpm.readthedocs.io/)

## 対応言語

VoxCPM2は、言語タグを必要とせずに公式に30言語へ対応しています。

アラビア語、ビルマ語、中国語、デンマーク語、オランダ語、英語、フィンランド語、フランス語、ドイツ語、ギリシャ語、ヘブライ語、ヒンディー語、インドネシア語、イタリア語、日本語、クメール語、韓国語、ラオ語、マレー語、ノルウェー語、ポーランド語、ポルトガル語、ロシア語、スペイン語、スワヒリ語、スウェーデン語、タガログ語、タイ語、トルコ語、ベトナム語。

OpenBMBはいくつかの中国語方言についても文書化しています。TomoriBotは一般的なTTSの契約との互換性のために`language`フィールドを送信することがありますが、VoxCPM2は合成テキストから言語を検出するため、ラッパーは言語タグを強制しません。

## 音声モード

1つのVoxCPM2エンドポイントで、TomoriBotが利用する音声ソースモードのすべてを扱えます。

| TomoriBotのリクエスト | VoxCPM2の挙動 |
|---|---|
| `text`のみ | 拒否されます。参照サンプルまたはボイスデザインのプロンプトを選んでください |
| `text` + `instruct` | 自然言語による説明からのボイスデザイン |
| `text` + `ref_audio` | 参照音声によるボイスクローン |
| `text` + `ref_audio` + `instruct` | 制御可能なクローン: 話者を保ちつつ発話を誘導 |
| `text` + `ref_audio` + `ref_text` | 参照音声とその文字起こしを使ったUltimate Cloning |
| `text` + `ref_audio` + `ref_text` + `instruct` | 制御可能なクローン。その場限りの指示が優先され、文字起こしは送信されません |

VoxCPM2は、合成するテキストの前に自然言語の説明を括弧で囲んで置くことで、ボイスデザインとスタイル制御を表現します。TomoriBotにはすでにこの目的のための`instruct`フィールドがあるため、ラッパーがこの変換を自動的に行います。

スクリプトマークアップ形式は`プレーン`を使用してください。VoxCPM2は角括弧タグや絵文字による制御構文をTomoriBotに保持させる必要がなく、新しいスクリプトマークアップ形式も不要です。

## ハードウェアとランタイム

推奨される出発点:

- Python 3.10〜3.12
- 公式BF16ランタイム向けに8 GB以上のVRAMを搭載したNVIDIA GPU。12〜16 GBあれば余裕を持って動作します
- GPUアクセラレーション用の最新のNVIDIAドライバーとCUDA対応のPyTorchビルド
- CPUはフォールバックとして対応していますが、かなり低速です

公式パッケージはCPUとApple MPSのデバイス選択にも対応しています。Windows上のTomoriBotでは、標準のPythonパッケージがネイティブに動作するため、WSLは必要ありません。Windows PowerShell用インストーラーは、既定でCUDA対応のPyTorchビルド（`cu124`）をインストールします。

CPUのみのマシンに明示的にインストールするには、`-Cpu`スイッチを渡します。

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1 -Cpu
```

ネイティブWindowsのPyTorchインストールを手動で再インストールしたり、ドライバーとの整合を取り直したりする必要が生じた場合は、ローカルサーバーの仮想環境に直接CUDA対応のPyTorchビルドをインストールしてください。

```powershell
.\servers\tts\voxcpm2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

OpenBMBは、標準ランタイムでRTX 4090においておよそ0.30 RTFを報告しています。上流はストリーミング生成にも対応しており、より高速なNano-vLLMとvLLM-Omniによる配信オプションも文書化しています。TomoriBotの現行の`POST /synthesize`契約は1つのWAVレスポンスを返す前提のため、このローカルサーバーは別途ストリーミングプロトコルを公開する代わりに、意図的に生成した発話をバッファリングします。

## インストール

サーバーは現在の安定した`voxcpm` 2.0.3パッケージを固定し、`openbmb/VoxCPM2`を通常のHugging Faceキャッシュにダウンロードします。

### LinuxとWSL Bash

TomoriBotリポジトリルートから:

```bash
bash servers/tts/voxcpm2/install-voxcpm2.sh
servers/tts/voxcpm2/.venv/bin/python servers/tts/voxcpm2/server.py
```

### Windows PowerShell

TomoriBotリポジトリルートから:

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1
.\servers\tts\voxcpm2\.venv\Scripts\python.exe servers\tts\voxcpm2\server.py
```

最初のセットアップでは、数ギガバイトのモデルウェイトをダウンロードします。モデルをプリフェッチせずにPython環境をインストールするには、`VOXCPM2_PREFETCH=0`を設定します。公式ライブラリは、最初のサーバー起動時にチェックポイントをダウンロードします。

LinuxとWSL:

```bash
VOXCPM2_PREFETCH=0 bash servers/tts/voxcpm2/install-voxcpm2.sh
```

パワーシェル:

```powershell
$env:VOXCPM2_PREFETCH = "0"
.\servers\tts\voxcpm2\install-voxcpm2.ps1
```

セットアップ後、`bun run launch --voxcpm2`はTomoriBotとともにサーバーを起動します。デフォルトのエンドポイントは`http://127.0.0.1:8016`です。

## TomoriBotへの登録

`/providers`を実行し、`新しいカスタムエンドポイントを追加`を選んで、音声エンドポイントを次のように設定します。

- 機能: 音声
- API互換性: `tts-clone`
- エンドポイントURL: `http://127.0.0.1:8016`
- 音声ソースモード: 自動
- スクリプトマークアップ形式: プレーン
- 指示の対応: 有効

接続を保存したら、それを選択し、モデルのドロップダウンから音声モデルを追加します。続いて`/config` > モデル > モデルの切り替えを開き、VoxCPM2の音声モデルを選択してください。

同一のサーバーが参照音声のクローンとボイスデザインの両方に対応しているため、音声ソースモードには自動を推奨します。両方のモードのために別々のVoxCPM2プロセスを用意する必要はありません。

## ペルソナの音声クローン

既存の話者をクローンすべきペルソナの場合:

1. 背景音楽がほとんどまたはまったくない、話者1人によるクリアな参照クリップを準備します。上流は5〜30秒を実用的な範囲として扱います。
2. `/config`でモデル > TTSパラメーターと音声を開き、そのクリップをアップロードします。
3. 可能であれば、参照クリップの正確な文字起こしを追加します。VoxCPM2はこれをUltimate Cloningに使用し、参照のリズム、感情、スタイルをより忠実に再現できます。
4. `/config`でペルソナ > 音声を開き、ペルソナを選んで、保存済みのサンプルを割り当てます。

文字起こしが保存されていない場合でも、VoxCPM2は通常の参照音声クローンを行います。

5〜30秒という数字は、適用される上限ではなく文書化された品質範囲です。VoxCPM2は独自の参照音声の長さ制限を設けていないため、より長いクリップを止めるのはTomoriBotのアップロード上限です。

## ペルソナボイスデザイン

サンプルではなく書かれた音声の説明から作成する必要があるペルソナの場合:

1. [ペルソナ] > `音声` で`/config`を開き、[VoiceDesign] を選択します。
2. ペルソナを選択します。
3. `Young adult woman, soft warm voice, relaxed pace, slightly playful delivery`などの自然言語の説明を入力します。

TomoriBotは、保存された説明を`instruct`として送信します。VoxCPM2は、それをネイティブの音声デザインコントロールプレフィックスに変換します。

クローン化されたペルソナが1回限りの音声指示も受け取る場合、VoxCPM2は制御可能なクローン作成を使用します。つまり、参照サンプルが話者のIDを提供し、指示が感情、ペース、伝え方などの品質を制御します。トランスクリプトも保存されている場合は、上流のUltimate Cloningパスが信頼性の高い制御命令モードを提供しないため、命令が優先されます。そのリクエストではトランスクリプトは意図的に省略されています。

## `/generate voice-message`でのテスト

VoxCPM2がアクティブな音声モデルになると、`/generate voice-message`は通常の音声メッセージツール呼び出しと同じ方法でペルソナの設定された音声ソースを使用します。

- クローンペルソナは、保存されている`ref_audio`とオプションの`ref_text`を送信します。
- VoiceDesignペルソナは、保存されたプロンプトを`instruct`として送信します。
- Supports Instructが有効になっているクローン対応エンドポイントは、配信方向フィールドを公開し、`instruct`を通じて1回限りの命令を渡します。
- クローンサンプルに命令が存在する場合、TomoriBotは`reference_wav_path`のみを使用し、トランスクリプトプロンプトフィールドを送信しません。

## 環境変数

| 変数 | 既定値 | 用途 |
|---|---|---|
| `VOXCPM2_MODEL_ID` | `openbmb/VoxCPM2` | Hugging FaceのモデルIDまたはローカルモデルディレクトリ |
| `VOXCPM2_DEVICE` | `auto` | ランタイムのデバイス: `auto`、`cuda`、`cuda:N`、`cpu`、`mps` |
| `VOXCPM2_OPTIMIZE` | `1` | 公式ランタイムの最適化・コンパイル経路を有効化 |
| `VOXCPM2_LOAD_DENOISER` | `0` | 任意の上流デノイザーを読み込む。メモリ節約のため既定は無効 |
| `VOXCPM2_CFG_VALUE` | `2.0` | ガイダンス強度 |
| `VOXCPM2_INFERENCE_TIMESTEPS` | `10` | フローマッチングの推論ステップ数。増やすと速度と引き換えに品質が向上し得る |
| `VOXCPM2_MAX_LEN` | `4096` | 生成の最大長 |
| `VOXCPM2_NORMALIZE` | `0` | 上流のテキスト正規化を有効化 |
| `VOXCPM2_RETRY_BADCASE` | `1` | 異常な生成に対する上流の再試行動作を有効化 |
| `VOXCPM2_RETRY_BADCASE_MAX_TIMES` | `3` | 自動再試行の最大回数 |
| `VOXCPM2_RETRY_BADCASE_RATIO_THRESHOLD` | `6.0` | 上流の不良ケース長のしきい値 |
| `VOXCPM2_PREFETCH` | `1` | インストーラー専用: セットアップ中にモデルをダウンロード |
| `VOXCPM2_PORT` | `8016` | VoxCPM2ローカルサーバーのポート |
| `TOMORI_TTS_HOST` | `127.0.0.1` | ローカルサーバーのバインドアドレス。[ネットワークアクセス](/ja/self-hosting/local-endpoints/text-to-speech/#network-access)を参照 |

参照音声はデコード後10 MB以下の空でないWAVコンテナである必要があり、ラッパーは一時ファイルを書き込む前にこれを確認します。

## 代替のチェックポイントとランタイム

公式のBF16モデルはすでに想定する16 GBのコンシューマーGPUという目標に収まるため、TomoriBotは既定で量子化済みチェックポイントを使用しません。コミュニティによる量子化版も存在しますが、通常のセットアップには不要なまま、互換性と保守のレイヤーをもう1つ増やすだけになります。

高スループットのデプロイでは、OpenBMBは現在、高速化された配信オプションとしてNano-vLLM-VoxCPMとvLLM-Omniを挙げています。これらのランタイムは、この参照サーバーを超えたストリーミングや並行配信の機能を公開できます。TomoriBotの通常のローカル音声メッセージのワークフローにはこれらは不要であり、このラッパーは上流のモデルのアップグレードを追いやすいままにするため、意図的に公式の`voxcpm` APIにとどまっています。
