export default {
  conditioning: {
    description: `Administra las memorias persistentes de recompensa y castigo.`,
    shared: {
      reason_line: `Motivo: \`\`{reason}\`\``,
      reward_footer: `❤️ {bot} recordará esto. Usa /conditioning para administrar.`,
      punish_footer: `💀 {bot} recordará esto. Usa /conditioning para administrar.`,
      persona_access_blocked_title: `No hay personas disponibles`,
      persona_access_blocked_description: `Tus permisos actuales de lista blanca y tu configuración personal de spotlight no dejan ninguna persona disponible para esta interacción en este canal.`,
      marker_reward: `❤️`,
      marker_punish: `💀`,
      option_reason_description: `{count} en total • motivo: "{reason}"`,
      option_reason_description_single: `motivo: "{reason}"`,
      option_label: `{type_marker} {persona_name} • {action}`,
    },
    manage: {
      description: `Administra el historial de condicionamiento inyectado entre todas las personas de este servidor.`,
    },
    remove: {
      description: `Elimina entradas de condicionamiento entre todas las personas de este servidor.`,
      empty_title: `No hay memorias de condicionamiento`,
      empty_description: `No hay entradas de condicionamiento persistentes para administrar en este servidor.`,
      page_select_prompt: `Se encontraron {total} entradas de condicionamiento. Selecciona un lote para eliminar:`,
      page_select_prompt_capped: `Se encontraron {total} entradas de condicionamiento. Las {shown} más recientes se
muestran a continuación; elimina algunas para llegar al resto.`,
    },
    panel: {
      remove_modal_title: `Eliminar condicionamiento`,
      remove_checkbox_label: `Entradas de condicionamiento`,
      remove_checkbox_label_continued: `Entradas de condicionamiento (continuación)`,
      remove_checkbox_description: `Desmarca cualquier entrada de condicionamiento que quieras eliminar.`,
      stale_heading: `Panel desactualizado`,
      stale_detail: `Las entradas de condicionamiento cambiaron. El panel se actualizó.`,
      no_changes_heading: `Sin cambios`,
      no_changes_detail: `No se desmarcó ninguna entrada de condicionamiento.`,
      success_heading: `Condicionamiento eliminado`,
      success_detail: `Se eliminaron {count} entrada(s) de condicionamiento.`,
      write_failed_heading: `Actualización fallida`,
      write_failed_detail: `No se pudo guardar el cambio. Intenta de nuevo.`,
    },
  },
};
