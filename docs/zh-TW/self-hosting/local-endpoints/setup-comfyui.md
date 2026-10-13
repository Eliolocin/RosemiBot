---
title: "設定：ComfyUI"
sidebar:
  order: 2
aiGenerated: false
---

TomoriBot 可以透過你自己的
[ComfyUI](https://github.com/comfyanonymous/ComfyUI) 執行個體生成圖片與影片。它透過提交一份已代入你的提示詞與尺寸的 API 格式工作流程 來驅動 ComfyUI，接著輪詢
ComfyUI 的 `/history` 端點，直到輸出就緒。

本指南涵蓋安裝、運行 ComfyUI 並註冊它。若想撰寫或編輯 TomoriBot 相容的工作流程（那些 `{TOMORI_*}` 佔位符），請看 Discord 內的深入說明：開啟 `/help`，選擇 `功能`，再選 `自訂端點`，並參考 GitHub 上的
[工作流程 README](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows)。

:::note[不需要環境變數]
ComfyUI 透過 Discord 斜線指令註冊，並以加密形式存在資料庫中。
請看[本機端點總覽](/zh-TW/self-hosting/local-endpoints/)。
:::

## 硬體需求

圖片與影片生成受 GPU 限制：主要成本是 VRAM（你顯示卡的記憶體，與系統 RAM 分開），它取決於你的工作流程載入的模型檢查點，而不是 ComfyUI 本身。強烈建議使用 NVIDIA GPU。TomoriBot 內附的兩套工作流程都是現代、比 SDXL 更重的模型：

| 內附工作流程 | 基礎模型 | 實務上的 VRAM | 備註 |
|---|---|---|---|
| Anima v1（圖片） | Qwen-Image（約 20B），fp8 | 最低約 16 GB，24 GB 較舒適 | 文字編碼器加 VAE 會多出約 8 到 10 GB 的額外負擔。低於 16 GB 時，請用 GGUF 版本加 `--lowvram`。 |
| WAN i2v loop（影片） | Wan 2.2 14B，fp8 加 4 步 LightX2V LoRA | 約 16 GB 可運作，24 GB 以上較舒適 | 最重的選項，每個短片預期要數分鐘。在較小的卡上，把 UMT5 文字編碼器卸載到 RAM（`t5_cpu`，需要 24 GB 以上的系統 RAM）。 |

兩組內附的檢查點都已經以 fp8 量化，以塞進消費級顯卡。如果你的 VRAM 較少，請把 UNET 換成更小的量化，並啟用 ComfyUI 的 `--lowvram` 或 CPU 卸載。純 CPU 的擴散不切實際（每張圖要數分鐘，影片更糟），而且可能超出 TomoriBot 的輪詢視窗，所以實務上要有 GPU 才能常規使用。

:::tip[再往下走：挑一個 GGUF 量化]
量化用更少的位元儲存每個模型權重，以降低 VRAM 與磁碟用量，代價是一點精確度。
內附的 fp8 檔是它的一種溫和形式，想再縮小，就從 Hugging Face 下載該模型的
GGUF 版本：`Q4_K_M` 或 `Q5_K_M` 這類名稱中的代號是每個權重的位元數，而
4 位元（Q4）或 5 位元（Q5）通常是甜蜜點，能保住大部分的品質，足跡卻只有 fp8 與 fp16 的一小部分。低於 4 位元縮得更多，但劣化很快。在 ComfyUI 中載入
GGUF UNET 需要 [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) 自訂
節點。
:::


## 1. 以啟用 API 的方式運行 ComfyUI

依[它的 README](https://github.com/comfyanonymous/ComfyUI) 安裝 ComfyUI，並以監聽網路的方式啟動它：

```sh
python main.py --listen 0.0.0.0 --port 8188
```

如果 TomoriBot 跑在 Docker 或另一台機器上，`--listen 0.0.0.0` 就很重要，因為預設只綁定回送位址。請從 bot 執行所在的那台機器確認可連線：

```sh
curl http://127.0.0.1:8188/system_stats
```

如果你想測試，請載入你選定工作流程所需的模型檢查點，並在 ComfyUI 網頁介面手動生成一次，確認端到端可用之後再接上 TomoriBot。

## 2. 取得一份 TomoriBot 工作流程

下載一份可直接使用的 API 格式工作流程。範例可以在 repo 的
[`assets/comfyui-workflows/`](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows) 底下找到：

| 工作流程 | 模式 |
|----------|-------|
| Anima v1（圖片）：`tomoribot-anima-v1-comfyui.json` | `txt2img`、`img2img`、`inpaint` |
| WAN i2v loop（影片）：`tomoribot-wan-i2v-loop-video.json` | 圖片轉影片 |

這些是 API 格式（ComfyUI 透過 *Save (API Format)* 匯出的 JSON），不是一般的
介面儲存格式。如果你自己撰寫，它必須包含 TomoriBot 會代入的 `{TOMORI_*}` 佔位符（提示詞、寬高、種子、參考圖片等）。請看工作流程
README，以及 `/help` 中 `供應商`底下的 `自訂端點`頁面。

## 3. 在 Discord 註冊它

執行 `/providers`（或 `/personal providers`），選擇 `新增自訂端點`，然後輸入：

| 欄位 | ComfyUI 的值 |
|-------|-------------------|
| `endpoint_label` | 你自訂的名稱，例如 `home-comfy` |
| API Compatibility | `ComfyUI` |
| `endpoint_url` | `http://127.0.0.1:8188`（根路徑，不要加 `/v1`） |
| `auth_token` | *（除非你的 ComfyUI 在驗證後面，否則留空）* |

儲存連線之後，選取它並用它的模型下拉選單加入一個 Image 或 Video
模型。輸入檢查點的確切代號，並上傳你在步驟 2 下載的工作流程 `.json`。模型功能必須與工作流程相符（圖片工作流程 → `image`，影片工作流程 → `video`）。

圖片模型還會詢問它的 `圖片功能`：文字轉圖片、參考圖片、補圖與負向提示詞。只勾選你的工作流程真正實作的功能，因為 Tomori 只會提供你宣告的模式給工具。補圖只會為 ComfyUI 連線出現，因為其他 API 相容性都不接受遮罩。之後編輯模型會以你目前的選擇重新開啟表單，所以變更代號不會清掉它。

加入模型會自動讓它成為作用中的 `image` 或 `video` 模型。在聊天中直接請 Tomori 生成即可觸發。如果它因為某些原因沒有生效，請執行 `/config` > 模型 > 切換模型，然後選取你註冊的 ComfyUI 端點。

## 疑難排解

- 加入時無法連線： ComfyUI 綁定在回送位址，而 bot 在 Docker 裡或另一台主機上。請用 `--listen 0.0.0.0` 啟動它，並使用 `http://host.docker.internal:8188` 或區網 IP。
- 生成一直沒完成： TomoriBot 會輪詢 `/history` 直到輸出出現。冷啟動與在 CPU 上跑大型模型都可能超出輪詢視窗。
- 提示詞或尺寸被忽略，或輸出尺寸錯誤： 工作流程缺少必要的
  `{TOMORI_*}` 佔位符，或者你上傳的是介面格式的匯出，而不是 API 格式。
- 功能錯誤： 註冊在 `video` 底下的 `image` 工作流程（或反過來）不會執行。請在相符的功能底下重新加入它。
