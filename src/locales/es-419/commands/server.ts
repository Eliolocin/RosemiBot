export default {
  server: {
    timezone: {
      value_description: `Horas de desfase UTC (predeterminado: 0). Ejemplos: 8, -5, 0, 9.`,
    },
    stm: {
      parameters: {
        supersede_option: `Reemplazar (las categorías reemplazan los turnos sin procesar)`,
        crude_summary_option: `Sin procesar + resumen (mostrar ambos de forma aditiva)`,
      },
      "prompt-edit": {
        tool_description_label: `Descripción de herramienta`,
        tool_description_description: `Cómo se describe la herramienta de memoria a corto plazo al modelo.`,
        update_nudge_label: `Aviso de memoria`,
        update_nudge_description: `Prompt inyectado en el contexto que insta al modelo a usar la herramienta de memoria a corto plazo.`,
      },
      "categories-edit": {
        slot_1_label: `Categoría 1`,
        slot_2_label: `Categoría 2`,
        slot_3_label: `Categoría 3`,
        slot_4_label: `Categoría 4`,
        slot_5_label: `Categoría 5`,
        slot_instructions: `Caja = "Etiqueta: Descripción" (ej. "Metas: objetivos de equipo"). Vacío se omite; borrar todos reinicia.`,
        slot_placeholder: `Etiqueta: Descripción`,
      },
    },
    "crosschannel-blocklist": {
      channel_label_forum: `{channel_name} [Foro]`,
      channel_label_media: `{channel_name} [Multimedia]`,
    },
    cooldown: {
      triggers: {
        cooldown_type_description: `Cómo se aplican los enfriamientos (predeterminado: apagado; por usuario, por canal, en todo el servidor).`,
        cooldown_length_description: `Duración del enfriamiento en segundos (1-86400, predeterminado: 5).`,
        type: {
          choice_off: `Apagado`,
          choice_per_user: `Por usuario`,
          choice_per_channel: `Por canal`,
          choice_server_wide: `En todo el servidor`,
          choice_strict_server_wide: `Estricto en todo el servidor`,
        },
      },
    },
    "member-permissions": {
      servermemories_option: `Memorias del servidor`,
      attributelist_option: `Lista de atributos`,
      sampledialogues_option: `Diálogos de muestra`,
      promptsnapshot_option: `Capturas de prompt`,
      servermemories_desc: `Añadir/quitar memorias de todo el servidor`,
      attributelist_desc: `Añadir/quitar atributos de personalidad`,
      sampledialogues_desc: `Añadir/quitar pares de diálogo de muestra`,
      promptsnapshot_desc: `Ver prompts completos desde /context y /tool prompt snapshot`,
      select_placeholder: `Selecciona qué pueden hacer los miembros conmigo`,
      select_embed_title: `Permisos de miembros del servidor`,
      select_embed_description: `Selecciona qué cosas pueden hacer los miembros que no son administradores. Marcado = permitido.`,
    },

    alwaysreply: {
      description: `Alternar el modo de respuesta siempre para la persona principal.`,
    },
    deliberatetriggermode: {
      description: `Alternar el modo de activación deliberada para este servidor.`,
    },
    deliberatetoolmode: {
      description: `Alternar el modo de herramientas deliberado para este servidor.`,
    },
    "deliberate-tool-mode": {
      description: `Alternar el modo de herramientas deliberado para este servidor.`,
    },
  },
};
