---
title: "Chatterbox TTS"
aiGenerated: true
---

ローカルの [Chatterbox](https://github.com/resemble-ai/chatterbox) テキスト読み上げサーバーを使用して、感情タグを含む英語音声のクローンを作成します。

Chatterboxは、`servers/tts/chatterbox/server.py`を介してローカルで実行されます。デフォルトでは、`[laugh]`や`[sigh]`などのインライン感情イベントタグを備えた高速Chatterbox-Turboモデル (3億5000万パラメーター) になります。また、CPUセットアップ用の軽量Chatterbox-Nanoモデル (1億1000万パラメーター) や、分類子なしのガイダンス (`cfg_weight`) と感情的な`exaggeration`チューニング用の標準0.5Bモデルを構成することもできます。このラッパーは、Chatterbox多言語V3をロードしません。

## セットアップ

TomoriBotリポジトリルート、つまりTomoriBotのクローンを作成したフォルダーから次のコマンドを実行します。

### Windows PowerShell

```powershell
python -m venv servers\tts\chatterbox\.venv
servers\tts\chatterbox\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install numpy
pip install -r servers\tts\chatterbox\requirements.txt
python servers\tts\chatterbox\server.py
```

### Linux/macOS Bash

```bash
python3 -m venv servers/tts/chatterbox/.venv
source servers/tts/chatterbox/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install numpy
python -m pip install -r servers/tts/chatterbox/requirements.txt
python servers/tts/chatterbox/server.py
```

TomoriBotがChatterboxを使用している間は、そのターミナルを開いたままにしてください。デフォルトのエンドポイントURLは`http://127.0.0.1:8011`です。別のポートを使用するように`CHATTERBOX_PORT`を設定します。

### オプション: Chatterbox-Nanoを使う

Nanoでは、`nano=True`ローダー オプションを使用したChatterboxビルドが必要です。上記の通常のセットアップの後、固定されたアップストリームリビジョンを同じ仮想環境にインストールします。コミットハッシュにより、互換性のあるソースバージョンが修正されます。セキュリティを保証するものではありません。このコマンドには`git`が必要で、すでにインストールされているランタイム依存関係が保持されます。

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

次に、ラッパーを開始する前に`CHATTERBOX_FAST_MODEL=nano`を設定します。Turboの変数は未設定のままにしておきます。Windows PowerShellでは、`$env:CHATTERBOX_FAST_MODEL = "nano"`で設定します。LinuxまたはmacOSでは、`CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`を使用します。`/health`応答は`fast_model`を報告するため、ロードされた選択肢を確認できます。NanoとTurboは、同じクローン作成リクエストとサポートされているイベントタグを使用します。どちらも英語のみです。

NanoまたはTurboを使用するには、`/config`高速モデルトグルを有効にしておく必要があります。これを無効にすると、CFGウェイトと誇張チューニング用に標準のChatterbox 0.5Bモデルが選択されます。

### 標準Chatterbox (0.5B CFGおよび誇張あり)

オリジナルの0.5BベースChatterboxモデル (`ChatterboxTTS`) は、サーバー ラッパーに直接組み込まれています。Turboのインラインブラケットイベントタグを、Classifier-Free Guide (`cfg_weight`) と感情的な`exaggeration`を使用したきめ細かいボーカルコントロールに置き換えます。

標準モデルを使用するには:
1. 通常どおりサーバー ラッパーを起動します。
2. Discordで、`/config` > `モデル` > `TTSパラメーターと音声`を実行します。
3. `Fast Model (Turbo)`オプションをオフに切り替えます。
4. 次世代では、ラッパーは標準の0.5Bモデルを遅延ダウンロードしてメモリにロードします。

どちらの値も、`パラメータを編集`モーダルのテキストフィールドです。これらは常に編集可能であり、高速モデルが有効になっている間は無視されることがページに記載されています。
- **`cfg_weight`** (デフォルトは`0.5`): 合成されたオーディオが基準テンポとボーカルスタイルにどの程度準拠しているかを調整します。
- **`exaggeration`** (デフォルト`0.5`): 感情の強さと表現の劇的な抑揚を制御します。

> [！注記]
> 標準のChatterboxは、インラインブラケットイベントタグ (`[laughs]`や`[sigh]`など) をサポートしません。高速モデルのトグルがオフになっている場合、TomoriBotはプロンプトテキストからブラケットタグを自動的に削除します。

## TomoriBotへの登録

エンドポイントのラベルまたはモデル名に`Chatterbox`を含めてください。TomoriBotはその名前（またはそれを含むエンドポイントURL）でのみChatterboxエンドポイントを認識するため、Turboのタグ許可リスト、標準モデルでのタグ除去、`/generate voice-message`のChatterbox専用オプションは、その名前が含まれている場合にのみ適用されます。

`/providers`を実行し、`新しいカスタムエンドポイントを追加`を選んで、音声用のAPI互換性を使用します。

- API互換性: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8011`

接続を保存したら、それを選択し、モデルのドロップダウンから音声モデルを追加します。音声ソースモードには音声クローンを、スクリプトマークアップ形式にはブラケットタグを選び、発話タグが送信の過程で失われないようにします。

エンドポイントの登録とモデルのセットアップには`/providers`を使用します。続いて`/config` > モデル > モデルの切り替えを開き、登録したエンドポイントを選択して有効化してください。

## ペルソナボイスを設定する

1. 1つのスピーカーを使用し、バックグラウンドミュージックを使用しない、きれいな10秒のボイスクリップを準備します。
2. [モデル] > `TTSパラメーターと音声` で`/config`を開き、クリップをアップロードします。
3. [ペルソナ] > `音声` で`/config`を開き、ペルソナと音声サンプルを選択します。

長いクリップはChatterboxに何も追加しませんが、拒否されることもありません。ランタイムはコンディショニングの前に参照を切り捨てるため、ウィンドウを越えたオーディオはアップロード、保存され、その後無視されます ([`tts_turbo.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts_turbo.py)、[`tts.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts.py))。

- 音響プロンプトは、どのバージョンでも最初の10秒間です。
- 音声トークンのコンテキストは、TurboおよびNanoでは最初の15秒、Standardでは6秒です。

これらのウィンドウは、公開されたガイダンスではなく、アップストリームランタイムの定数です。リポジトリのREADMEにはリファレンスクリップの長さが記載されておらず、そのサンプルファイル名は`your_10s_ref_clip.wav`のみです。ランタイムが実際に強制する1つの長さは最小値であり、プロンプトが5秒より長いことを示します。

したがって、実際的な目標は10秒です。これは、音色と配信が設定される音響プロンプトを埋め、10 ～ 15秒間のクリップは、TurboとNanoのみで音声トークンのコンテキストを追加します。話者の埋め込みは依然としてクリップ全体から計算されるため、長くしても話者の識別情報は変化せず、プロンプトのどれだけが未読で破棄されるかのみが変化します。

TurboおよびNanoは、高速モデルの切り替えが有効な場合、`[laugh]`や`[sigh]`などのブラケットイベントタグを使用できます。

## オプションのチューニング

[モデル] > `TTSパラメーターと音声` で`/config`を使用して、Chatterboxリクエストペイロードを調整します。

- 高速モデルの切り替えはデフォルトで有効になっています。TomoriBotは、ラッパーが`ChatterboxTurboTTS.generate(...)`を呼び出す前に、サポートされているTurbo/Nanoイベントタグを保持し、サポートされていないブラケット記述子を削除します。
- `cfg_weight`のデフォルトは`0.5`です。最小値は`0`です。TomoriBotはハード最大値を設定しません。これは、`turbo`が`false`の場合にのみ適用されます。値を低くすると、リファレンスボイスの高速化が遅くなり、値を高くするとリファレンスに強く追従します。
- `exaggeration`のデフォルトは`0.5`です。最小値は`0`です。TomoriBotはハード最大値を設定しません。これは、`turbo`が`false`の場合にのみ適用されます。値を大きくすると、より表現力豊かまたはドラマチックになり、音声の速度が速くなる可能性があります。

サポートされているTurbo/Nanoイベントタグは、`[clear throat]`、`[sigh]`、`[shush]`、`[cough]`、`[groan]`、`[sniff]`、`[gasp]`、`[chuckle]`、および`[laugh]`です。`[excited]`、`[whisper]`、`[smiles]`などのサポートされていない記述子は、TTSに送信されずに削除されます。

`turbo`が無効になっている場合、TomoriBotはテキストをTTSに送信する前にすべてのブラケット記述子を削除し、その後ラッパーは標準の`ChatterboxTTS`モデルを遅延ロードして`model.generate(..., cfg_weight, exaggeration)`を呼び出します。
