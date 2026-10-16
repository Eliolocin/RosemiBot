export default {
  conditioning: {
    description: `Gerencie memórias persistentes de condicionamento de recompensa e punição.`,
    shared: {
      reason_line: `Motivo: \`\`{reason}\`\``,
      reward_footer: `❤️ {bot} vai se lembrar disso. Use /conditioning para gerenciar.`,
      punish_footer: `💀 {bot} vai se lembrar disso. Use /conditioning para gerenciar.`,
      persona_access_blocked_title: `Nenhuma Persona Disponível`,
      persona_access_blocked_description: `Suas permissões atuais de lista de permissões e configurações de destaque pessoal não deixam nenhuma persona disponível para esta interação neste canal.`,
      marker_reward: `❤️`,
      marker_punish: `💀`,
      option_reason_description: `{count} total • devido a: "{reason}"`,
      option_reason_description_single: `devido a: "{reason}"`,
      option_label: `{type_marker} {persona_name} • {action}`,
    },
    manage: {
      description: `Gerencie o histórico de condicionamento injetado em todas as personas neste servidor.`,
    },
    remove: {
      description: `Remova entradas de condicionamento de todas as personas neste servidor.`,
      empty_title: `Sem Memórias de Condicionamento`,
      empty_description: `Não há entradas de condicionamento persistentes para gerenciar neste servidor.`,
      page_select_prompt: `Encontradas {total} entradas de condicionamento. Selecione um lote para remover:`,
      page_select_prompt_capped: `Encontradas {total} entradas de condicionamento. As {shown} mais recentes são
mostradas abaixo; remova algumas para alcançar o resto.`,
    },
    panel: {
      remove_modal_title: `Remover Condicionamento`,
      remove_checkbox_label: `Entradas de Condicionamento`,
      remove_checkbox_label_continued: `Entradas de Condicionamento (Continuação)`,
      remove_checkbox_description: `Desmarque todas as entradas de condicionamento que você deseja remover.`,
      stale_heading: `Painel Desatualizado`,
      stale_detail: `As entradas de condicionamento mudaram. O painel foi atualizado.`,
      no_changes_heading: `Sem Alterações`,
      no_changes_detail: `Nenhuma entrada de condicionamento foi desmarcada.`,
      success_heading: `Condicionamento Removido`,
      success_detail: `Removida(s) {count} entrada(s) de condicionamento.`,
      write_failed_heading: `Falha na Atualização`,
      write_failed_detail: `A alteração não pôde ser salva. Por favor, tente novamente.`,
    },
  },
};
