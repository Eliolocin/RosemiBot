---
title: "供應商與模型"
sidebar:
  order: 1
---

TomoriBot連接到外部AI供應商，而不是託管內建模型。你可以連接Google Gemini、OpenRouter和NovelAI等託管服務，或將其指向本機自架端點。你至少需要一位供應商才能開始聊天。

## API金鑰
<!-- anchor: api-keys -->

在首次設定期間使用`/setup`新增供應商金鑰，或稍後透過選擇`+ Add new Provider`從`/providers`新增供應商金鑰。金鑰在靜態時進行加密，因此任何人（包括伺服器管理員）都無法讀回它們。

`/setup`詢問回覆應該如何先到達模型，答案決定它收集的內容：

| 模式 | 它收集什麼 |
|---|---|
| 人工智慧供應商（推薦） | 目錄中的供應商及其API金鑰，已作為草稿進行驗證和加密。|
| 自訂端點（進階） | 端點連接和一個文字模型，在嚮導內註冊。請參閱[自訂端點](#custom-endpoints)。|
| 使用者BYOK（僅限公會） | 什麼都沒有：工作區不保留自己的供應商，因此會員必須提供個人供應商。|

在你按`完成設定`之前，不會將任何內容寫入資料庫。廢棄或過期的嚮導不會影響工作區的現有提供程序行。若要取代現有金鑰，請使用`/providers`，因為`/setup`不會在已設定的工作區上執行。

每個供應商都有自己的密鑰產生步驟。在`/help`中，選擇`設定`，然後選擇`取得API金鑰`，然後選擇你的供應商進行逐步演練，或使用以下起點：

| 供應商 | 筆記 | 取得鑰匙 |
|---|---|---|
| Google雙子座 | 免費套餐，運行所有功能。建議先設定。| [AI工作室](https://aistudio.google.com/apikey) |
| OpenRouter | 一鍵，多種型號（部分免費）。| [OpenRouter鍵](https://openrouter.ai/settings/keys) |
| NovelAI | 訂閱;未經審查的講故事和角色扮演（僅限文本）。| [NovelAI](https://novelai.net/) |
| 深度搜尋 | 即用即付推理模型。| [DeepSeek](https://platform.deepseek.com/api_keys) |
| NVIDIA NIM | 託管文字、嵌入和圖像。| [NVIDIA建置](https://build.nvidia.com/) |
| 人擇 | 透過API進行克勞德模型（不是克勞德代碼）。| [人擇](https://console.anthropic.com/) |
| Z.ai | GLM家族。⚠️ ToS將使用限制於編碼和代理場景。| [Z.ai](https://z.ai/) |
| Vertex AI | 透過`gcloud` ADC的Google雲端（最適合本地運行或開發設定）。| 見下文 |
| Vertex AI Express | Google雲端API-金鑰BYOK（預覽版，Gemini子集）。| [快速模式](https://console.cloud.google.com/expressmode) |
| 風俗 | 任何OpenAI相容端點（Ollama、vLLM、LiteLLM，...）。| 請參閱[自訂端點](#custom-endpoints) |

:::caution
切勿與其他人分享你的API金鑰。從`/providers`中的`編輯端點`操作新增或取代自訂端點的承載身分驗證令牌。
:::

Vertex AI使用應用程式預設憑證 (ADC) 而不是儲存的機密進行身份驗證。對於本機託管，ADC可以來自`gcloud`；託管部署應使用工作負載身分或服務帳戶。AI Studio API金鑰單獨無法驗證完整的Vertex AI。所選的Google雲端專案必須啟用計費和Vertex AI API，且主機身分需要Vertex存取權限。設定指南可從`/help`中的`API Keys`頁面上的Google Vertex AI取得。

Google支援的供應商設定透過經過驗證的模型清單端點來驗證憑證。它不會生成文本，也不依賴當前標記為目錄預設值的聊天模型，因此已停用的預設模型無法阻止保存有效憑證。

### 選用：Brave Search金鑰

Brave Search與你的AI供應商分開，並透過圖像、影片和新聞結果增強網路搜尋。設定為`/providers`。⚠️ Brave包含每月5美元的免費信用，因此請在Brave儀表板中設定5美元的使用限額，以避免意外收費。

## 選擇模型

使用`/providers`管理伺服器憑證、模型目錄和端點註冊。然後使用`/config` > `模型` > 交換器模型來選擇伺服器的每個成員所使用的共用功能分配。這兩個命令都需要伺服器管理權限。

個人成員使用`/personal providers`管理自己的憑證和目錄，然後在`/personal config`中選擇個人模型。個人設定遵循他們使用TomoriBot的每台伺服器。使用者設定請參考[個人化](/zh-TW/features/knowledge/personalization/#your-own-providers)。

面板的標題為`伺服器供應商`和`個人供應商`，因此開啟時所有權很明確。

在`/config` > `模型` > 交換器模型中，你可以跨八個功能槽分配模型和端點：

- **文字**：主要聊天模型。
- **視覺**：當聊天模型無法讀取影像時。
- **嵌入**：為[文件知識庫](/zh-TW/features/knowledge/memory/#document-knowledge-base-rag)提供支援。
- **標準影像**：標準影像產生（請參閱[影像生成](/zh-TW/features/capabilities/media-generation/image-generation/)）。
- **NovelAI圖片**：NovelAI影像生成。
- **影片**：影片產生。
- **TTS端點**：文字轉語音語音端點。
- **STT端點**：語音到文字的音訊轉錄端點。

前六個槽選擇模型目錄記錄。TTS和STT插槽改為選擇工作區範圍的端點，啟動選定的端點而不是編寫模型列。在`/providers`中註冊並編輯這些端點。`/personal config`保留6個個人模型路由插槽，不包含個人TTS/STT端點選擇器。

你也可以管理`/providers`中的自動故障轉移和負載平衡的備份金鑰。

## 判定模型
<!-- anchor: decision-models -->

判定模型是 `/providers` 與 `/personal providers` 中的一個獨立類別。它們以機率形式回答具型別的謂詞。註冊不會改變進行中的聊天模型、建立校準或啟用回覆審查略過。這些面板尚無法選擇判定模型。

OpenRouter 是受支援的原生提供商。儲存其金鑰，開啟其模型下拉選單，然後選擇 `+ 新增判定模型`。從其已驗證的判定目錄中輸入 ID。全域目錄包含 `typesafe/jev-1.13`；其他註冊歸屬於其伺服器或個人擁有者。原生探索提供記載的輸入限制與價格。聊天目錄無法建立判定支援。

若為自訂服務，選擇 `新增自訂端點`，然後在 `API 相容性` 中選擇 `相容 System One` 或 `相容 OpenAI Decisions`。儲存 API 基底 URL 與選用的 Bearer 憑證。其模型下拉選單提供 `+ 新增判定模型` 並繼承該通訊協定。輸入記載的模型 ID 與輸入 token 限制（至少 512）。Jev、Laya 和 Kev 使用 System One 相容性。現有的聊天相容與 Ollama 原生端點不提供此操作。

裸來源標準化為 `/v1`。明確的版本與閘道前置詞保持不變：`https://decision.example.invalid/gateway/v1` 在 System One 下呼叫 `/gateway/v1/systemone`，在 OpenAI Decisions 下呼叫 `/gateway/v1/decisions`。可達性檢查使用 `GET <stored-base>/models` 且不傳送對話資料；它不證明模型能力。當自動探索無法建立必要的能力中繼資料時，自訂模型將根據其服務文件手動註冊。

開啟已儲存的判定註冊即可對其進行編輯。自訂編輯會保留其確切的模型與端點身分。在 `註冊操作` 下選擇 `刪除此判定註冊` 可以在保留連線與憑證的同時將其移除。移除其父提供商或端點會移除該擁有者的註冊。其他擁有者保留共用項目。模型列表在達到 18 個可編輯註冊後使用現有頁面控制項進行分頁。

提供商註冊與憑證保留在預設/設定匯出與匯入之外。重設設定會保留儲存的註冊；刪除父項會明確清理它們。

## 自訂端點
<!-- anchor: custom-endpoints -->

自訂端點可讓你將自架或代理支援的服務（Ollama、LM Studio、LiteLLM、vLLM、ComfyUI、本機TTS/STT）註冊為標記的供應商捆綁包。

- **伺服器範圍**：開啟`/providers`進行工作區端點註冊和編輯。
- **個人範圍**：開啟`/personal providers`以取得個人模型目錄（請參閱[個人化](/zh-TW/features/knowledge/personalization/#your-own-providers)）。個人語音端點不是從`/personal config`中選擇的。

標籤是面向使用者的選單名稱，當它們共用一個端點URL時，會將功能分組到一個捆綁包中。它永遠不會發送到遠端服務。從不同URL提供的功能需要不同的標籤。

新增自訂端點：

1. 在`/providers`中，選擇`Add New Custom Endpoint`。
2. 選擇API相容性並儲存連線。保存準備該協議支援的功能，而無需註冊任何模型。
3. 選擇新端點並使用其模型下拉清單來註冊準確的模型程式碼和功能。添加模型會啟動它的該功能。
4. 使用相同的下拉式選單附加更多模型或編輯現有註冊。文字模型以這種形式聲明自己的功能，圖像模型聲明它們支援哪些請求模式。

對於TTS和STT，在`/providers`中註冊終端機及其型號，然後在`/config` > `模型` > 切換型號中選擇並啟動終端。這些語音槽選擇端點而不是模型目錄條目。

API相容性決定了服務實現的請求路徑和有效負載，因此它也決定了連線準備哪些功能槽。為這些插槽註冊確切的模型是一個單獨的步驟，因為無法僅從端點URL可靠地推斷出協定。

`/setup`的`自訂端點（進階）`模式在精靈中執行相同的兩個步驟：`設定連線`在可達性檢查後面保存API相容性、標籤、URL和可選的身份驗證令牌，`設定文字模型`註冊確切的文字模型及其功能聲明。模型按鈕保持停用狀態，直到連線驗證為止，重新儲存連線會清除模型聲明，因為聲明取決於API相容性。當你按`完成設定`時，精靈會同時建立連線、已儲存的供應商、模型和活動模型行。此嚮導僅註冊文字模型；圖像、視訊、TTS和STT功能註冊在`/providers`中。

OpenCode Go (`https://opencode.ai/zen/go/v1`) 和OpenCode Zen (`https://opencode.ai/zen/v1`) 作為OpenAI相容的自訂端點。TomoriBot向它們發送所需的每次對話會話ID，該ID源自通道和人格的雜湊值，因此Discord ID不會離開機器人。

有關運行本機伺服器的完整演練，請參閱：

- [設定：本機LLM](/zh-TW/self-hosting/local-endpoints/setup-local-llm/)：Ollama、KoboldCPP、LM Studio、vLLM、LiteLLM。
- [Setup: ComfyUI](/zh-TW/self-hosting/local-endpoints/setup-comfyui/)：本機影像與影片產生。
- [設定：ChatMock](/zh-TW/self-hosting/local-endpoints/setup-chatmock/)：ChatGPT帳戶或Codex CLI。

## 支援的供應商
<!-- anchor: supported-providers -->

如果你沒有硬體來託管自己的模型，TomoriBot支援廣泛的雲端服務。並非每個供應商都提供所有功能。

### LLM供應商

| 供應商 | 串流媒體 | 工具調用 | 影像輸入 | 嵌入 | 筆記 |
|---|---|---|---|---|---|
| Google雙子座 | ✅ | ✅ | ✅ | ✅ | 提供免費模型 |
| OpenRouter | ✅ | ✅ | ✅ | ✅ | 提供免費模型 |
| 人擇 (API) | ✅ | ✅ | ✅ | - | 不是克勞德·代碼 |
| NovelAI | ✅ | ✅ | - | - | 只有GLM 4.6可以使用工具 |
| NVIDIA NIM | ✅ | ✅ | ✅ | ✅ | 提供免費模型 |
| 深度搜尋 | ✅ | ✅ | - | - | - |
| Z.ai | ✅ | ✅ | ✅ | - | 免費模型； ⚠️ ToS = 僅限編碼和代理使用 |
| Z.ai編碼 | ✅ | ✅ | - | - | 認購計劃 |
| Google Vertex AI | ✅ | ✅ | ✅ | ✅ | 包括「免費」Express版本 |
| Codex CLI（透過ChatMock） | ✅ | ✅ | ✅ | - | [設定](/zh-TW/self-hosting/local-endpoints/setup-chatmock/) |

### 圖片生成

| 供應商 | 文字轉圖像 | 影像到影像 | 修復 | 筆記 |
|---|---|---|---|---|
| Google | ✅ | ✅ | - | - |
| OpenRouter | ✅ | ✅ | - | - |
| NovelAI | ✅ | ✅ | ✅ | 可以與其他供應商結合 |
| 英偉達 | ✅ | - | - | 僅文字到圖像；參考圖像被忽略 |
| Z.ai | ✅ | - | - | - |

這些是供應商的圖像模型的起始預設值。NovelAI通過它自己的管道而不是這個表來運行。透過`/providers`註冊圖像模型，你可以聲明該模型自己的模式，這就是你在ComfyUI工作流程或API支援屏蔽編輯的供應商模型上啟用修復的方式。你從未聲明的模型將繼續遵循上述預設值。僅聲明模型支援的內容：TomoriBot僅為你選擇的模式提供工具，不支援的模式將在生成時失敗。

### 影片生成

| 供應商 | 文字轉視頻 | 影像轉視頻 | 筆記 |
|---|---|---|---|
| Google | ✅ | ✅ | 非同步輪詢工作流程 |
| OpenRouter | ✅ | ✅ | 非同步輪詢工作流程 |
| Z.ai | ✅ | ✅ | 非同步輪詢工作流程 |

### 語音與音訊

| 供應商 | 文字轉語音 | 語音轉文本 |
|---|---|---|
| ElevenLabs | ✅ | ✅ |

本機語音引擎包含在[自架](/zh-TW/self-hosting/) 中。內建的網路搜尋和URL讀取，請參閱[工具和擴充功能](/zh-TW/features/capabilities/tools-and-extensions/#web-search--url-reading)。
