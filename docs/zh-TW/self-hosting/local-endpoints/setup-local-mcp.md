---
title: "設定：本機MCP伺服器"
sidebar:
  order: 6
---

將TomoriBot連接到在本機或專用網路上執行的Model Context Protocol ([MCP](https://modelcontextprotocol.io/)) 伺服器，以提供自訂本機工具。

對於遠端HTTPS伺服器，請參閱[工具和擴充功能](/zh-TW/features/capabilities/tools-and-extensions/#mcp-servers)。本機MCP端點需要自架執行個體：

:::caution[Self-hosting only]
僅自架實例支援本機MCP伺服器。公共託管機器人需要HTTPS並出於安全原因阻止本地/私人位址，因此它無法到達`localhost`或LAN上的伺服器。
:::

## 1. 運行本機MCP伺服器

啟動在本機連接埠上公開HTTP/SSE傳輸的MCP伺服器。例如，許多MCP伺服器透過Node運行：

```sh
npx -y <some-mcp-server> --port 3000
```

確切的命令取決於你正在運行的伺服器。記下它列印的URL和傳輸路徑（通常為`http://localhost:3000/sse`）。

## 2. 在Discord註冊它

開啟`/config` > `外掛` > MCP伺服器，選擇`+ 新增MCP`，將`伺服器URL`欄位設定為本地端點，並將`伺服器類型`保留為其預設`一般用途`設定：

```text
http://localhost:3000/sse
```

將`驗證權杖（選填）`留空：本機伺服器不需要身份驗證令牌。

## 3. 管理它

開啟“配置”頁面並在伺服器行中選擇“`移除`”。確認取消註冊，立即斷開連接，並釋放一個插槽。

## 安全性

:::danger[Only add MCP servers you trust]
如果程式碼不受信任，即使是你自己執行的本機伺服器也可能會出現異常行為。惡意MCP伺服器可以提示注入模型、洩漏傳遞給其工具的數據，或返回TomoriBot將轉發的有害結果。在連接MCP伺服器之前先回顧一下它的功能。
:::

有關在線MCP流程和完整的安全詳細信息，請參閱[工具和擴展](/zh-TW/features/capabilities/tools-and-extensions/#mcp-servers)。
