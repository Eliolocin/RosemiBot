---
title: "Configuración: ComfyUI"
sidebar:
  order: 2
aiGenerated: false
---

Esta traducción se proporciona para tu comodidad. La versión en inglés es la autoritativa.

TomoriBot puede generar imágenes y videos a través de tu propia
instancia de [ComfyUI](https://github.com/comfyanonymous/ComfyUI). Conduce ComfyUI al
enviar un flujo de trabajo en formato API con tu prompt/tamaño sustituido, y luego consulta
el endpoint `/history` de ComfyUI hasta que la salida esté lista.

Esta guía cubre la instalación/ejecución de ComfyUI y cómo registrarlo. Para crear o editar
un flujo de trabajo compatible con TomoriBot (los marcadores de posición `{TOMORI_*}`), usa la guía
profunda en Discord, abre `/help`, elige `Funciones`, luego `Endpoints personalizados`, y usa el
[README del flujo de trabajo](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows)
en GitHub.

:::note[No se necesitan variables de entorno]
ComfyUI se registra a través de comandos de barra de Discord y se almacena encriptado en la base de datos.
Consulta el [centro de endpoints locales](/es-419/self-hosting/local-endpoints/).
:::

## Requisitos de hardware

La generación de imágenes y videos está limitada por la GPU: el costo alto es la VRAM (la memoria de
tu tarjeta gráfica, separada de la RAM del sistema), establecida por el checkpoint del modelo que carga tu flujo de trabajo, no por
ComfyUI en sí. Se recomienda encarecidamente una GPU de NVIDIA. Los dos flujos de trabajo que incluye TomoriBot son
modelos modernos, más pesados que SDXL:

| Flujo de trabajo incluido | Modelo base | VRAM práctica | Notas |
|---|---|---|---|
| Anima v1 (imagen) | Qwen-Image (~20B), fp8 | ~16 GB mínimo · 24 GB cómodo | El codificador de texto + VAE añaden ~8-10 GB de sobrecarga. Por debajo de 16 GB, usa una versión GGUF + `--lowvram`. |
| WAN i2v loop (video) | Wan 2.2 14B, fp8 + LoRAs LightX2V de 4 pasos | ~16 GB funcional · 24 GB+ cómodo | La opción más pesada espera minutos por clip. Descarga el codificador de texto UMT5 a la RAM (`t5_cpu`, necesita 24 GB+ de RAM del sistema) en tarjetas más pequeñas. |

Ambos checkpoints incluidos ya están cuantizados en fp8 para caber en tarjetas de consumo. Si tienes menos
VRAM, cambia la UNET por una cuantización más pequeña y habilita la descarga a CPU o `--lowvram` en ComfyUI. La difusión solo por CPU es
poco práctica (muchos minutos por imagen, peor para video) y puede exceder la ventana de consulta de TomoriBot,
por lo que una GPU es efectivamente requerida para el uso regular.

:::tip[Bajando más: elige una cuantización GGUF]
La cuantización almacena cada peso del modelo en menos bits para reducir el uso de VRAM y disco, con un pequeño
costo de precisión. Los archivos fp8 incluidos son una forma suave de esto, y para reducir más, descarga una
versión GGUF del modelo desde Hugging Face: el código en nombres como `Q4_K_M` o `Q5_K_M` es el
número de bits por peso, y 4 bits (Q4) o 5 bits (Q5) es el punto óptimo usual con la mayor parte de la calidad
por una fracción del tamaño de fp8/fp16. Por debajo de 4 bits se reduce más pero se degrada rápidamente. Cargar
las UNETs de GGUF en ComfyUI necesita el nodo personalizado [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF).
:::


## 1. Ejecuta ComfyUI con la API habilitada

Instala ComfyUI según [su README](https://github.com/comfyanonymous/ComfyUI) y configúralo para que
escuche en la red:

```sh
python main.py --listen 0.0.0.0 --port 8188
```

`--listen 0.0.0.0` importa si TomoriBot se ejecuta en Docker o en una máquina diferente (el
valor predeterminado se vincula solo al bucle local). Confirma la accesibilidad desde la máquina donde se ejecuta el bot:

```sh
curl http://127.0.0.1:8188/system_stats
```

Si deseas probar, carga los checkpoints del modelo que tu flujo de trabajo elegido espera y haz una generación manual en la
interfaz web de ComfyUI para confirmar que funciona de principio a fin antes de conectar TomoriBot.

## 2. Obtén un flujo de trabajo de TomoriBot

Descarga un flujo de trabajo en formato API listo para usar. Los ejemplos se pueden encontrar en el repositorio bajo
[`assets/comfyui-workflows/`](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows):

| Flujo de trabajo | Modos |
|----------|-------|
| Anima v1 (imagen) : `tomoribot-anima-v1-comfyui.json` | `txt2img`, `img2img`, `inpaint` |
| WAN i2v loop (video) : `tomoribot-wan-i2v-loop-video.json` | imagen-a-video |

Estos están en formato API (el JSON que ComfyUI exporta mediante *Save (API Format)*), no en el formato regular
de guardado de la interfaz de usuario. Si creas el tuyo propio, debe contener los marcadores de posición `{TOMORI_*}`
que TomoriBot sustituye (prompt, ancho/alto, semilla, imágenes de referencia, etc.). Consulta el README
del flujo de trabajo y la página `Endpoints personalizados` bajo Providers en `/help`.

## 3. Regístralo en Discord

Ejecuta `/providers` (o `/personal providers`), elige `Agregar nuevo punto de conexión personalizado`, e ingresa:

| Campo | Valor para ComfyUI |
|-------|-------------------|
| `endpoint_label` | Un nombre que elijas, por ejemplo `home-comfy` |
| Compatibilidad de API | `ComfyUI` |
| `endpoint_url` | `http://127.0.0.1:8188` (raíz, sin `/v1`) |
| `auth_token` | *(déjalo en blanco a menos que tu ComfyUI esté detrás de autenticación)* |

Después de guardar la conexión, selecciónala y usa su menú desplegable de modelos para agregar un modelo de Imagen o Video.
Ingresa el nombre en código exacto del checkpoint y sube el archivo `.json` del flujo de trabajo que descargaste
desde el Paso 2. La capacidad del modelo debe coincidir con el flujo de trabajo (flujo de trabajo de imagen → `image`, flujo de trabajo de
video → `video`).

Un modelo de imagen también pregunta por sus `Capacidades de imagen`: texto a imagen, imagen de referencia,
inpainting, y prompt negativo. Marca solo los modos que tu flujo de trabajo realmente implementa, porque
Tomori le ofrece a la herramienta solo los modos que declaras. Inpainting aparece para las conexiones de ComfyUI
solamente, ya que ninguna otra compatibilidad de API acepta una máscara. Editar el modelo más tarde reabre el formulario
con tu selección actual, por lo que cambiar un nombre en código no lo borrará.

Agregar el modelo lo convierte en el modelo `image`/`video` activo automáticamente. Activa la generación preguntándole a Tomori directamente en el chat. Si no está activo por alguna razón, ejecuta `/config` > Models > Switch Models
y selecciona tu endpoint de ComfyUI registrado.

## Solución de problemas

- Inalcanzable al agregar: ComfyUI se vinculó al bucle local mientras el bot está en Docker o en otro
  host. Inícialo con `--listen 0.0.0.0` y usa `http://host.docker.internal:8188` o la
  IP de la LAN.
- La generación nunca se completa: TomoriBot consulta `/history` hasta que aparece la salida. Los inicios
  en frío y los modelos grandes en CPU pueden exceder la ventana de consulta.
- Prompt/tamaño ignorado o tamaño de salida incorrecto: al flujo de trabajo le faltan los marcadores de posición requeridos
  `{TOMORI_*}`, o subiste una exportación en formato de UI en lugar del formato API.
- Capacidad incorrecta: un flujo de trabajo de `image` registrado bajo `video` (o viceversa) no
  se ejecutará. Vuelve a agregarlo bajo la capacidad correspondiente.
