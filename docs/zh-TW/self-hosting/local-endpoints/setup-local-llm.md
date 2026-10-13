---
title: "設定：本機 LLM"
sidebar:
  order: 1
aiGenerated: false
---

TomoriBot 可以使用任何 OpenAI 相容的本機 LLM 伺服器進行文字生成與嵌入。
本指南以 Ollama 為例逐步說明，因為它最容易上手。

等你站穩腳步之後，可以考慮更有彈性的伺服器，例如
[KoboldCPP](https://github.com/LostRuins/koboldcpp)，並直接從
[Hugging Face](https://huggingface.co) 取用開源模型，因為挑選與試玩社群製作的各種模型，正是自己跑 AI 的一半樂趣。

:::note[不需要環境變數]
本機模型透過 Discord 斜線指令註冊，並以加密形式存在資料庫中。它們沒有 `.env` 設定。請看[本機端點總覽](/zh-TW/self-hosting/local-endpoints/)。
:::

## 1. 運行你的模型伺服器

安裝 [Ollama](https://ollama.com)。底下的範例使用 Google 的 Gemma 4，但 [Ollama 的模型庫](https://ollama.com/library)裡任何模型都可以。

### 我該拉取哪個大小？

本機模型跑在你 GPU 的 VRAM（顯示卡內建的記憶體，與系統 RAM 分開）裡。經驗法則：模型至少需要等於它下載大小的可用 VRAM，再加上約 1 到 2 GB 的餘裕給對話脈絡。挑一個你的卡跑得動、最大的 Gemma 4：

| 你的 GPU VRAM | 最合適 | 下載大小（約） |
|---|---|---|
| ~8 GB | `gemma4:e2b` | 7.2 GB |
| ~12 GB | `gemma4:12b` | 7.6 GB |
| ~16 GB | `gemma4:12b`（可完整載入）或 `gemma4:26b` | 7.6 / 18 GB |
| 24 GB+ | `gemma4:26b` 或 `gemma4:31b` | 18 / 20 GB |

下載大小是 Ollama 預設量化的大小；確切數字請看
[模型頁面](https://ollama.com/library/gemma4)。不確定自己有多少 VRAM 嗎？Windows 上：工作管理員 → 效能 → GPU，看「專用 GPU 記憶體」。

:::tip[為什麼 26B 能超越它的大小]
`gemma4:26b` 是混合專家（MoE）模型：它裝載許多「專家」子網路，但每個 token 只啟用約 4B 參數。所以即使它約 18 GB 的權重*差一點*塞不進 16 GB，溢出到系統 RAM 的那一小部分幾乎不會拖慢它，不像同樣大小的稠密模型。這就是它能在許多 16 GB 的卡上愉快運行的原因。
:::

拉取你選的大小並啟動伺服器：

```sh
ollama pull gemma4:12b     # swap for the tag that fits your VRAM
ollama serve               # listens on http://127.0.0.1:11434
```

確認從 TomoriBot 執行所在的那台機器可以連到它：

```sh
curl http://127.0.0.1:11434/v1/models
```

記下實際安裝的標籤，因為那會是你註冊的 Model Name：

```sh
ollama list
# NAME              ID            SIZE
# gemma4:12b        a1b2c3d4...   7.6 GB
```

## 2. 在 Discord 註冊它

執行 `/providers`（伺服器範圍）或 `/personal providers`（只有你自己），選擇 `新增自訂端點`，然後輸入：

| 欄位 | Ollama 的值 |
|-------|------------------|
| `endpoint_label` | 你自訂的名稱，例如 `home-ollama` |
| API Compatibility | `OpenAI-Compatible`（推薦）或 `Ollama` |
| `endpoint_url` | OpenAI-Compatible 用 `http://127.0.0.1:11434/v1`，Ollama 用 `http://127.0.0.1:11434` |
| `auth_token` | *（留空）* |

:::tip[挑一個與 API 相容性相符的 URL]
`OpenAI-Compatible` 與 `Ollama` 都接受單純的根路徑，並將它正規化為 `/v1` 基底。
`/chat/completions` 會自動附加，所以不要自己加上去。已經帶有路徑的 URL，例如
`https://openrouter.ai/api/v1` 或閘道前綴，會原樣儲存。
:::

儲存連線之後，選取它並從它的模型下拉選單選擇 `+ 新增文字模型`。填入：

- Model Name（確切的 API ID）： `gemma4:12b`，也就是 `ollama list` 裡的確切標籤。
- Context Window Override： 選填，僅限 Ollama 與 KoboldCPP。設定它（例如 `8192`、
  `16384`）以調高 Ollama 的預設 `num_ctx`，否則它小得足以截斷 TomoriBot 的長脈絡。留空則使用伺服器預設值。
- 各種開關：如果模型支援函式呼叫就開啟 `工具呼叫`；只有視覺模型才開啟 `圖片輸入`；模型能好好處理 JSON 結構描述時開啟 `結構化輸出`。以我們的例子來說，Gemma 4 全都支援，所以全部勾選。

TomoriBot 會在你儲存時驗證連線。如果它回報端點無法連線，常見原因是 `localhost` 與 Docker 不一致，或 `/v1` 缺少或多了（請看
[常見陷阱](#notes--gotchas)）。

加入模型會自動讓它成為作用中的 `text` 模型，直接開始聊天就能試。如果它因為某些原因沒有生效，請執行 `/config` > 模型 > 切換模型，然後選取你新註冊的模型。

註冊永遠不會變更 `text` 以外的任何模型。如果你勾了 Image Understanding，讓這個端點能當作看不懂圖片的聊天模型的視覺輔助，請用 `/config` > 模型 > 切換模型明確選取它；所有你開啟該開關並註冊的文字端點都會出現在那裡。注意視覺模型只有在聊天模型看不見圖片時才會被諮詢，所以在支援視覺的聊天模型後面設定一個視覺模型，在你切換過去之前沒有任何效果。

## 3.（選用）RAG 用的本機嵌入

選取已儲存的端點，並用它的模型下拉選單加入一個 Embedding 模型（例如
`ollama pull nomic-embed-text`，Model Name 為 `nomic-embed-text:latest`）。RAG 功能還需要在 Postgres 安裝
pgvector。你可以看[手動設定](/zh-TW/self-hosting/manual-setup/)指南。

## 其他伺服器

這些全都使用同一套流程，只有 URL 與幾點注意事項不同。

### KoboldCPP

- 啟動時開啟 OpenAI 相容（內建）。預設：`http://127.0.0.1:5001/v1`。
- API Compatibility：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:5001/v1`。
- 與 Ollama 一樣支援 `脈絡視窗覆寫`。
- 載入 GGUF 模型；Model Name 就是已載入模型回報的名稱（通常是檔名主幹），請檢查 KoboldCPP 的 `/v1/models` 回應。

### llama.cpp（`llama-server`）

- 建置或安裝 [llama.cpp](https://github.com/ggml-org/llama.cpp)，然後用它內附的 OpenAI 相容伺服器提供 GGUF：
  ```sh
  llama-server -m model.gguf -c 16384 --host 0.0.0.0 --port 8080
  ```
- API Compatibility：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:8080/v1`。
- 在啟動時用 `-c` 設定脈絡視窗，那是表單的 `脈絡視窗覆寫` 只支援 Ollama 與 KoboldCPP，在這裡沒有作用。
- Model Name 就是 `/v1/models` 回報的內容；用 `--alias my-model` 給它一個乾淨的名字。
- 如果你用 `--api-key` 啟動它，請把該金鑰放進 `auth_token`。

### LM Studio

- 在 LM Studio 中啟動 Local Server（Developer 分頁）。預設：`http://127.0.0.1:1234/v1`。
- API Compatibility：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:1234/v1`。
- Model Name 就是 LM Studio 對已載入模型顯示的識別字。

### vLLM

- 用 OpenAI 相容伺服器提供服務：`vllm serve <model>` → `http://127.0.0.1:8000/v1`。
- API Compatibility：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:8000/v1`。
- 如果你用 `--api-key` 啟動 vLLM，請把該金鑰放進 `auth_token`。
- Model Name 就是伺服中的模型路徑或名稱（與 `/v1/models` 相符）。

### LiteLLM（多後端代理）

- 運行 LiteLLM 代理；預設：`http://127.0.0.1:4000/v1`。
- API Compatibility：`OpenAI-Compatible`。`endpoint_url`：`http://127.0.0.1:4000/v1`。
- Model Name 就是你在 LiteLLM 設定中定義的模型別名。
- 如果代理強制要求主金鑰，請將它設進 `auth_token`。

### ChatMock（ChatGPT 帳號與 Codex CLI）

因為有系統提示詞的變通做法，它有自己專屬的指南：
[設定：ChatMock](/zh-TW/self-hosting/local-endpoints/setup-chatmock/)。

## 從 Hugging Face 挑模型

除了 Ollama 精選的模型庫，[Hugging Face](https://huggingface.co) 還託管成千上萬的
社群模型。KoboldCPP、llama.cpp 與 LM Studio 都能載入 GGUF 格式，那是一種單檔包裝，你下載之後把伺服器指向它就好。

1. 找一個 GGUF。 在 Hugging Face 搜尋你的模型加上「GGUF」，像
   [bartowski](https://huggingface.co/bartowski) 這樣的社群量化者，會在大多數熱門模型發布後不久就推出 GGUF 版本。優先選 instruct 或 chat 變體（名稱以 `-Instruct` 或
   `-Chat` 結尾）；基礎模型不會跟你對話。
2. 挑一個塞得進你 VRAM 的量化。 同一個 repo 會列出同一個模型的多種量化等級，而
   檔案大小大約等於它需要的 VRAM（再加上約 1 到 2 GB 給脈絡，與上面的
   [大小對照表](#which-size-should-i-pull)同一套規則）。下載你選定的那一個 `.gguf`。
3. 載入它。 用那個檔案啟動 KoboldCPP 或 `llama-server`（請看
   [其他伺服器](#other-servers)），然後照常到 Discord 註冊端點。

:::tip[該選哪個量化？Q4 或 Q5 是甜蜜點]
量化用更少的位元儲存每個權重以縮小模型，代價是一點品質。
`Q4_K_M` 或 `Q5_K_M` 這類名稱中的代號是每個權重的位元數：4 位元（Q4）或 5 位元（Q5）
通常是甜蜜點，能保住大部分的品質，大小卻大約只有 8 位元的一半。低於 4 位元會快速劣化。而且在固定的 VRAM 預算下，較大模型跑 Q4 通常勝過較小模型跑 Q8。
:::

## 注意事項與常見陷阱

- 每個標籤一個端點項目。 要在共用同一台伺服器的多個模型上註冊，請選取已儲存的端點，再次使用它的模型下拉選單。真正不同的伺服器或 API 協定，才使用不同的標籤。
- Model Name 是 API 識別字。 它是送到伺服器的確切字串。填錯是最常見的「連得上但回覆失敗」原因。
- TomoriBot 跑在 Docker 裡嗎？ 容器內的 `localhost` 不是你的主機。請用
  `http://host.docker.internal:<port>`（Windows 與 macOS）或主機的區網 IP，並把
  模型伺服器綁定到 `0.0.0.0`。
