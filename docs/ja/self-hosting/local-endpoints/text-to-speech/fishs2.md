---
title: "Fish Audio S2 Pro"
aiGenerated: true
---

[Fish Audio S2 Pro](https://github.com/fishaudio/fish-speech) を使用して、きめ細かい感情タグを備えた表現力豊かな多言語キャラクター音声を合成します。

Fish Audio S2 Proは、高忠実度の音声クローン作成用に構築された多言語4Bパラメータのテキスト読み上げモデルです。TomoriBotは、`servers/tts/fishs2/`のローカルラッパーを介してモデルに接続します。デフォルトは公式のBF16重み (`fishaudio/s2-pro`) で、8 ～ 12 GBのVRAMを備えたGPU用のオプションのINT8量子化チェックポイント (`Imagilux/fishaudio-s2-pro`) が使用されます。

Fish S2 Proは、`[whisper]`、`[excited]`、`[angry]`などの括弧式タグをサポートします。`ブラケットタグ`マークアップを使用してエンドポイントを構成し、TomoriBotが生成された音声スクリプトでこれらのコントロールを保持できるようにします。

## ライセンス

Fish Speechのコードおよびs2-Proのモデル重みは、Fish Audio Research Licenseの下で配布されています。研究目的と非商用利用はその条件の下で許可されていますが、商用利用には別途Fish Audioのライセンスが必要です。

TomoriBotはモデルの重みを再配布しません。セルフホストする各ユーザーは、Hugging Faceから直接Fish S2 Proをダウンロードし、Fish Audio Research Licenseを順守する責任を負います。必要なクレジット表記はBuilt with Fish Audioです。

## ハードウェアとオペレーティングシステム

> [！重要]
> Fish Audioは正式にLinuxとWSL2をターゲットとしています。Fish S2 Proは、デュアル自動回帰 (デュアルAR) アーキテクチャ (36の低速トランスフォーマー レイヤー + 10の高速コードブックパス = トークンあたり76レイヤーの評価) を使用します。Linuxでは、OpenAI Tritonがこのループを融合GPUカーネル (`torch.compile(backend="inductor")`) にコンパイルし、リアルタイム合成を可能にします。ラッパーはデフォルトでコンパイルをオフのままにします。`FISH_S2_COMPILE=1`を設定して有効にします。>
> ネイティブWindowsではTritonはサポートされていないため、PyTorchはWindows WDDMドライバーを介して120,000を超える連続CUDAカーネルディスパッチを伴う非コンパイルEagerモードに強制されます。これにより、深刻なディスパッチストールが発生し、まったく同じクリップの生成が最大8 ～ 10分 (オーディオの1秒あたり最大65秒の計算) まで遅くなります。推論を使用するには、LinuxまたはWSL2内でFish S2 Proを実行します。

推奨ハードウェア:

- **LinuxまたはWSL2 (強く推奨)**
- 16 GB ～ 24 GB VRAMを備えたNVIDIA GPU (BF16は、KVキャッシュとオフロードを備えた ~16 ～ 18 GB VRAMに快適に適合します)
- Python 3.12を推奨
- `git`、`ffmpeg`、およびFish Speechに必要な標準オーディオライブラリ

## セットアップ

### LinuxおよびWSL2 (推奨)

TomoriBotリポジトリルートから:

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

インストーラー:

1. `Imagilux/fish-speech`を`servers/tts/fishs2/fish-speech/`にクローンし、固定されたランタイムコミットをチェックアウトします。
2. 分離された`.venv`を作成します。
3. Fish SpeechとTomoriBotラッパーの依存関係をインストールします。そして
4. 公式BF16 `fishaudio/s2-pro`チェックポイントを`fish-speech/checkpoints/fish-speech-s2-pro/`にダウンロードします。

通常の再インストールでは、移動するブランチに従うのではなく、固定されたランタイムコミット`2225e924e7d35cc0a1d24dbc67cd1819e6cf429f`に留まります。新しいランタイムに移行するということは、インストーラーでそのピンを変更することを意味します。モデルリビジョンのデフォルトは`main`です。デプロイメントを再現可能にする必要がある場合は、`FISH_S2_MODEL_REVISION`を不変のHugging Faceリビジョンに固定します。インストーラー設定は、[インストーラー変数](#installer-variables) にリストされます。

ハグフェイスモデルはゲートされています。まず、Hugging Faceでライセンスに同意してください。ダウンロードで認証が必要な場合は、次を実行します。

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

次に、インストーラーを再実行します。

### Windows PowerShell (ベストエフォート型のみ)

ネイティブWindowsは評価用にのみ提供されています。未コンパイルのEagerモードでのドライバー ディスパッチの遅延により、生成は非常に遅くなります (クリップごとに約8 ～ 10分)。

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

PowerShellインストーラーは、デフォルトでCUDA GPUアクセラレーション (`cu124`) をターゲットとしています。NVIDIA GPUのないCPUのみのマシンにインストールするには、`-Cpu`を渡します。

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

Windows上のPyTorchを手動でインストールするか、CUDAサポートを使用して更新する必要がある場合は、次を実行します。

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

TomoriBotは、`TTS_SYNTHESIZE_TIMEOUT_MS` (デフォルトは240000ミリ秒) の後に音声メッセージの待機を停止します。これは、ネイティブWindowsクリップにかかる時間よりも短いです。Windowsで評価するときに、TomoriBotの`.env` (たとえば、`TTS_SYNTHESIZE_TIMEOUT_MS=900000`) で上げます。

## 必須の参考記録

> [！警告]
> 音声クローン作成には参照テキスト (`ref_text`) が必要です。Fish S2 Proのクロスアテンションメカニズムでは、音声トークンを音響コードと一致させるために、リファレンスオーディオのトランスクリプトが必要です。>
> 一致する参照トランスクリプトを提供せずに音声サンプルをアップロードすると、Fish Speechは参照音声トークンをサイレントに削除し、ランダムなゼロ参照音声にフォールバックします。TomoriBot Fishラッパーは、参照テキストが欠落している合成リクエストを`400 Bad Request`で検証して拒否し、偶発的な無条件生成を防ぎます。

`Models > `TTS問題と音声``, always fill in the `参照トランスクリプト`フィールドの下の`/config`に、参照オーディオクリップで話された逐語的なテキストを含むペルソナ音声を追加する場合。

## TomoriBotへの登録

`/providers`で`新しいカスタムエンドポイントを追加`を選び、次のように設定します。

- 機能: 音声
- API互換性: `tts-clone`
- エンドポイントURL: `http://127.0.0.1:8015`
- 音声ソースモード: 音声クローン
- スクリプトマークアップ形式: ブラケットタグ
- APIキー: 空欄のままにします。ラッパーには認証がありません。詳しくは[ネットワークアクセス](/ja/self-hosting/local-endpoints/text-to-speech/#network-access)を参照してください。

続いてエンドポイントのモデルエントリを追加し、`/config`のモデル > モデルの切り替えから有効化します。

## ペルソナ音声の追加

1. 背景ノイズがほとんどまたはまったくない、話者1人による10〜20秒のクリアな参照クリップを準備します。
2. `/config`でモデル > TTSパラメーターと音声を開き、音声サンプルをアップロードします。
3. 参照クリップで実際に話されている文字起こしを正確に参照テキスト欄へ入力します。
4. `/config`でペルソナ > 音声を開き、そのサンプルをペルソナに割り当てます。
5. `/generate voice-message`で音声メッセージを生成するか、TomoriBotのvoice-messageツールに生成させます。

上流の説明では、通常10〜30秒の参照サンプルから正確にクローンできます。Fish S2 Pro自体のランタイムには参照音声の長さの上限がないため、長いクリップは切り詰められずそのまま受け入れられますが、文書化されているクローン品質は10〜30秒の範囲によるものです。

## 表現制御

Fish S2 Proは、角括弧タグを使って1つの発話の中でも発話の調子を変えられます。例:

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

このエンドポイントは`ブラケットタグ`マークアップを使用するため、TomoriBotは合成前にこれらのタグを取り除かず保持します。

## 設定

| 変数 | 既定値 | 用途 |
|---|---|---|
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | S2 Proチェックポイントのディレクトリ |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | 設定済みチェックポイントのモデルリポジトリおよびヘルスメタデータのラベル |
| `TOMORI_TTS_HOST` | `127.0.0.1` | ラッパーのバインドアドレス。[ネットワークアクセス](/ja/self-hosting/local-endpoints/text-to-speech/#network-access)を参照 |
| `FISH_S2_PORT` | `8015` | Fishラッパーのポート |
| `FISH_S2_UPSTREAM_PORT` | `8025` | 内部Fish APIのポート |
| `FISH_S2_COMPILE` | `0` | Fish Speechの`torch.compile`を有効化（Linux/WSL2とTritonが必要） |
| `FISH_S2_HALF` | `0` | FP16ランタイムモードを要求 |
| `FISH_S2_CHUNK_LENGTH` | `200` | Fishの反復プロンプトのチャンク長 |
| `FISH_S2_TOP_P` | `0.8` | サンプリングのtop-p |
| `FISH_S2_TEMPERATURE` | `0.8` | サンプリング温度 |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | 繰り返しペナルティ |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | 1リクエストあたりに生成される意味トークンの最大数 |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | Fishランタイム内でエンコード済み参照音声をキャッシュ |

### インストーラー変数

`install-fishs2.sh`と`install-fishs2.ps1`が読み込みます。デプロイを再現できるよう、オーバーライドした値は記録しておいてください。

| 変数 | 既定値 | 用途 |
|---|---|---|
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | ダウンロードするHugging Faceのリポジトリ |
| `FISH_S2_MODEL_REVISION` | `main` | ダウンロードするHugging Faceのリビジョン |

参照音声は、デコード後10 MB以下で、空でない非圧縮のPCM RIFF/WAVEファイルである必要があります。この上限は、過大なbase64リクエストが無制限にメモリを消費するのを防ぐため推論前にチェックされ、TomoriBotが送信する22.05 kHzモノラルWAVで約237秒分に相当します。

## 低VRAMオプション (INT8量子化)

制約のあるVRAM (8 ～ 12 GBなど) を備えたGPUで実行していて、公式のBF16チェックポイントに適合できないユーザーは、INT8量子化モデル (`Imagilux/fishaudio-s2-pro`) を選択できます。

INT8チェックポイントをインストールして実行するには:

```bash
# In Linux / WSL2:
export FISH_S2_MODEL_ID="Imagilux/fishaudio-s2-pro"
export FISH_S2_MODEL_DIR="servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
export FISH_S2_MODEL_REVISION="9706ff036580881d87cc09465dd10014527bc481"
bash servers/tts/fishs2/install-fishs2.sh
```

```powershell
# In Windows PowerShell:
$env:FISH_S2_MODEL_ID = "Imagilux/fishaudio-s2-pro"
$env:FISH_S2_MODEL_DIR = "servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
$env:FISH_S2_MODEL_REVISION = "9706ff036580881d87cc09465dd10014527bc481"
.\servers\tts\fishs2\install-fishs2.ps1
```

同じシェルから`server.py`を起動するか、起動前に同じ3つの変数を設定すると、ラッパーはBF16のデフォルトではなくINT8ディレクトリをロードします。

INT8チェックポイントは、オーディオエンベディングとコーデックレイヤーをBF16に維持しながら、トランスの重量を最大10.3 GBから最大5.1 GBに削減し、合計最大10 GBのVRAM内に収まります。
