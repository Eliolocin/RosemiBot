---
title: "セットアップ: ローカル判定モデル"
sidebar:
  order: 7
aiGenerated: true
---

自身のマシンで小規模な判定モデルを実行し、TomoriBotに登録します。判定モデルはテキストに関する質問（はい/いいえ、または複数のトピックのどれが当てはまるかなど）に対して確率を返します。[Kev](https://github.com/jaredpalmer/kev)は、TypeSafeがホストするJevと同じSystem Oneプロトコルを使用するオープンソースモデルです。

:::note[使用先]
`/config` > モデル、または `/config` > プラグイン > Natural Nudges のアクティブナッジチェッカーで選択されると、判定モデルは複数のトピックから1つを選択するよう求められ、[Natural Nudges](/features/chatting-personality/natural-nudges/#active-nudges)がいつ会話に参加するかを決定します。詳細は[判定モデル](/features/setup-administration/providers-and-models/#decision-models)を参照してください。
:::

## 1. Kevを実行する

Kevには[Git](https://git-scm.com)、[uv](https://docs.astral.sh/uv/)、およびPython 3.12または3.13が必要です（uvが自動でインストールします）。GPUに合ったサイズを選択してください：

| モデル | Hub ID | 重み（概算） | 備考 |
|---|---|---|---|
| Kev-0.8B | `jaredpalmer/kev-0.8b` | 2 GB | 4 GBのGPUで動作します。精度は最も低くなります。 |
| Kev-4B | `jaredpalmer/kev-4b` | 8-9 GB | GPUメモリに収まる場合のKevの推奨開始モデルです。 |

KevのREADMEにはCUDA、ROCm、Apple Siliconが挙げられています。以下のWindowsの手順は、NVIDIA GPUを搭載したネイティブWindowsで検証されています。お使いの環境でサーバーが起動しない場合は、WSL2で同じ手順を実行してください。

TomoriBotフォルダーの外側の場所にリポジトリをクローンします：

```powershell
git clone https://github.com/jaredpalmer/kev.git
cd kev
uv sync --extra serve
```

NVIDIA GPUを搭載したWindowsでは、`uv sync`はCPU専用のPyTorchをインストールするため動作が非常に遅くなります。CUDAビルドに置き換えて、GPUが認識されていることを確認してください：

```powershell
uv pip install --reinstall-package torch "torch>=2.6,<2.9" --index-url https://download.pytorch.org/whl/cu128
uv run --no-sync python -c "import torch; print(torch.cuda.is_available())"
```

`True`と出力される必要があります。通常の`uv run`を実行するとCPUビルドに同期し直されてしまうため、以降はKevを`uv run --no-sync`で起動してください。LinuxおよびmacOSでは、代わりに`uv run --extra serve`を使用します。

サーバーを起動します。初回実行時はモデルのダウンロードが行われるため数分かかります：

```powershell
uv run --no-sync python -m kev.serve --run jaredpalmer/kev-4b --port 8009 --device cuda
```

`--device cuda`を指定すると、CPUで警告なしに低速実行される代わりに、GPUを使用できない場合にエラーで停止します。Kev-4Bでメモリ不足になる場合は`jaredpalmer/kev-0.8b`を使用してください。Macでは`--device cuda`を外してください。

サーバーを実行したまま別のPowerShellウィンドウから確認します。最初のコマンドでモデル名が一覧表示され、2番目のコマンドではい/いいえの質問に対して0から1の間の確率が返されます：

```powershell
Invoke-RestMethod http://127.0.0.1:8009/v1/models
$body = '{"state":"The fictional door is blue.","model":"kev-latest","questions":{"q":{"type":"noul","instructions":"Is the door blue?"}}}'
Invoke-RestMethod http://127.0.0.1:8009/v1/systemone -Method Post -ContentType "application/json" -Body $body
```

Kevは`flash-linear-attention`が見つからないという警告を出力しますが、同じ回答を返す低速パスに切り替わるため無視して問題ありません。

## 2. Discordに登録する

`/providers`（サーバー全体）または `/personal providers`（個人専用）を実行し、`Add New Custom Endpoint`を選択して以下を入力します：

| フィールド | 値 |
|---|---|
| `Endpoint Label` | `kev` |
| `Endpoint URL` | `http://127.0.0.1:8009/v1` |
| `API Compatibility` | `System One compatible` |
| `Auth Token` | `KEV_API_KEY`を設定していない場合は空のままにします |

TomoriBotは保存時に`GET /v1/models`を確認します。サーバーが`404`や`405`を返しても受け入れられます。

保存された`kev`エンドポイントを開き、モデルのドロップダウンから`+ 判定モデルを追加`を選択して以下を入力します：

- `Code Name`: `kev-latest`（Kevのサンプルで使用されているモデル名）。
- `Context Window`: `8192`（Kev-0.8BおよびKev-4Bが検証されている最大テキスト長）。Kevは65,536トークンを超えるテキストを拒否します。

## 3. モデルを選択する

`/config` > `モデル` > `モデルの切り替え`を開き、`判定`スロットで`kev-latest`を選択します。`- モデルなし`を選択すると、登録を削除せずに選択を解除できます。

## 注意事項と留意点

- **サーバーの停止**は`Ctrl+C`で行います。TomoriBotがKevを起動または停止することはありません。
- **Docker環境でのTomoriBot**: コンテナー内部の`127.0.0.1`はホストマシンではありません。`http://host.docker.internal:8009/v1`を使用し、Kevを`--host 0.0.0.0`で起動してください。Kevにはデフォルトで認証がないため、あらかじめ`KEV_API_KEY`を設定し、`Auth Token`に同じ値を入力してください。
- **本番ランタイム**: プロバイダーエンドポイントに対してHTTPSを強制し、プライベートアドレスをブロックします。ローカルHTTP URLは`RUN_ENV=development`のときに機能します。[ローカルLLM](/self-hosting/local-endpoints/setup-local-llm/#notes--gotchas)を参照してください。
- **その他のSystem Oneサーバー**: Layaなどは、独自のエンドポイントURLとモデル名を使用して同じ手順で設定できます。OpenAI Decisions APIを実装しているサーバーの場合は、代わりに`OpenAI Decisions compatible`を使用してください。
