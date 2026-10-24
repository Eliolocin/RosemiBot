---
title: "Configuración: Modelo de decisiones local"
sidebar:
  order: 7
aiGenerated: true
---

Ejecuta un modelo de decisiones pequeño en tu propia máquina y regístralo en TomoriBot. Un modelo de decisiones responde preguntas sobre un texto, como sí o no o cuál de varios temas encaja, con probabilidades. [Kev](https://github.com/jaredpalmer/kev) es un modelo abierto que utiliza el protocolo System One, el mismo que emplea el Jev alojado por TypeSafe.

:::note[Qué lo utiliza]
Una vez seleccionado en `/config` > `Modelos` > `Cambiar modelos`, o como el verificador de intervenciones activas en `/config` > `Plugins` > `Natural Nudges`, el modelo de decisiones determina cuándo [Natural Nudges](/features/chatting-personality/natural-nudges/#active-nudges) se une a una conversación, pidiéndole que elija un tema entre varios. Consulta [Modelos de decisiones](/features/setup-administration/providers-and-models/#decision-models) para más detalles.
:::

## 1. Ejecutar Kev

Kev necesita [Git](https://git-scm.com), [uv](https://docs.astral.sh/uv/) y Python 3.12 o 3.13 (uv lo instala automáticamente). Elige un tamaño adecuado para tu GPU:

| Modelo | ID de Hub | Pesos (aprox.) | Notas |
|---|---|---|---|
| Kev-0.8B | `jaredpalmer/kev-0.8b` | 2 GB | Se ejecuta en una GPU de 4 GB. Menor precisión. |
| Kev-4B | `jaredpalmer/kev-4b` | 8-9 GB | El punto de partida recomendado de Kev si cabe en la memoria de tu GPU. |

El README de Kev menciona CUDA, ROCm y Apple Silicon. Los pasos para Windows a continuación se comprobaron en Windows nativo con una GPU NVIDIA. Si el servidor no inicia en tu entorno, ejecuta los mismos pasos en WSL2.

Clónalo en una carpeta fuera de la de TomoriBot:

```powershell
git clone https://github.com/jaredpalmer/kev.git
cd kev
uv sync --extra serve
```

En Windows con una GPU NVIDIA, `uv sync` instala PyTorch solo para CPU, lo cual es demasiado lento. Reemplázalo con la compilación CUDA y verifica que reconozca tu GPU:

```powershell
uv pip install --reinstall-package torch "torch>=2.6,<2.9" --index-url https://download.pytorch.org/whl/cu128
uv run --no-sync python -c "import torch; print(torch.cuda.is_available())"
```

Debe imprimir `True`. A partir de ahora inicia Kev con `uv run --no-sync`, ya que un simple `uv run` volvería a sincronizar la versión de CPU. En Linux y macOS, usa `uv run --extra serve` en su lugar.

Inicia el servidor. La primera ejecución descarga el modelo, por lo que toma unos minutos:

```powershell
uv run --no-sync python -m kev.serve --run jaredpalmer/kev-4b --port 8009 --device cuda
```

`--device cuda` hace que Kev falle de inmediato si no puede usar tu GPU, en lugar de ejecutarse silenciosamente en la CPU. Usa `jaredpalmer/kev-0.8b` si Kev-4B se queda sin memoria. En una Mac, quita `--device cuda`.

Déjalo ejecutándose y compruébalo desde otra ventana de PowerShell. El primer comando enumera el nombre del modelo y el segundo devuelve una probabilidad entre 0 y 1 para la pregunta de sí/no:

```powershell
Invoke-RestMethod http://127.0.0.1:8009/v1/models
$body = '{"state":"The fictional door is blue.","model":"kev-latest","questions":{"q":{"type":"noul","instructions":"Is the door blue?"}}}'
Invoke-RestMethod http://127.0.0.1:8009/v1/systemone -Method Post -ContentType "application/json" -Body $body
```

Kev muestra una advertencia indicando que falta `flash-linear-attention`. Luego usa una ruta más lenta que proporciona las mismas respuestas, por lo que puedes ignorarla.

## 2. Registrarlo en Discord

Ejecuta `/providers` (para todo el servidor) o `/personal providers` (solo para ti), selecciona `Add New Custom Endpoint` e ingresa:

| Campo | Valor |
|---|---|
| `Endpoint Label` | `kev` |
| `Endpoint URL` | `http://127.0.0.1:8009/v1` |
| `API Compatibility` | `System One compatible` |
| `Auth Token` | Déjalo en blanco, a menos que hayas configurado `KEV_API_KEY` |

TomoriBot comprueba `GET /v1/models` al guardar. Un servidor que responda `404` o `405` se acepta de todos modos.

Abre el punto de conexión guardado `kev`, elige `+ Agregar un modelo de decisiones` en su menú desplegable de modelos e ingresa:

- `Code Name`: `kev-latest`, el nombre de modelo que usan los ejemplos de Kev.
- `Context Window`: `8192`, la longitud máxima de texto para la que están validados Kev-0.8B y Kev-4B. Kev rechaza cualquier texto que supere los 65,536 tokens.

## 3. Seleccionarlo

Abre `/config` > `Modelos` > `Cambiar modelos` y elige `kev-latest` en la ranura `Decisión`. `- Sin modelo` lo desactiva sin eliminar el registro.

## Notas y detalles a tener en cuenta

- **Detener el servidor**: usa `Ctrl+C`. TomoriBot no inicia ni detiene Kev por ti.
- **¿TomoriBot en Docker?** `127.0.0.1` dentro del contenedor no es tu host. Usa `http://host.docker.internal:8009/v1` e inicia Kev con `--host 0.0.0.0`. Kev no tiene inicio de sesión por defecto, por lo que debes configurar `KEV_API_KEY` primero e ingresar el mismo valor en `Auth Token`.
- **Entornos de producción**: exigen HTTPS y bloquean direcciones privadas para los puntos de conexión de proveedores. Una URL HTTP local funciona cuando `RUN_ENV=development`. Consulta [LLM local](/self-hosting/local-endpoints/setup-local-llm/#notes--gotchas).
- **Otros servidores System One**: como Laya, utilizan los mismos pasos con su propia URL y nombre de modelo. Un servidor que implemente la API OpenAI Decisions utiliza `OpenAI Decisions compatible` en su lugar.
