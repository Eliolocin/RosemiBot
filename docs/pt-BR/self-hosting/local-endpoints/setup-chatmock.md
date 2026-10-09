---
title: "Configuração: Codex CLI via ChatMock"
sidebar:
  order: 5
---

Conecte TomoriBot à sua conta ChatGPT por meio de uma ponte local compatível com OpenAI usando [ChatMock](https://github.com/RayBytes/ChatMock).

ChatMock executa um servidor API local que aceita solicitações OpenAI padrão, permitindo que o provedor `custom` de TomoriBot roteie as conclusões do bate-papo por meio de sua conta.

## 1. Iniciar o ChatMock

Instale ChatMock seguindo as instruções no [repositório ChatMock](https://github.com/RayBytes/ChatMock).

Autentique e inicie o servidor local:

```sh
chatmock login
chatmock serve
```

Por padrão, ChatMock escuta em `http://127.0.0.1:8000/v1`.

## 2. Configurar TomoriBot

Em Discord, configure o provedor `custom` de TomoriBot com estas configurações:

- **URL do terminal**: `http://127.0.0.1:8000/v1`
- **Nome do modelo**: o identificador do modelo que ChatMock espera, como `gpt-5.4` ou `gpt-5.3-codex`

Um `http://127.0.0.1:8000` simples também funciona: TomoriBot normaliza-o para `/v1` antes de anexar `/chat/completions`.

Ative estes sinalizadores de capacidade para ChatMock:
- **Chamada de Função/Ferramentas**: Sim
- **Compreensão da imagem**: Sim
- **Compreensão do vídeo**: Não
- **Saída Estruturada**: Sim

:::note[System prompt handling and port configuration]
Codex CLI não permite prompts `system` personalizados, então TomoriBot converte instruções `system` em um turno `user` inicial. Defina `CHATMOCK_PORT` em `.env` para corresponder à sua porta ChatMock (o padrão é `8000`) para que TomoriBot reconheça o terminal e aplique este ajuste de prompt.
:::
