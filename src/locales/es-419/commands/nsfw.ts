export default {
  nsfw: {
    description: `Comandos y ajustes con restricción de edad.`,
    persona: {
      description: `Comandos de persona con restricción de edad.`,
      default: {
        description: `Aplica una configuración de personalidad preajustada NSFW`,
      },
      import: {
        description: `Importa una persona desde un archivo PNG, JSON o CHARX, incluidas las personas NSFW`,
      },
    },
    jailbreaks: {
      description: `Administra comportamientos opcionales de jailbreak para mis prompts en este servidor.`,
      modal_title: `Administrar estrategias de jailbreak`,
      checkbox_label: `Estrategias de jailbreak habilitadas`,
      checkbox_description: `Las marcadas siguen habilitadas. Las desmarcadas se deshabilitan.`,
      injection_option: `Inyección de prompt (reconocimiento +18)`,
      unicode_spaces_option: `Reemplazo de espacios Unicode`,
      sanitize_option: `Saneamiento de palabras sensibles`,
      no_changes_title: `Sin cambios realizados`,
      no_changes_description: `La lista de estrategias de jailbreak quedó sin cambios.`,
      success_title: `Estrategias de jailbreak actualizadas`,
      success_description: `Se actualizaron tus ajustes de estrategia de jailbreak. **{enabled_count}** opción(es) están habilitadas actualmente.`,
    },
  },
};
