---
title: "Proveedores y modelos"
sidebar:
  order: 1
---

TomoriBot se conecta a proveedores de IA externos en lugar de alojar un modelo integrado. Puede conectar servicios alojados como Google Gemini, OpenRouter y NovelAI, o dirigirla a puntos finales autohospedados locales. Necesitas al menos un proveedor para empezar a chatear.

## Claves de API
<!-- anchor: api-keys -->

Agrega una clave de proveedor durante la configuración inicial con `/setup`, o posteriormente desde `/providers` eligiendo `+ Add new Provider`. Las claves se cifran en reposo, por lo que nadie, incluidos los administradores del servidor, puede volver a leerlas.

`/setup` pregunta cómo deben llegar las respuestas a un modelo antes que nada, y la respuesta decide qué recopila:

| Modo | lo que recoge |
|---|---|
| Proveedor de IA (recomendado) | Un proveedor del catálogo más su clave API, validada y cifrada como borrador. |
| Punto final personalizado (avanzado) | La conexión del punto final y un modelo de texto, registrados dentro del asistente. Consulta [Puntos finales personalizados](#custom-endpoints). |
| Usuario BYOK (solo gremios) | Nada: el espacio de trabajo no cuenta con ningún proveedor propio, por lo que los miembros deberán suministrar uno personal. |

No se escribe nada en la base de datos hasta que presione `Finalizar configuración`. Un asistente abandonado o caducado deja intactas las filas de proveedores existentes del espacio de trabajo. Para reemplazar una clave existente, use `/providers`, porque `/setup` no se ejecutará en un espacio de trabajo ya configurado.

Cada proveedor tiene sus propios pasos de generación de claves. En `/help`, elija `Configuración`, luego `Obtener una clave de API` y elija su proveedor para un tutorial paso a paso, o utilice estos puntos de partida:

| Proveedora | Notas | obtener una clave |
|---|---|---|
| Google Géminis | Nivel gratuito, ejecuta todas las funciones. Primera configuración recomendada. | [Estudio de IA](https://aistudio.google.com/apikey) |
| OpenRouter | Una clave, muchos modelos (algunos gratuitos). | [Teclas OpenRouter](https://openrouter.ai/settings/keys) |
| NovelAI | Suscripción; Narración sin censura y juegos de rol (solo texto). | [NovelAI](https://novelai.net/) |
| búsqueda profunda | Modelos de razonamiento de pago por uso. | [Búsqueda profunda](https://platform.deepseek.com/api_keys) |
| NVIDIA NIM | Texto alojado, incrustaciones e imágenes. | [Construcción de NVIDIA](https://build.nvidia.com/) |
| antrópico | Modelos Claude a través del API (no Claude Code). | [Antrópico](https://console.anthropic.com/) |
| Z.ai | Familia GLM. ⚠️ ToS restringe el uso a escenarios de codificación y agentes. | [Z.ai](https://z.ai/) |
| Vertex AI | Google Cloud a través de `gcloud` ADC (mejor para configuraciones de desarrollo o ejecutadas localmente). | vea abajo |
| Vertex AI Express | Google Cloud API-key BYOK (Vista previa, subconjunto Gemini). | [Modo exprés](https://console.cloud.google.com/expressmode) |
| Costumbre | Cualquier punto final compatible con OpenAI (Ollama, vLLM, LiteLLM,…). | consulte [Puntos finales personalizados](#custom-endpoints) |

:::caution
Nunca compartas tu clave API con nadie más. Agrega o reemplace el token de autenticación de portador de un punto final personalizado desde su acción `Editar punto de conexión` en `/providers`.
:::

Vertex AI se autentica con credenciales predeterminadas de aplicación (ADC) en lugar de un secreto almacenado. Para alojamiento local, ADC puede provenir de `gcloud`; Las implementaciones alojadas deben utilizar una identidad de carga de trabajo o una cuenta de servicio. Una clave AI Studio API por sí sola no autentica el Vertex AI completo. El proyecto de nube Google seleccionado debe tener habilitada la facturación y el Vertex AI API, y la identidad del host necesita acceso a Vertex. La guía de configuración está disponible en Google Vertex AI en la página `API Keys` en `/help`.

La configuración del proveedor respaldada por Google valida las credenciales a través del punto final de listado de modelos autenticado. No genera texto ni depende del modelo de chat que esté actualmente marcado como predeterminado del catálogo, por lo que un modelo predeterminado retirado no puede impedir que se guarde una credencial válida.

### Opcional: clave de Brave Search

Brave Search es independiente de su proveedor de inteligencia artificial y mejora la búsqueda web con resultados de imágenes, videos y noticias. Configúrelo en `/providers`. ⚠️ Brave incluye $5/mes de crédito gratuito, así que establece un límite de uso de $5 en el panel de Brave para evitar cargos inesperados.

## Elegir modelos

Utilice `/providers` para administrar credenciales de servidor, catálogos de modelos y registros de terminales. Luego use `/config` > `Modelos` > Modelos de conmutador para seleccionar las asignaciones de capacidad compartida que utiliza cada miembro del servidor. Ambos comandos requieren permisos de administración del servidor.

Los miembros individuales administran sus propias credenciales y catálogos con `/personal providers` y luego seleccionan modelos personales en `/personal config`. La configuración personal los sigue en todos los servidores donde usan TomoriBot. Consulta [Personalización](/es-419/features/knowledge/personalization/#your-own-providers) para la configuración del usuario.

Los paneles se titulan `Proveedores del servidor` y `Proveedores personales`, por lo que la propiedad queda clara al abrirlos.

En `/config` > `Modelos` > Modelos de conmutador, puede asignar modelos y puntos finales en ocho ranuras de capacidad:

- **Texto**: el modelo de chat principal.
- **Visión**: lee imágenes cuando el modelo de chat no puede.
- **Incrustaciones**: potencia la [base de conocimiento de documentos](/es-419/features/knowledge/memory/#document-knowledge-base-rag).
- **Imagen estándar**: generación de imágenes estándar (consulte [Generación de imágenes](/es-419/features/capabilities/media-generation/image-generation/)).
- **Imagen NovelAI**: Generación de imágenes NovelAI.
- **Video**: generación de video.
- **Punto final TTS**: punto final de voz de texto a voz.
- **Punto final STT**: punto final de transcripción de audio de voz a texto.

Los primeros seis espacios eligen registros del catálogo de modelos. En su lugar, las ranuras TTS y STT eligen puntos finales con ámbito de espacio de trabajo, activando el punto final seleccionado en lugar de escribir una columna de modelo. Registre y edite esos puntos finales en `/providers`. `/personal config` conserva seis ranuras de enrutamiento de modelos personales y no incluye selectores de puntos finales personales TTS/STT.

También puede administrar claves de respaldo para conmutación por error automática y equilibrio de carga en `/providers`.

## Modelos de decisiones
<!-- anchor: decision-models -->

Los modelos de decisiones son una categoría independiente en `/providers` y `/personal providers`. Responden a predicados tipados con probabilidades. El registro no cambia el modelo de chat activo, no establece calibración ni habilita la omisión de la revisión de respuestas. Estos paneles aún no seleccionan un modelo de decisiones.

OpenRouter es el proveedor nativo admitido. Guarda su clave, abre el menú desplegable de modelos y elige `+ Agregar un modelo de decisiones`. Ingresa un ID de su catálogo de decisiones verificado. El catálogo global incluye `typesafe/jev-1.13`; los registros adicionales pertenecen a su servidor o propietario personal. El descubrimiento nativo proporciona el límite de entrada documentado y los precios. Los catálogos de chat no pueden establecer compatibilidad con decisiones.

Para un servicio personalizado, elige `Agregar nuevo punto de conexión`, luego `Compatible con System One` o `Compatible con OpenAI Decisions` en `Compatibilidad de API`. Guarda la URL base de la API y la credencial Bearer opcional. Su menú desplegable de modelos ofrece `+ Agregar un modelo de decisiones` y hereda ese protocolo. Ingresa el ID de modelo documentado y el límite de tokens de entrada (al menos 512). Jev, Laya y Kev usan compatibilidad con System One. Los puntos de conexión existentes compatibles con chat y nativos de Ollama no ofrecen esta acción.

Los orígenes sin ruta se normalizan a `/v1`. Las versiones explícitas y los prefijos de gateway se conservan intactos: `https://decision.example.invalid/gateway/v1` llama a `/gateway/v1/systemone` para System One o a `/gateway/v1/decisions` para OpenAI Decisions. La comprobación de disponibilidad utiliza `GET <stored-base>/models` sin enviar datos de conversación; no certifica las capacidades del modelo. Los modelos personalizados se registran manualmente a partir de la documentación del servicio cuando el descubrimiento no puede establecer los metadatos de capacidad necesarios.

Abre un registro de decisión guardado para editarlo. Las ediciones personalizadas conservan la identidad exacta del modelo y del punto de conexión. Elige `Eliminar este registro de decisión` en `Acción de registro` para quitarlo mientras conservas la conexión y las credenciales. Al eliminar el proveedor o punto de conexión principal, se eliminan los registros de ese propietario. Otros propietarios conservan las entradas compartidas. Las listas de modelos se paginan después de 18 registros editables utilizando los controles de página existentes.

Los registros y credenciales del proveedor permanecen fuera de las exportaciones e importaciones de personas o configuraciones. El restablecimiento de la configuración conserva los registros guardados; la eliminación principal los limpia explícitamente.

## Endpoints personalizados
<!-- anchor: custom-endpoints -->

Los puntos finales personalizados le permiten registrar servicios autohospedados o respaldados por proxy (Ollama, LM Studio, LiteLLM, vLLM, ComfyUI, TTS/STT local) como paquetes de proveedores etiquetados.

- **Alcance del servidor**: abra `/providers` para registrar y editar el punto final del espacio de trabajo.
- **Ámbito personal**: abra `/personal providers` para catálogos de modelos personales (consulte [Personalización](/es-419/features/knowledge/personalization/#your-own-providers)). Los puntos finales de voz personal no se seleccionan de `/personal config`.

Una etiqueta es el nombre del menú de cara al usuario y las capacidades de los grupos en un paquete cuando comparten una URL de punto final. Nunca se envía al servicio remoto. Las capacidades ofrecidas desde diferentes URL necesitan etiquetas distintas.

Para agregar un punto final personalizado:

1. En `/providers`, elija `Add New Custom Endpoint`.
2. Selecciona la compatibilidad API y guarde la conexión. Guardar prepara las capacidades soportadas por ese protocolo sin registrar ningún modelo.
3. Selecciona el nuevo punto final y use su menú desplegable de modelo para registrar una capacidad y un código de modelo exactos. Agregar un modelo lo activa para esa capacidad.
4. Utilice el mismo menú desplegable para adjuntar más modelos o editar registros existentes. Los modelos de texto declaran sus propias capacidades en esa forma y los modelos de imágenes declaran qué modos de solicitud admiten.

Para TTS y STT, registre el terminal y sus modelos en `/providers`, luego elija y active el terminal en `/config` > `Modelos` > Switch Models. Esas ranuras de voz seleccionan un punto final en lugar de una entrada de catálogo de modelo.

La compatibilidad API determina las rutas de solicitud y las cargas útiles que implementa el servicio, por lo que también determina qué ranuras de capacidad prepara la conexión. Registrar modelos exactos para esas ranuras es un paso aparte, porque el protocolo no se puede inferir de manera confiable únicamente a partir de la URL del punto final.

El modo `Punto de conexión personalizado (avanzado)` de `/setup` realiza los mismos dos pasos dentro del asistente: `Configurar conexión` guarda la compatibilidad, la etiqueta, la URL y el token de autenticación opcional de API detrás de una verificación de accesibilidad, y `Configurar modelo de texto` registra el modelo de texto exacto y sus declaraciones de capacidad. El botón de modelo permanece deshabilitado hasta que se valida la conexión y al volver a guardar la conexión se borra la declaración del modelo porque las declaraciones dependen de la compatibilidad de API. El asistente crea las filas de conexión, proveedor guardado, modelo y modelo activo juntas cuando presiona `Finalizar configuración`. El asistente registra únicamente modelos de texto; Las capacidades de imagen, video, TTS y STT están registradas en `/providers`.

OpenCode Go (`https://opencode.ai/zen/go/v1`) y OpenCode Zen (`https://opencode.ai/zen/v1`) funcionan como puntos finales personalizados compatibles con OpenAI. TomoriBot les envía el ID de sesión por conversación que necesitan, derivado de un hash del canal y la persona, por lo que ningún ID de Discord sale del bot.

Para ver tutoriales completos sobre la ejecución de servidores locales, consulte:

- [Configuración: LLM local](/es-419/self-hosting/local-endpoints/setup-local-llm/): Ollama, KoboldCPP, LM Studio, vLLM, LiteLLM.
- [Configuración: ComfyUI](/es-419/self-hosting/local-endpoints/setup-comfyui/): generación de imagen y video local.
- [Configuración: ChatMock](/es-419/self-hosting/local-endpoints/setup-chatmock/): cuenta ChatGPT o CLI del Codex.

## Proveedores compatibles
<!-- anchor: supported-providers -->

Si no tiene el hardware para alojar sus propios modelos, TomoriBot admite una amplia gama de servicios en la nube. No todas las funciones están disponibles en todos los proveedores.

### Proveedores de LLM

| Proveedora | Transmisión | Llamada de herramientas | Entrada de imagen | Incrustaciones | Notas |
|---|---|---|---|---|---|
| Google Géminis | ✅ | ✅ | ✅ | ✅ | Modelos gratuitos disponibles |
| OpenRouter | ✅ | ✅ | ✅ | ✅ | Modelos gratuitos disponibles |
| Antrópico (API) | ✅ | ✅ | ✅ | - | No código Claude |
| NovelAI | ✅ | ✅ | - | - | Sólo GLM 4.6 puede utilizar herramientas |
| NVIDIA NIM | ✅ | ✅ | ✅ | ✅ | Modelos gratuitos disponibles |
| búsqueda profunda | ✅ | ✅ | - | - | - |
| Z.ai | ✅ | ✅ | ✅ | - | Modelos gratuitos; ⚠️ ToS = codificación y uso exclusivo del agente |
| Codificación Z.ai | ✅ | ✅ | - | - | Plan de suscripción |
| Google Vertex AI | ✅ | ✅ | ✅ | ✅ | Incluye versión Express 'gratuita' |
| CLI del códice (a través de ChatMock) | ✅ | ✅ | ✅ | - | [Configuración](/es-419/self-hosting/local-endpoints/setup-chatmock/) |

### Generación de imágenes

| Proveedora | Texto a imagen | Imagen a imagen | en pintura | Notas |
|---|---|---|---|---|
| Google | ✅ | ✅ | - | - |
| OpenRouter | ✅ | ✅ | - | - |
| NovelAI | ✅ | ✅ | ✅ | Se puede combinar con otros proveedores. |
| Nvidia | ✅ | - | - | Sólo texto a imagen; las imágenes de referencia se ignoran |
| Z.ai | ✅ | - | - | - |

Estos son los valores predeterminados desde los que parten los modelos de imágenes de un proveedor. NovelAI se ejecuta a través de su propia canalización en lugar de esta tabla. Registrar un modelo de imagen a través de `/providers` le permite declarar los modos propios de ese modelo, que es la forma en que habilita la pintura en un flujo de trabajo ComfyUI o en un modelo de proveedor cuyo API admite la edición enmascarada. Un modelo que nunca declaras sigue los valores predeterminados anteriores. Declare solo lo que admite el modelo: TomoriBot ofrece herramientas solo para los modos que seleccione y los modos no admitidos fallarán en el momento de la generación.

### Generación de video

| Proveedora | Texto a vídeo | Imagen a vídeo | Notas |
|---|---|---|---|
| Google | ✅ | ✅ | Flujo de trabajo de sondeo asíncrono |
| OpenRouter | ✅ | ✅ | Flujo de trabajo de sondeo asíncrono |
| Z.ai | ✅ | ✅ | Flujo de trabajo de sondeo asíncrono |

### Voz y audio

| Proveedora | Texto a voz | Voz a texto |
|---|---|---|
| ElevenLabs | ✅ | ✅ |

Los motores de voz locales están cubiertos en [Autoalojamiento](/es-419/self-hosting/). Para búsqueda web integrada y lectura de URL, consulte [Herramientas y extensiones](/es-419/features/capabilities/tools-and-extensions/#web-search--url-reading).
