---
title: "Configuración: Codex CLI a través de ChatMock"
sidebar:
  order: 5
---

Conecte TomoriBot a su cuenta ChatGPT a través de un puente local compatible con OpenAI usando [ChatMock](https://github.com/RayBytes/ChatMock).

ChatMock ejecuta un servidor API local que acepta solicitudes estándar de OpenAI, lo que permite al proveedor `custom` de TomoriBot enrutar la finalización del chat a través de su cuenta.

## 1. Iniciar ChatMock

Instale ChatMock siguiendo las instrucciones en el [repositorio ChatMock](https://github.com/RayBytes/ChatMock).

Autenticar e iniciar el servidor local:

```sh
chatmock login
chatmock serve
```

De forma predeterminada, ChatMock escucha en `http://127.0.0.1:8000/v1`.

## 2. Configurar TomoriBot

En Discord, configure el proveedor `custom` de TomoriBot con estas configuraciones:

- **URL del punto final**: `http://127.0.0.1:8000/v1`
- **Nombre del modelo**: el identificador de modelo que espera ChatMock, como `gpt-5.4` o `gpt-5.3-codex`.

Un `http://127.0.0.1:8000` simple también funciona: TomoriBot lo normaliza a `/v1` antes de agregar `/chat/completions`.

Habilita estos indicadores de capacidad para ChatMock:
- **Llamada de funciones/Herramientas**: Sí
- **Comprensión de la imagen**: Sí
- **Comprensión del vídeo**: No
- **Salida estructurada**: Sí

:::note[System prompt handling and port configuration]
Codex CLI no permite mensajes `system` personalizados, por lo que TomoriBot convierte las instrucciones `system` en un giro inicial `user`. Configura `CHATMOCK_PORT` en `.env` para que coincida con su puerto ChatMock (el valor predeterminado es `8000`) para que TomoriBot reconozca el punto final y aplique este ajuste rápido.
:::
