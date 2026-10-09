---
title: "配置：通过ChatMock使用Codex CLI"
sidebar:
  order: 5
---

使用 [ChatMock](https://github.com/RayBytes/ChatMock) 通过本地OpenAI兼容桥将TomoriBot连接到你的ChatGPT帐户。

ChatMock运行接受标准OpenAI请求的本地API服务器，允许TomoriBot的`custom`提供商通过你的帐户路由聊天完成。

## 1. 启动ChatMock

按照 [ChatMock存储库](https://github.com/RayBytes/ChatMock) 中的说明安装ChatMock。

验证并启动本地服务器：

```sh
chatmock login
chatmock serve
```

默认情况下，ChatMock监听`http://127.0.0.1:8000/v1`。

## 2、配置TomoriBot

在Discord中，使用以下设置配置TomoriBot的`custom`提供程序：

- **端点URL**：`http://127.0.0.1:8000/v1`
- **型号名称**：期望的型号标识符ChatMock，例如`gpt-5.4`或`gpt-5.3-codex`

裸`http://127.0.0.1:8000`也可以工作：在附加`/chat/completions`之前，TomoriBot将其标准化为`/v1`。

为ChatMock启用这些功能标志：
- **函数调用/工具**：是
- **图像理解**：是
- **视频理解**：否
- **结构化输出**：是

:::note[System prompt handling and port configuration]
Codex CLI不允许自定义`system`提示，因此TomoriBot将`system`指令转换为初始`user`指令。在`.env`中设置`CHATMOCK_PORT`以匹配你的ChatMock端口（默认为`8000`），以便TomoriBot识别端点并应用此提示调整。
:::
