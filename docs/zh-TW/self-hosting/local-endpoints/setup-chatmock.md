---
title: "設定：透過ChatMock使用Codex CLI"
sidebar:
  order: 5
---

使用 [ChatMock](https://github.com/RayBytes/ChatMock) 透過本地OpenAI相容橋將TomoriBot連接到你的ChatGPT帳戶。

ChatMock運行接受標準OpenAI請求的本機API伺服器，允許TomoriBot的`custom`供應商透過你的帳戶路由聊天完成。

## 1. 啟動ChatMock

依照 [ChatMock儲存庫](https://github.com/RayBytes/ChatMock) 中的說明安裝ChatMock。

驗證並啟動本機伺服器：

```sh
chatmock login
chatmock serve
```

預設情況下，ChatMock監聽`http://127.0.0.1:8000/v1`。

## 2、配置TomoriBot

在Discord中，使用下列設定配置TomoriBot的`custom`供應商：

- **端點URL**：`http://127.0.0.1:8000/v1`
- **型號名稱**：期望的型號識別碼ChatMock，例如`gpt-5.4`或`gpt-5.3-codex`

裸`http://127.0.0.1:8000`也可以工作：在附加`/chat/completions`之前，TomoriBot將其標準化為`/v1`。

為ChatMock啟用這些功能標誌：
- **函數呼叫/工具**：是
- **圖像理解**：是
- **影片理解**：否
- **結構化輸出**：是

:::note[System prompt handling and port configuration]
Codex CLI不允許自訂`system`提示，因此TomoriBot將`system`指令轉換為初始`user`指令。在`.env`中設定`CHATMOCK_PORT`以符合你的ChatMock連接埠（預設為`8000`），以便TomoriBot識別端點並套用此提示調整。
:::
