---
title: "影片生成"
sidebar:
  order: 2
---

TomoriBot可以根據文字提示或透過對現有圖像進行動畫處理來產生短影片。使用`/generate video`，或直接在聊天中詢問她。

## 她可以做什麼

- **文字轉影片**：根據描述產生短片。
- **圖像到影片**：將圖像動畫化。引用訊息中的第一個影像成為起始幀。
- **循環圖像到視訊**：當透過聊天請求時，支援的模型可以重複使用起始圖像作為最終幀。
- **可自訂的寬高比**。

影像到視訊和循環取決於所選模型的第一幀和最後一幀支援。TomoriBot在提交產生之前檢查OpenRouter的模型目錄，並提示你是否需要為所選模型刪除影像或循環。

產生影片需要時間：TomoriBot將作業提交給供應商，在後台檢查是否完成，並在準備好後將完成的影片發佈到頻道。

## 設定

1. 在「`/config` > `模型` > 切換型號」中選擇影片型號。
2. 確認`/config` > `權限` (`video_generation_enabled`) 中啟用了影片產生。
3. 在聊天中詢問她，或運行`/generate video`。

## 供應商支援

本機影片產生功能可在Google、OpenRouter和Z.ai上使用。請參閱[供應商和模型](/zh-TW/features/setup-administration/providers-and-models/#supported-providers) 中的完整矩陣。

透過ComfyUI產生本機視訊（例如WAN影像到視訊工作流程），請參閱[設定：ComfyUI](/zh-TW/self-hosting/local-endpoints/setup-comfyui/)。

內部生成和輪詢架構，請參閱[視訊產生](/en/architecture/subsystems/video-generation/)上的參考。
