---
title: "Setup: Codex CLI via ChatMock"
sidebar:
  order: 5
---

Connect TomoriBot to your ChatGPT account through a local OpenAI-compatible bridge using [ChatMock](https://github.com/RayBytes/ChatMock).

ChatMock runs a local API server that accepts standard OpenAI requests, allowing TomoriBot's `custom` provider to route chat completions through your account.

## 1. Start ChatMock

Install ChatMock by following the instructions in the [ChatMock repository](https://github.com/RayBytes/ChatMock).

Authenticate and start the local server:

```sh
chatmock login
chatmock serve
```

By default, ChatMock listens on `http://127.0.0.1:8000/v1`.

## 2. Configure TomoriBot

In Discord, configure TomoriBot's `custom` provider with these settings:

- **Endpoint URL**: `http://127.0.0.1:8000/v1`
- **Model Name**: The model identifier ChatMock expects, such as `gpt-5.4` or `gpt-5.3-codex`

A bare `http://127.0.0.1:8000` also works: TomoriBot normalizes it to `/v1` before appending `/chat/completions`.

Enable these capability flags for ChatMock:
- **Function Calling / Tools**: Yes
- **Image Understanding**: Yes
- **Video Understanding**: No
- **Structured Output**: Yes

:::note[System prompt handling and port configuration]
Codex CLI disallows custom `system` prompts, so TomoriBot converts `system` instructions into an initial `user` turn. Set `CHATMOCK_PORT` in `.env` to match your ChatMock port (defaults to `8000`) so TomoriBot recognizes the endpoint and applies this prompt adjustment.
:::
