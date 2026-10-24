---
title: "設定：本機判斷模型"
sidebar:
  order: 7
aiGenerated: true
---

在自己的機器上執行小型的判斷模型，並將其註冊到 TomoriBot。判斷模型會以機率回答關於文字的問題，例如「是」或「否」，或者幾個主題中哪一個最契合。[Kev](https://github.com/jaredpalmer/kev) 是一個開源的判斷模型，支援 System One 協定，這也是 TypeSafe 託管的 Jev 所使用的相同協定。

:::note[在何處使用]
在 `/config` > 模型 中選取，或在 `/config` > 外掛 > Natural Nudges 中選為主動搭話檢查器後，判斷模型會決定 [Natural Nudges](/features/chatting-personality/natural-nudges/#active-nudges) 何時加入對話，要求它從多個主題中挑選一個。詳見[判斷模型](/features/setup-administration/providers-and-models/#decision-models)。
:::

## 1. 執行 Kev

Kev 需要 [Git](https://git-scm.com)、[uv](https://docs.astral.sh/uv/) 以及 Python 3.12 或 3.13（uv 會自動代為安裝）。選取適合你顯示卡記憶體大小的型號：

| 模型 | Hub ID | 權重（約） | 說明 |
|---|---|---|---|
| Kev-0.8B | `jaredpalmer/kev-0.8b` | 2 GB | 可在 4 GB 記憶體的顯示卡上執行。精確度最低。 |
| Kev-4B | `jaredpalmer/kev-4b` | 8-9 GB | 如果顯示卡記憶體允許，推薦作為 Kev 的首選起步模型。 |

Kev 的 README 列出了 CUDA、ROCm 和 Apple Silicon。底下的 Windows 步驟已在搭載 NVIDIA GPU 的原生 Windows 環境中驗證。如果伺服器無法在你的設定中啟動，請在 WSL2 中執行相同的步驟。

將其複製到 TomoriBot 資料夾之外的任意位置：

```powershell
git clone https://github.com/jaredpalmer/kev.git
cd kev
uv sync --extra serve
```

在搭載 NVIDIA GPU 的 Windows 上，`uv sync` 會預設安裝僅支援 CPU 的 PyTorch，速度極慢。請將其替換為 CUDA 建置版本，並檢查其是否能辨識你的顯示卡：

```powershell
uv pip install --reinstall-package torch "torch>=2.6,<2.9" --index-url https://download.pytorch.org/whl/cu128
uv run --no-sync python -c "import torch; print(torch.cuda.is_available())"
```

輸出必須為 `True`。此後請一律使用 `uv run --no-sync` 啟動 Kev，因為一般的 `uv run` 會重新同步並換回 CPU 建置版本。在 Linux 和 macOS 上，請改用 `uv run --extra serve`。

啟動伺服器。首次執行需要下載模型，因此會耗費數分鐘：

```powershell
uv run --no-sync python -m kev.serve --run jaredpalmer/kev-4b --port 8009 --device cuda
```

`--device cuda` 會使 Kev 在無法使用顯示卡時直接回報錯誤中斷，而不是無訊息地改用 CPU 執行。如果 Kev-4B 耗盡記憶體，請改用 `jaredpalmer/kev-0.8b`。在 Mac 上，請移除 `--device cuda`。

保持其執行，並在另一個 PowerShell 視窗中進行驗證。第一個命令會列出模型名稱，第二個命令會針對是非題傳回一個介於 0 和 1 之間的機率：

```powershell
Invoke-RestMethod http://127.0.0.1:8009/v1/models
$body = '{"state":"The fictional door is blue.","model":"kev-latest","questions":{"q":{"type":"noul","instructions":"Is the door blue?"}}}'
Invoke-RestMethod http://127.0.0.1:8009/v1/systemone -Method Post -ContentType "application/json" -Body $body
```

Kev 會輸出缺少 `flash-linear-attention` 的警告。此時它會採用較慢的處理路徑但輸出完全相同的結果，因此可以略過該警告。

## 2. 在 Discord 中註冊

執行 `/providers`（全伺服器範圍）或 `/personal providers`（僅限個人），選取 `Add New Custom Endpoint`，並輸入：

| 欄位 | 值 |
|---|---|
| `Endpoint Label` | `kev` |
| `Endpoint URL` | `http://127.0.0.1:8009/v1` |
| `API Compatibility` | `System One compatible` |
| `Auth Token` | 保留為空，除非你有設定 `KEV_API_KEY` |

TomoriBot 會在儲存時檢查 `GET /v1/models`。即使伺服器傳回 `404` 或 `405` 仍可被接受。

開啟已儲存的 `kev` 端點，在其模型下拉式選單中選取 `+ 新增判斷模型`，並輸入：

- `Code Name`：`kev-latest`（Kev 範例中使用的模型名稱）。
- `Context Window`：`8192`（Kev-0.8B 和 Kev-4B 已驗證的最大文字長度）。Kev 會拒絕任何超過 65,536 個 token 的請求。

## 3. 選取模型

開啟 `/config` > `模型` > `切換模型`，在 `判斷` 欄位中選取 `kev-latest`。選取 `- 無模型` 可在不刪除註冊的情況下清除設定。

## 注意事項

- **停止伺服器**：按 `Ctrl+C`。TomoriBot 不會為你自動啟動或停止 Kev。
- **TomoriBot 執行在 Docker 中？** 容器內部的 `127.0.0.1` 不是你的主機。請使用 `http://host.docker.internal:8009/v1` 並使用 `--host 0.0.0.0` 啟動 Kev。Kev 預設無登入密碼，因此請先設定 `KEV_API_KEY` 並在 `Auth Token` 中填入相同的值。
- **正式環境執行階段**：強制要求 HTTPS 並封鎖提供者端點使用私人位址。本機 HTTP URL 僅在 `RUN_ENV=development` 時有效。詳見[本機 LLM](/self-hosting/local-endpoints/setup-local-llm/#notes--gotchas)。
- **其他 System One 伺服器**：如 Laya，使用其自身的 URL 和模型名稱遵循相同步驟。如果伺服器實作的是 OpenAI Decisions API，請改選 `OpenAI Decisions compatible`。
