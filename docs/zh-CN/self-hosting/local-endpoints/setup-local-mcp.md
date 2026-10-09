---
title: "配置：本地MCP服务器"
sidebar:
  order: 6
---

将TomoriBot连接到在本地计算机或专用网络上运行的Model Context Protocol ([MCP](https://modelcontextprotocol.io/)) 服务器，以提供自定义本地工具。

对于远程HTTPS服务器，请参阅[工具和扩展](/zh-CN/features/capabilities/tools-and-extensions/#mcp-servers)。本地MCP端点需要自部署实例：

:::caution[Self-hosting only]
仅自部署实例支持本地MCP服务器。公共托管机器人需要HTTPS并出于安全原因阻止本地/私有地址，因此它无法到达`localhost`或LAN上的服务器。
:::

## 1. 运行一个本地MCP服务器

启动在本地端口上公开HTTP/SSE传输的MCP服务器。例如，许多MCP服务器通过Node运行：

```sh
npx -y <some-mcp-server> --port 3000
```

确切的命令取决于你正在运行的服务器。记下它打印的URL和传输路径（通常为`http://localhost:3000/sse`）。

## 2. 在Discord里注册它

打开`/config` > `插件` > MCP服务器，选择`+ 添加MCP`，将`服务器URL`字段设置为本地端点，并将`服务器类型`保留为其默认`通用型`设置：

```text
http://localhost:3000/sse
```

将`认证令牌（可选）`留空：本地服务器不需要身份验证令牌。

## 3. 管理它

打开“配置”页面并在服务器行中选择“`移除`”。确认取消注册，立即断开连接，并释放一个插槽。

## 安全

:::danger[Only add MCP servers you trust]
如果代码不受信任，即使是你自己运行的本地服务器也可能会出现异常行为。恶意MCP服务器可以提示注入模型、泄露传递给其工具的数据，或者返回TomoriBot将转发的有害结果。在连接MCP服务器之前先回顾一下它的功能。
:::

有关在线MCP流程和完整的安全详细信息，请参阅[工具和扩展](/zh-CN/features/capabilities/tools-and-extensions/#mcp-servers)。
