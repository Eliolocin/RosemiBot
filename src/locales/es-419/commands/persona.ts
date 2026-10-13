export default {
  persona: {
    description: `Administra los preajustes de personalidad`,
    "image-tags": {
      modal_title: `Etiquetas de imagen de la persona`,
      tags_input_label: `Etiquetas de apariencia física`,
      tags_input_description: `Etiquetas de apariencia separadas por comas (estilo imageboard). Déjalo vacío para borrar.`,
      tags_input_placeholder: `pelo blanco corto, ojos rojos, uniforme escolar`,
      no_tags_title: `Sin etiquetas proporcionadas`,
      no_tags_description: `Por favor, proporciona al menos una etiqueta de apariencia física.`,
      too_many_tags_title: `Demasiadas etiquetas`,
      too_many_tags_description: `Puedes configurar un máximo de {max_tags} etiquetas de imagen por persona.`,
      tag_too_long_title: `Etiqueta demasiado larga`,
      tag_too_long_description: `Cada etiqueta de imagen debe tener {max_length} caracteres o menos.`,
      success_title: `Apariencia física actualizada`,
      success_description: `Se actualizaron las etiquetas de apariencia física para **{persona_name}**:
\`\`\`
{tag_list}
\`\`\``,
      cleared_title: `Apariencia física borrada`,
      cleared_description: `Se borraron las etiquetas de apariencia física para **{persona_name}**.`,
    },
    sprites: {
      add: {
        sprite_name_label: `Nombre del sprite`,
        sprite_name_description: `Etiqueta usada para el sprite. Reusar una etiqueta reemplaza el sprite correspondiente.`,
        sprite_name_placeholder: `enojada`,
        image_label: `Imagen del sprite`,
        image_description: `Sube un PNG, JPG o GIF. Se convertirá a PNG.`,
        instructions_label: `Instrucciones de uso`,
        instructions_description: `Guía opcional para indicar cuándo se debe usar este sprite.`,
        instructions_placeholder: `Úsalo cuando esté enojada, molesta o visiblemente alterada.`,
        identity_label: `Guardar como identidad`,
        identity_description: `Muestra el nombre decorado en Discord, útil para identidades de alters. Desactivado = normal.`,
      },
      edit: {
        image_description: `Opcional. Sube un PNG, JPG o GIF para reemplazar la imagen del sprite.`,
        identity_status_on: `Identidad`,
        identity_status_off: `Sprite normal`,
      },
      import: {
        archive_label: `Archivo de sprites`,
        archive_description: `Sube un .zip creado por /persona sprites export.`,
      },
    },
    attribute: {
      description: `Administra los atributos de la persona.`,
      add: {
        description: `Agrega un atributo a una persona.`,
      },
      remove: {
        description: `Elimina un atributo de una persona.`,
      },
    },
    prompt: {
      description: `Administra las instrucciones del prompt de la persona.`,
      set: {
        description: `Configura un prompt para la persona.`,
      },
      remove: {
        description: `Elimina un prompt de la persona.`,
      },
    },
    "sample-dialogue": {
      description: `Agrega un diálogo de ejemplo entre usuario y bot como modelo de cómo debo responder.`,
      add: {
        description: `Agrega un diálogo de ejemplo entre usuario y bot como modelo de cómo debo responder.`,
      },
      remove: {
        description: `Elimina un diálogo de ejemplo de usuario y bot de mi memoria.`,
      },
    },
    name_conflict_title: `🔴 Conflicto de nombre de persona`,
    name_conflict_description: `Ya existe una persona llamada **{name}** en este servidor. Los nombres deben ser únicos en el servidor.`,
    export: {
      description: `Exporta la personalidad actual como un archivo PNG para compartir`,
      export_json_select_label: `Exportar JSON`,
      export_json_select_description: `Opcional: exportar un archivo JSON importable (sin imagen de avatar)`,
      persona_modal_title: `Seleccionar persona`,
      persona_select_label: `Persona`,
      persona_select_description: `Elige qué persona deseas exportar.`,
      persona_select_placeholder: `Selecciona una persona...`,
      main_persona_description: `Persona principal`,
      alter_persona_description: `Alter`,
      success_title: `🟢 Persona exportada con éxito`,
      success_description: `¡La persona actual **{nickname}** ha sido exportada! Comparte este archivo PNG con otros para difundir esta configuración de personalidad.`,
      success_description_json: `La persona actual **{nickname}** ha sido exportada como un archivo JSON.

**Nota:** Este JSON se puede volver a importar con \`/persona import\`. No incluye la imagen de avatar. Usa la exportación en PNG para compartir también el avatar.`,
      json_importable_note: `Este JSON exportado se puede importar con /persona import. No incluye la imagen de avatar; usa la exportación en PNG para compartir también el avatar.`,
      failed_title: `🔴 Exportación fallida`,
      avatar_failed_title: `🔴 Falló la descarga del avatar`,
      avatar_failed_description: `No se pudo descargar el avatar de la persona. Por favor, inténtalo de nuevo más tarde.`,
      embed_failed_title: `🔴 Falló el procesamiento del PNG`,
      embed_failed_description: `No se pudieron incrustar los metadatos en el archivo PNG. Por favor, inténtalo de nuevo.`,
      error_no_server_data: `Servidor no encontrado en la base de datos. Por favor, ejecuta /setup primero.`,
      error_no_preset_data: `Datos de persona no encontrados. Por favor, ejecuta /setup primero.`,
      error_validation_failed: `Falló la validación de la estructura de los datos a exportar`,
      error_export_failed: `Falló la exportación de los datos de la persona`,
    },
    import: {
      description: `Importa una persona desde un archivo PNG, JSON o CHARX`,
      file_description: `Archivo PNG, JSON o CHARX que contiene datos de persona`,
      type_description: `Importar como persona principal o alter`,
      triggers_description: `Palabras de activación adicionales opcionales, separadas por comas ("," o "、")`,
      memories_description: `¿Conservar las memorias del usuario y del servidor de esta persona?`,
      memories_choice_preserve: `Sí, conservar memorias del usuario/servidor`,
      memories_choice_fork: `No, iniciar nuevas memorias del usuario/servidor`,
      type_choice_main: `Persona principal (reemplaza a la actual)`,
      type_choice_alter: `Alter`,
      success_title: `🟢 Persona importada con éxito`,
      success_description: `¡Persona **{nickname}** importada con éxito!
Atributos: {attribute_count}
Diálogos de ejemplo: {dialogue_count}
Palabras de activación: {trigger_word_count}`,
      success_confirmation: `¡Persona principal **{nickname}** importada con éxito! La información detallada de la importación se ha publicado en el canal.`,
      post_missing_permission: `Persona importada, pero no pude publicar la confirmación. Pide a un administrador que me conceda {permission} en este canal.`,
      nickname_update_success: `El apodo en el servidor ha sido actualizado.`,
      nickname_update_failed: `🟡 No se pudo actualizar el apodo en el servidor, probablemente por los límites de tasa de Discord. Cámbialo manualmente.`,
      avatar_update_success: `El avatar en el servidor ha sido actualizado.`,
      avatar_update_skipped_no_image: `🟡 El archivo importado no incluía una imagen de avatar, así que se mantuvo el avatar actual de la persona principal.`,
      avatar_update_rate_limited: `🟡 El avatar del servidor no se actualizó debido a los límites de tasa de Discord. Cámbialo manualmente.`,
      avatar_update_failed: `🟡 No se pudo actualizar el avatar del servidor, probablemente por los límites de tasa de Discord. Cámbialo manualmente.`,
      alter_success_title: `🟢 Alter importado con éxito`,
      alter_success_description: `¡Alter **{nickname}** importado con éxito!
Palabras de activación únicas: {trigger_count}
Activaciones: {triggers}

Esta persona responderá cuando estas activaciones aparezcan en los mensajes.`,
      alter_success_confirmation: `¡Alter **{nickname}** importado con éxito con {trigger_count} palabras de activación únicas! La información detallada de la importación se ha publicado en el canal.`,
      alter_avatar_fallback_main: `🟡 Esta importación no incluía un avatar, así que este alter está usando el avatar principal actual de **{nickname}** como respaldo. Puedes cambiarlo en \`/config\` > Persona > General.`,
      alter_avatar_warning: `⚠️ No elimines el embed de la imagen del avatar de arriba, o el avatar del alter se perderá.`,
      alter_dm_not_allowed_title: `🔴 Alters no permitidos en MD`,
      alter_dm_not_allowed_description: `Los alters solo se pueden importar en servidores, no en Mensajes Directos. Por favor, ejecuta este comando en un servidor.`,
      alter_no_triggers_warning: `⚠️ Esta persona no tiene palabras de activación. No responderá a ningún mensaje hasta que agregues activaciones usando \`/config\` > Persona > General.`,
      alter_name_conflict_title: `🔴 El nombre de la persona ya existe`,
      alter_name_conflict_description: `Ya existe una persona con el nombre **{name}** en este servidor. Cada persona debe tener un nombre único.

Por favor, edita el archivo de importación para usar un nombre diferente o elimina la persona existente usando \`/persona remove\`.`,
      alter_limit_title: `🔴 Límite de personas alcanzado`,
      alter_limit_description: `Este servidor ya tiene {current} personas. El máximo permitido es {max}. Por favor, elimina un alter con \`/persona remove\` antes de importar uno nuevo.`,
      failed_title: `🔴 Importación fallida`,
      failed_description: `Falló la importación de la persona. Por favor, revisa el archivo e inténtalo de nuevo.`,
      sprite_snapshot_failed_description: `La importación se canceló porque no se pudieron leer los sprites de la persona actual. No se cambiaron datos. Inténtalo de nuevo.`,
      sprite_cleanup_failed_description: `La persona fue importada, pero no se pudieron borrar sus sprites anteriores. La importación está incompleta. Inténtalo de nuevo o contacta a un administrador.`,
      sprite_storage_cleanup_partial_description: `La persona fue importada, pero no se pudieron eliminar {failed_count} imagen(es) de sprite anteriores del almacenamiento.`,
      invalid_file_type_title: `🔴 Tipo de archivo inválido`,
      invalid_file_type_description: `Por favor, sube un archivo .png, .json o .charx válido que contenga datos de persona.`,
      file_too_large_title: `🔴 Archivo demasiado grande`,
      file_too_large_description: `El archivo es demasiado grande. El tamaño máximo de archivo es de {max_size}MB.`,
      download_failed_title: `🔴 Falló la descarga`,
      download_failed_description: `No se pudo descargar el archivo adjunto. Por favor, inténtalo de nuevo.`,
      invalid_charx_title: `🔴 Archivo de tarjeta de personaje inválido`,
      invalid_charx_description: `Este archivo .charx no se pudo leer como un archivo Character Card V3. Vuelve a descargar la tarjeta del sitio que la aloja, o expórtala como .png en su lugar.`,
      card_conversion_failed_title: `🟡 Tarjeta de personaje detectada, conversión fallida`,
      card_conversion_failed_description: `Se decodificó una tarjeta de **{source}**, pero falló su conversión al formato Tomori. El contenido decodificado se adjunta para su inspección. Repórtalo a través de \`/support discord\` e incluye el archivo adjunto.`,
      charx_not_card_description: `Este archivo .charx se abrió, pero la tarjeta en su interior no es de personaje. Asegúrate de que el archivo sea la tarjeta de personaje en sí y no otro archivo de la misma descarga.`,
      charx_too_large_description: `La tarjeta dentro de este archivo es demasiado grande para importarla. El tamaño máximo de tarjeta es de {max_size}MB.`,
      charx_assets_too_large_description: `Esta tarjeta incluye más archivos multimedia de los que una importación puede inspeccionar. Prueba con una tarjeta exportada sin sus recursos de imagen, audio o video.`,
      charx_assets_ignored_description: `🟡 Las imágenes, sonidos y otros recursos incluidos en esta tarjeta no se importaron. Solo se leyó el texto de la persona. Puedes configurar un avatar con \`/server avatar\` y agregar sprites en \`/config\` > Persona > Sprites.`,
      invalid_png_title: `🔴 Archivo PNG inválido`,
      invalid_png_description: `El archivo subido no es una imagen PNG válida.`,
      no_metadata_title: `🔴 Datos de persona no encontrados`,
      no_metadata_description: `Este archivo no contiene datos compatibles de persona. Usa un archivo exportado por \`/persona export\` o una tarjeta de personaje compatible de SillyTavern.`,
      invalid_file_title: `🔴 Archivo de persona inválido`,
      invalid_file_description: `El formato del archivo de persona es inválido o incompatible.`,
      no_permission_title: `🔴 Permiso denegado`,
      no_permission_description: `Necesitas el permiso de **Gestionar servidor** para importar personas.`,
      error_download_timeout: `La descarga del archivo agotó el tiempo de espera. Por favor, inténtalo de nuevo.`,
      error_invalid_attribute: `Contenido de atributo inválido: {details}`,
      error_attribute_flags_mismatch: `Las banderas de visibilidad de los atributos deben coincidir con la longitud de la lista de atributos.`,
      error_invalid_dialogue_in: `Diálogo de ejemplo inválido (entrada): {details}`,
      error_invalid_dialogue_out: `Diálogo de ejemplo inválido (salida): {details}`,
      error_invalid_trigger_word: `Palabra de activación inválida: {details}`,
      error_dialogue_mismatch: `Las matrices de diálogos de ejemplo no coinciden en longitud`,
      error_invalid_config: `Campos de configuración inválidos en los datos de la persona`,
      error_no_server_data: `Servidor no encontrado en la base de datos. Por favor, ejecuta \`/setup\` primero.`,
      error_name_conflict: `Ya existe una persona con el nombre **{name}** en este servidor. Por favor, usa un nombre diferente.`,
      error_nsfw_persona: `Esta persona está marcada como NSFW, así que \`/persona import\` no puede cargarla. Usa \`/nsfw persona import\`.`,
      error_import_failed: `Falló la importación de los datos de la persona`,
      error_not_json: `El archivo importado debe contener datos JSON válidos`,
      error_incompatible_version: `Versión de preajuste incompatible. Se esperaba {expected}, se obtuvo {actual}`,
      error_invalid_format: `Formato de archivo de persona inválido`,
      error_invalid_type: `Tipo de persona inválido: {type}. Se esperaba "preset"`,
      avatar_update_skipped_dm: `La persona se importó correctamente, excepto el avatar y el apodo, que no están disponibles en Mensajes Directos`,
      refresh_reminder: `Ejecuta \`/refresh\` para aplicar la actualización de la persona en este chat`,
    },
    remove: {
      description: `Elimina un alter del servidor`,
      no_permission_title: `🔴 Permiso denegado`,
      no_permission_description: `Necesitas el permiso de **Gestionar servidor** para eliminar alters.`,
      modal_title: `Eliminar alter`,
      select_label: `Alter`,
      select_placeholder: `Elige un alter para eliminar...`,
      no_alters_error_title: `🟡 No hay alters`,
      no_alters_error_description: `No hay alters para eliminar. Importa alters usando \`/persona import type:alter\`.`,
      success_title: `🟢 Alter eliminado`,
      success_description: `El alter **{nickname}** fue eliminado con éxito.`,
    },
    default: {
      description: `Aplica una configuración de personalidad preajustada`,
      type_description: `Aplicar a la persona principal/predeterminada o crear como alter`,
      type_choice_default: `Persona principal (reemplaza a la actual)`,
      type_choice_alter: `Alter`,
      no_permission_title: `🔴 Permiso denegado`,
      no_permission_description: `Necesitas el permiso de **Gestionar servidor** para aplicar preajustes de personalidad.`,
      modal_title: `Aplicar preajuste de personalidad`,
      select_label: `Preajuste de personalidad`,
      select_description: `Elige un preajuste para aplicar. Esto sobrescribirá los atributos y diálogos actuales.`,
      select_placeholder: `Elige un preajuste...`,
      no_presets_title: `Sin preajustes disponibles`,
      no_presets_description: `No hay preajustes de personalidad disponibles para tu idioma. Por favor, repórtalo en \`/support discord\`.`,
      preset_not_found: `No se pudo encontrar el preajuste seleccionado.`,
      success_title: `Preajuste aplicado`,
      success_details_description: `¡Se aplicó con éxito el preajuste **{preset_name}** a la persona **{nickname}**!
Atributos: {attribute_count}
Diálogos de ejemplo: {dialogue_count}
Palabras de activación ({trigger_word_count}): {triggers}`,
      success_confirmation: `Preajuste aplicado a **{nickname}**. La información detallada se ha publicado en este canal.`,
      avatar_update_failed: `🟡 No se pudo actualizar el avatar del servidor por un error en la API de Discord, pero la persona se aplicó con éxito.`,
      avatar_update_skipped_dm: `El preajuste se aplicó correctamente, excepto las actualizaciones de avatar, que no están disponibles en MD`,
    },
    import_now: {
      button: `Importar ahora`,
      imported: `Importada`,
      already_imported_title: `🟡 Ya importada`,
      already_imported_description: `Esta persona ya ha sido importada, o hay una importación en curso en este momento.`,
    },
    generate: {
      description: `Generación de personalidad con IA (requiere un proveedor compatible)`,
      modal: {
        title: `Generar personalidad con IA`,
        character_name_label: `Nombre del personaje`,
        character_name_description: `Nombres separados por comas: todos serán palabras de activación; el primero será el nombre.`,
        character_name_placeholder: `ej. Hatsune Miku, Miku, 初音ミク`,
        character_info_label: `Información y ejemplos de diálogo`,
        character_info_description: `Describe el personaje y cómo habla`,
        character_info_placeholder: `Personalidad, historia, estilo de habla, frases de ejemplo, etc.`,
        web_search_label: `¿Buscar en la web?`,
        web_search_description: `Buscar info del personaje (para personajes existentes de otros medios)`,
        web_search_placeholder: `Selecciona Sí o No`,
        web_search_yes: `Sí, buscar información del personaje`,
        web_search_no: `No, crear un personaje original`,
        additional_inst_label: `Instrucciones adicionales`,
        additional_inst_placeholder: `Opcional: Otras instrucciones (ej. "mantén las respuestas del personaje cortas")`,
        file_upload_label: `Imagen / tarjeta del personaje (Opcional)`,
        file_upload_description: `Sube una imagen, preajuste Tomori o tarjeta PNG SillyTavern para generar un personaje`,
      },
      field_character_name: `Nombre del personaje`,
      field_character_info: `Información y ejemplos de diálogo`,
      field_web_search: `¿Buscar en la web?`,
      field_additional_inst: `Instrucciones adicionales`,
      wrong_provider_title: `🔴 Proveedor incompatible`,
      wrong_provider_description: `La generación de preajustes requiere un proveedor compatible. Tu actual es **{current_provider}**. Usa \`/config\` > Modelos > Cambiar modelos para usar uno compatible.`,
      no_api_key_title: `🔴 Sin clave de API`,
      no_api_key_description: `No hay un proveedor activo configurado. Usa \`/setup\` (primera vez) o \`/providers\` para registrar uno.`,
      model_incompatible_title: `Modelo incompatible`,
      model_incompatible_description: `Tu modelo actual (**{model_name}**) no admite **SALIDA ESTRUCTURADA**, lo cual es necesario para generar personas.

**Próximos pasos:**
Usa \`/config\` > Modelos > Cambiar modelos para cambiar a un modelo que admita salida estructurada (ej. modelos con capacidad "STRUCT").`,
      image_vision_required_title: `🔴 Visión de imágenes requerida`,
      image_vision_required_description: `Subiste una imagen, pero tu modelo actual (**{model_name}**) no admite **VISIÓN DE IMÁGENES** y no hay modelo de visión configurado.

**Próximos pasos:**
1. Usa \`/config\` > Modelos > Cambiar modelos para establecer un modelo de visión dedicado, O
2. Usa \`/config\` > Modelos > Cambiar modelos para cambiar a un modelo con visión, O
3. Elimina la imagen y vuelve a generar sin ella`,
      web_search_tools_required_title: `🔴 Búsqueda web no disponible`,
      web_search_tools_required_description: `Seleccionaste búsqueda en la web, pero el modelo actual (**{model_name}**) no admite **HERRAMIENTAS**.

**Próximos pasos:**
1. Usa \`/config\` > Modelos > Cambiar modelos para cambiar a un modelo con herramientas, O
2. Vuelve a generar sin búsqueda web (elige "No" cuando se te pregunte)`,
      api_key_decrypt_failed_title: `🔴 Error de clave de API`,
      api_key_decrypt_failed_description: `Falló la desencriptación de las credenciales del proveedor activo. Por favor, reconfigúralas usando \`/providers\`.`,
      vision_credentials_unavailable_title: `🔴 Credenciales del modelo de visión no disponibles`,
      vision_credentials_unavailable_description: `Tu modelo de visión (**{vision_model_name}**) funciona en el proveedor **{vision_provider}**, pero no se pudo usar su clave de API guardada para describir la imagen. Reconfigura las credenciales de ese proveedor con \`/providers\`, o revisa \`/config\` > Modelos.`,
      invalid_image_title: `🔴 Imagen inválida`,
      invalid_image_description: `Por favor, sube un archivo de imagen válido (PNG, JPG, JPEG, etc.).`,
      error_file_too_large: `La imagen de avatar debe ser de {max_size}MB o menos.`,
      error_download_timeout: `La descarga del avatar agotó el tiempo de espera. Por favor, inténtalo de nuevo.`,
      error_download_failed: `Falló la descarga de la imagen del avatar.`,
      processing_title: `Generando personalidad...`,
      processing_description: `Esto puede tardar de 1 a 2 minutos. Por favor, espera mientras genero el personaje...

Esto puede producir resultados inesperados. Puedes volver a generarlo si es necesario.`,
      captioning_title: `Describiendo tu avatar...`,
      captioning_description: `Tu modelo principal no puede ver imágenes, así que primero le pido a tu modelo de visión (**{model_name}**) que describa el avatar subido. Después, tu modelo principal escribe la personalidad a partir de esa descripción. Esto puede tardar 1-2 minutos.`,
      generation_failed_title: `🔴 Generación fallida`,
      generation_failed_description: `Falló la generación de personalidad: {error}

Por favor, inténtalo de nuevo con diferentes entradas o revisa tu clave de API.`,
      vision_caption_failed_title: `🔴 No se pudo describir el avatar`,
      vision_caption_failed_description: `Tu modelo de visión (**{vision_model_name}** en {vision_provider}) no pudo describir el avatar subido.

**Próximos pasos:**
1. Revisa la clave de API de ese proveedor con \`/providers\`, O
2. Elimina la imagen y vuelve a generar, O
3. Configura otro modelo de visión en \`/config\` > Modelos`,
      validation_failed_title: `🔴 Validación fallida`,
      validation_failed_description: `Los datos de personalidad generados fallaron la validación. Por favor, inténtalo de nuevo.`,
      image_processing_failed_title: `🔴 Procesamiento de imagen fallido`,
      image_processing_failed_description: `No se pudo procesar la imagen subida. Por favor, prueba con otra imagen.`,
      avatar_fetch_failed_title: `🔴 Falló la obtención del avatar`,
      avatar_fetch_failed_description: `No se pudo obtener el avatar del servidor para exportar. Por favor, intenta subir una imagen en su lugar.`,
      metadata_embed_failed_title: `🔴 Exportación fallida`,
      metadata_embed_failed_description: `No se pudieron incrustar los datos de personalidad en la imagen. Por favor, inténtalo de nuevo.`,
      success_title: `🟢 ¡{character_name} generado con éxito!`,
      success_description: `¡He generado una persona para **{character_name}**!
**Vista previa de atributos:**
{attribute_preview}
**Diálogos de ejemplo:**
{dialogue_preview}`,
      success_next_steps_title: `Próximos pasos`,
      success_next_steps_description: `1. Descarga el archivo PNG adjunto a la derecha
2. Usa \`/persona import\` con el PNG
O presiona el botón Importar`,
      success_next_steps_description_dm: `1. Descarga el archivo PNG adjunto
2. Usa \`/persona import\` con el PNG
3. Ejecuta \`/refresh\` para aplicar mi nueva personalidad`,
      success_next_steps_footer: `Después puedes personalizarme más en \`/config\`.`,
      avatar_update_skipped_dm: `Ten en cuenta que las actualizaciones de avatar y apodo no están disponibles para importar en Mensajes Directos.`,
    },
    create: {
      description: `Crea un preajuste de personalidad sencillo manualmente`,
      modal: {
        title: `Crear persona`,
        character_name_label: `Nombre del personaje`,
        character_name_description: `Nombres separados por comas: todos serán palabras de activación; el primero será el nombre.`,
        character_name_placeholder: `ej. Hatsune Miku, Miku, 初音ミク`,
        character_desc_label: `Descripción del personaje`,
        character_desc_placeholder: `Describe a tu personaje (personalidad, apariencia, historia, etc.)`,
        example_user_label: `Mensaje de usuario de ejemplo`,
        example_user_description: `Consejo: agrega más usando /persona sample-dialogue add después`,
        example_user_placeholder: `¡Hola {bot}!`,
        example_bot_label: `Respuesta de bot de ejemplo`,
        example_bot_placeholder: `¡Hola {user}! ¿Cómo estás?`,
        file_upload_label: `Imagen del personaje (Opcional)`,
        file_upload_description: `Sube una imagen para exportar el personaje`,
      },
      field_character_name: `Nombre del personaje`,
      field_character_desc: `Descripción del personaje`,
      field_example_user: `Mensaje de usuario de ejemplo`,
      field_example_bot: `Respuesta de bot de ejemplo`,
      invalid_image_title: `🔴 Imagen inválida`,
      invalid_image_description: `Por favor, sube un archivo de imagen válido (PNG, JPG, JPEG, etc.).`,
      error_file_too_large: `La imagen de avatar debe ser de {max_size}MB o menos.`,
      error_download_timeout: `La descarga del avatar agotó el tiempo de espera. Por favor, inténtalo de nuevo.`,
      error_download_failed: `Falló la descarga de la imagen del avatar.`,
      desc_too_long_title: `Descripción demasiado larga`,
      desc_too_long_description: `La descripción del personaje es demasiado larga ({current_length} caracteres). La longitud máxima permitida es de {max_allowed} caracteres.`,
      example_user_too_long_title: `Mensaje de usuario de ejemplo muy largo`,
      example_user_too_long_description: `El mensaje de usuario de ejemplo es demasiado largo ({current_length} caracteres). La longitud máxima permitida es de {max_allowed} caracteres.`,
      example_bot_too_long_title: `Respuesta de bot de ejemplo muy larga`,
      example_bot_too_long_description: `La respuesta de bot de ejemplo es demasiado larga ({current_length} caracteres). La longitud máxima permitida es de {max_allowed} caracteres.`,
      validation_failed_title: `🔴 Validación fallida`,
      validation_failed_description: `Los datos del preajuste fallaron la validación. Por favor, inténtalo de nuevo.`,
      image_processing_failed_title: `🔴 Procesamiento de imagen fallido`,
      image_processing_failed_description: `No se pudo procesar la imagen subida. Por favor, prueba con otra imagen.`,
      avatar_fetch_failed_title: `🔴 Falló la obtención del avatar`,
      avatar_fetch_failed_description: `No se pudo obtener el avatar del servidor para exportar. Por favor, intenta subir una imagen en su lugar.`,
      metadata_embed_failed_title: `🔴 Exportación fallida`,
      metadata_embed_failed_description: `No se pudieron incrustar los datos de personalidad en la imagen. Por favor, inténtalo de nuevo.`,
      success_title: `🟢 ¡{character_name} creado con éxito!`,
      success_description: `**Descripción:**
{character_description}`,
      success_dialogue_title: `Diálogo de ejemplo`,
      success_next_steps_title: `Próximos pasos`,
      success_next_steps_description: `1. Descarga el archivo PNG adjunto a la derecha
2. Usa \`/persona import\` con el PNG
O presiona el botón Importar`,
      success_next_steps_footer: `Después puedes personalizarme más en \`/config\`.`,
      avatar_update_skipped_dm: `Ten en cuenta que las actualizaciones de avatar y apodo no están disponibles en Mensajes Directos.`,
    },
  },
};
