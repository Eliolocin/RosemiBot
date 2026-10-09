---
title: "Configuración: LLM local"
sidebar:
  order: 1
aiGenerated: false
---

Esta traducción se proporciona para tu comodidad. La versión en inglés es la autoritativa.

TomoriBot puede usar cualquier servidor LLM local compatible con OpenAI para la generación de texto y embeddings.
Esta guía recorre el proceso usando Ollama como ejemplo porque es el más fácil para comenzar.

Una vez que te hayas familiarizado, considera un servidor más flexible como
[KoboldCPP](https://github.com/LostRuins/koboldcpp) y usa modelos de código abierto directamente de
[Hugging Face](https://huggingface.co), ya que elegir y probar diferentes modelos creados por la comunidad
es la mitad de la diversión de ejecutar tu propia IA.

:::note[No env vars needed]
Los modelos locales se registran mediante comandos de barra en Discord y se almacenan encriptados en la
base de datos. No hay una configuración `.env` para ellos. Consulta el [centro de endpoints locales](/es-419/self-hosting/local-endpoints/).
:::

## 1. Ejecuta tu servidor de modelos

Instala [Ollama](https://ollama.com). Los ejemplos a continuación usan Gemma 4 de Google, pero cualquier cosa en la [biblioteca de Ollama](https://ollama.com/library) funciona.

### ¿Qué tamaño debo descargar?

Los modelos locales se ejecutan en la VRAM de tu GPU (la memoria integrada en tu tarjeta gráfica, separada
de la RAM de tu sistema). Regla general: un modelo necesita al menos su tamaño de descarga libre en
VRAM, más ~1-2 GB de margen para el contexto de la conversación. Elige el Gemma 4 más grande que
quepa en tu tarjeta:

| Tu VRAM de GPU | Mejor ajuste | Descarga (aprox.) |
|---|---|---|
| ~8 GB | `gemma4:e2b` | 7.2 GB |
| ~12 GB | `gemma4:12b` | 7.6 GB |
| ~16 GB | `gemma4:12b` (cabe completamente), o `gemma4:26b` | 7.6 / 18 GB |
| 24 GB+ | `gemma4:26b` o `gemma4:31b` | 18 / 20 GB |

Las descargas son los tamaños de cuantización predeterminados de Ollama; consulta la
[página del modelo](https://ollama.com/library/gemma4) para ver las cifras exactas. ¿No estás seguro de cuánta VRAM tienes?
En Windows: Administrador de tareas → Rendimiento → GPU, lee "Memoria dedicada de GPU".

:::tip[Why 26B can beat its size]
`gemma4:26b` es un modelo de Mezcla de expertos (MoE): contiene muchas subredes "expertas" pero
activa solo ~4B de parámetros por token. Por lo tanto, aunque sus ~18 GB de pesos no *caben*
del todo en 16 GB, el pequeño desbordamiento a la RAM del sistema apenas lo ralentiza a diferencia de un modelo denso de la
misma huella. Por eso se ejecuta felizmente en muchas tarjetas de 16 GB.
:::

Descarga el tamaño que elegiste e inicia el servidor:

```sh
ollama pull gemma4:12b     # cambia por la etiqueta que quepa en tu VRAM
ollama serve               # escucha en http://127.0.0.1:11434
```

Confirma que es accesible desde la máquina en la que se ejecuta TomoriBot:

```sh
curl http://127.0.0.1:11434/v1/models
```

Anota la etiqueta exacta instalada, ya que este es el nombre del modelo que registrarás:

```sh
ollama list
# NOMBRE              ID            TAMAÑO
# gemma4:12b        a1b2c3d4...   7.6 GB
```

## 2. Regístralo en Discord

Ejecuta `/providers` (en todo el servidor) o `/personal providers` (solo tú), elige
`+ Agregar nuevo punto de conexión personalizado` e ingresa:

| Campo | Valor para Ollama |
|-------|-------------------|
| `endpoint_label` | Un nombre que elijas, ej. `home-ollama` |
| Compatibilidad de API | `OpenAI-Compatible` (recomendado) u `Ollama` |
| `endpoint_url` | `http://127.0.0.1:11434/v1` para OpenAI-Compatible · `http://127.0.0.1:11434` para Ollama |
| `auth_token` | *(déjalo en blanco)* |

:::tip[Pick the URL that matches the API compatibility]
`OpenAI-Compatible` espera la raíz `/v1` (`/chat/completions` se agrega automáticamente, así que no
lo agregues). `Ollama` acepta la raíz pura y la normaliza a la API de compatibilidad `/v1` de Ollama.
:::

Después de guardar la conexión, selecciónala y elige `+ Agregar nuevo modelo de Texto` de su menú desplegable de modelos.
Completa:

- Nombre del modelo (ID exacto de la API): `gemma4:12b`, la etiqueta exacta de `ollama list`.
- Anulación de la ventana de contexto: opcional, solo Ollama / KoboldCPP. Configura esto (ej. `8192`,
  `16384`) para aumentar el `num_ctx` predeterminado de Ollama, que de lo contrario es lo suficientemente pequeño como para truncar
  el contexto largo de TomoriBot. Déjalo en blanco para usar el valor predeterminado del servidor.
- Interruptores: habilita `Llamado de herramientas` si el modelo admite la llamada a funciones; habilita
  `Entrada de imagen` solo para un modelo de visión; `Salida estructurada` si el modelo maneja bien los esquemas
  JSON. Para nuestro ejemplo, Gemma 4 los admite todos, así que márcalos todos.

TomoriBot valida la conexión cuando la guardas. Si informa que el endpoint es inalcanzable, la
causa habitual es una discrepancia de `localhost`/Docker o un `/v1` faltante/adicional (consulta
[las notas y los problemas comunes](#notas-y-problemas-comunes)).

Agregar el modelo lo convierte en el modelo de `text` activo automáticamente (empieza a chatear para probarlo). Si
no está activo por alguna razón, ejecuta `/config` > Modelos > Cambiar modelos y selecciona tu modelo recién registrado.

El registro nunca cambia ningún modelo que no sea `text`. Si marcaste Comprensión de imágenes
para que este endpoint pueda actuar como el ayudante de visión para un modelo de chat ciego a las imágenes, selecciónalo
explícitamente con `/config` > Modelos > Cambiar modelos; cada endpoint de texto que registraste con ese interruptor encendido aparece
allí. Ten en cuenta que el modelo de visión solo se consulta cuando el modelo de chat no puede ver imágenes, por lo que
colocar uno detrás de un modelo de chat capaz de visión no tiene efecto hasta que cambies.

## 3. (Opcional) Embeddings locales para RAG

Selecciona el endpoint guardado y usa su menú desplegable de modelos para agregar un modelo de Embeddings (ej.
`ollama pull nomic-embed-text`, Nombre del modelo `nomic-embed-text:latest`). Las funciones de RAG también necesitan
pgvector instalado en Postgres. Puedes ver la guía de [configuración manual](/es-419/self-hosting/manual-setup/) aquí.

## Otros servidores

Todos estos usan el mismo flujo, solo cambian la URL y un par de notas.

### KoboldCPP

- Inicia con OpenAI-compat habilitado (integrado). Predeterminado: `http://127.0.0.1:5001/v1`.
- Compatibilidad de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:5001/v1`.
- Respeta la `Anulación de ventana de contexto` como Ollama.
- Carga modelos GGUF; el Nombre del modelo es lo que reporte el modelo cargado (a menudo el tallo
  del archivo), verifica la respuesta de `/v1/models` de KoboldCPP.

### llama.cpp (`llama-server`)

- Compila o instala [llama.cpp](https://github.com/ggml-org/llama.cpp), luego sirve un GGUF con
  su servidor compatible con OpenAI incluido:
  ```sh
  llama-server -m model.gguf -c 16384 --host 0.0.0.0 --port 8080
  ```
- Compatibilidad de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:8080/v1`.
- Configura la ventana de contexto en el inicio con `-c`, la cual es la `Anulación de ventana de contexto` del modal; es
  solo para Ollama/KoboldCPP y no tiene efecto aquí.
- El Nombre del modelo es lo que reporte `/v1/models`; dale uno limpio con `--alias my-model`.
- Si lo iniciaste con `--api-key`, pon esa clave en `auth_token`.

### LM Studio

- En LM Studio, inicia el Local Server (pestaña Desarrollador). Predeterminado: `http://127.0.0.1:1234/v1`.
- Compatibilidad de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:1234/v1`.
- El Nombre del modelo es el identificador que LM Studio muestra para el modelo cargado.

### vLLM

- Sirve con el servidor compatible con OpenAI: `vllm serve <model>` → `http://127.0.0.1:8000/v1`.
- Compatibilidad de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:8000/v1`.
- Si iniciaste vLLM con `--api-key`, pon esa clave en `auth_token`.
- El Nombre del modelo es la ruta/nombre del modelo servido (coincide con `/v1/models`).

### LiteLLM (proxy sobre muchos backends)

- Ejecuta el proxy de LiteLLM; predeterminado: `http://127.0.0.1:4000/v1`.
- Compatibilidad de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:4000/v1`.
- El Nombre del modelo es el alias del modelo que definiste en la configuración de LiteLLM.
- Si el proxy impone una clave maestra, configúrala en `auth_token`.

### ChatMock (cuenta de ChatGPT / Codex CLI)

Tiene su propia guía dedicada debido a una solución alternativa para el prompt del sistema:
[Configuración: ChatMock](/es-419/self-hosting/local-endpoints/setup-chatmock/).

## Elección de modelos en Hugging Face

Más allá de la biblioteca seleccionada de Ollama, [Hugging Face](https://huggingface.co) aloja miles de
modelos de la comunidad. KoboldCPP, llama.cpp y LM Studio pueden cargar el formato GGUF, el cual es un
paquete de un solo archivo que descargas y al que apuntas el servidor.

1. Encuentra un GGUF. Busca en Hugging Face tu modelo más "GGUF"; los cuantificadores de la comunidad como
   [bartowski](https://huggingface.co/bartowski) publican compilaciones GGUF de los modelos más populares
   poco después de su lanzamiento. Prefiere una variante instruct/chat (nombres que terminan en `-Instruct` o
   `-Chat`); los modelos base no mantienen una conversación.
2. Elige una cuantización que quepa en tu VRAM. Un repositorio enumera el mismo modelo en muchos niveles de cuantización, y el
   tamaño de un archivo ≈ la VRAM que necesita (más ~1-2 GB para el contexto, la misma regla que la
   [tabla de tamaños](#qué-tamaño-debo-descargar) de arriba). Descarga el único `.gguf` de tu elección.
3. Cárgalo. Inicia KoboldCPP o `llama-server` con ese archivo (consulta
   [Otros servidores](#otros-servidores)), luego registra el endpoint en Discord como de costumbre.

:::tip[Which quant? Q4 or Q5 is the sweet spot]
La cuantización almacena cada peso en menos bits para encoger el modelo, con un pequeño costo en la calidad.
El código en nombres como `Q4_K_M` / `Q5_K_M` representa los bits por peso: **4 bits (Q4) o 5 bits (Q5)
es el punto ideal habitual** ya que mantiene la mayor parte de la calidad por aproximadamente la mitad del tamaño de 8 bits. Por debajo de 4 bits
se degrada rápidamente. Y para un presupuesto de VRAM fijo, un **modelo más grande en Q4 generalmente supera a un modelo
más pequeño en Q8**.
:::

## Notas y problemas comunes

- Una entrada de endpoint por etiqueta. Para registrar varios modelos que comparten un servidor, selecciona el
  endpoint guardado y usa su menú desplegable de modelos nuevamente. Usa etiquetas distintas para servidores
  o protocolos de API genuinamente diferentes.
- El Nombre del modelo es el identificador de la API. Es la cadena exacta que se envía al servidor. Equivocarse en esto es la causa
  más común de "se conectó pero las respuestas fallan".
- ¿Ejecutas TomoriBot en Docker? `localhost` dentro del contenedor no es tu host. Usa
  `http://host.docker.internal:<port>` (Windows/macOS) o la IP de la LAN del host, y vincula el
  servidor de modelos a `0.0.0.0`.
