---
title: "圖片生成"
sidebar:
  order: 1
---

TomoriBot可以根據文字提示或編輯參考圖像來產生圖像。使用`/generate image`，或在聊天中描述你想要的內容（「畫一隻喝咖啡的小熊貓」）。

## 她可以做什麼

- **文字到圖像**：根據描述產生圖像。
- **圖像到圖像**：編輯或重新設計現有圖像。
- **修復**：重畫特定區域，同時保留其餘區域。
- **外畫**：將畫布延伸到原始框架之外。
- **可自訂的寬高比**。
- **參考圖像**：從訊息附件、貼圖、表情符號或使用者和人格頭像中提取。提及使用者或人格以將其頭像作為參考。

可用的編輯模式取決於活動後端。文字到圖像和圖像到圖像在雲端供應商（Google、Vertex、OpenRouter）上運作。本地 [ComfyUI](/zh-TW/self-hosting/local-endpoints/setup-comfyui/) 自訂端點支援修復和修復，並且取決於該端點聲明的功能。你的設定不支援的模式會自動從模型中隱藏。

當她生成圖像時，她會將你的人格的外觀標籤與伺服器範圍的正面和負面標籤（如果支援）結合。結果以Discord媒體庫的形式出現，其中包含生成詳細信息，包括任何引用的使用者或人格。

## 標籤自訂
<!-- anchor: tag-customization -->

每個標籤來源都可以使用預填模式進行就地編輯：

- **`/config` > `人格` > 圖像產生詳細資訊**：所選人格的`外觀`標籤（她的外觀）。需要管理伺服器權限。
- **`/personal config`**：你自己的外觀標籤，每當圖像生成引用你時就會套用。跟隨你穿越每台伺服器（請參閱[個人化](/zh-TW/features/knowledge/personalization/)）。
- **`/config` > `模型` > 影像產生預設值**：使用`編輯正向`和`編輯負向`設定新增至每一代或遠離每一代的預設標籤。負標籤僅在後端支援負提示時適用。提交空框將重設為內建預設值。

## 設定

1. 透過`/config` > `模型` > `切換模型`配置影像模型。
2. 在`/config` > `權限` (`imagegen_enabled`) 中啟用影像產生。
3. 在聊天中詢問她，或運行`/generate image`。

## 供應商支援

本機影像生成可在Google、Vertex AI、Vertex AI Express、OpenRouter、Z.ai、NVIDIA NIM和NovelAI（動畫風格）上使用。有關完整的供應商矩陣，請參閱[供應商和模型](/zh-TW/features/setup-administration/providers-and-models/#supported-providers)。

對於透過ComfyUI在你自己的硬體上進行本地生成，請參閱[設定：ComfyUI](/zh-TW/self-hosting/local-endpoints/setup-comfyui/)。
