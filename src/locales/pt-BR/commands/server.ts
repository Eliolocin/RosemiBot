export default {
  server: {
    timezone: {
      value_description: `Horas de deslocamento UTC (padrão: 0). Exemplos: 8, -5, 0, 9.`,
    },
    stm: {
      parameters: {
        supersede_option: `Substituir (categorias substituem turnos brutos)`,
        crude_summary_option: `Bruto + resumo (mostrar ambos de forma aditiva)`,
      },
      "prompt-edit": {
        tool_description_label: `Descrição da Ferramenta`,
        tool_description_description: `Como a ferramenta de MCP é descrita para o modelo.`,
        update_nudge_label: `Lembrete de Memória`,
        update_nudge_description: `Prompt injetado no contexto que incentiva o modelo a usar a ferramenta de MCP.`,
      },
      "categories-edit": {
        slot_1_label: `Categoria 1`,
        slot_2_label: `Categoria 2`,
        slot_3_label: `Categoria 3`,
        slot_4_label: `Categoria 4`,
        slot_5_label: `Categoria 5`,
        slot_instructions: `Caixa = "Rótulo: Descrição" (ex. "Metas: objetivos"). Vazias ignoradas; limpar todas redefine.`,
        slot_placeholder: `Rótulo: Descrição`,
      },
    },
    "crosschannel-blocklist": {
      channel_label_forum: `{channel_name} [Fórum]`,
      channel_label_media: `{channel_name} [Mídia]`,
    },
    cooldown: {
      triggers: {
        cooldown_type_description: `Como o tempo de recarga se aplica (padrão: desativado; por usuário, canal ou servidor).`,
        cooldown_length_description: `Duração do tempo de recarga em segundos (1-86400, padrão: 5).`,
        type: {
          choice_off: `Desativado`,
          choice_per_user: `Por Usuário`,
          choice_per_channel: `Por Canal`,
          choice_server_wide: `Em Todo o Servidor`,
          choice_strict_server_wide: `Estrito em Todo o Servidor`,
        },
      },
    },
    "member-permissions": {
      servermemories_option: `Memórias do Servidor`,
      attributelist_option: `Lista de Atributos`,
      sampledialogues_option: `Diálogos de Exemplo`,
      promptsnapshot_option: `Capturas de Prompt`,
      servermemories_desc: `Adicionar/remover memórias de todo o servidor`,
      attributelist_desc: `Adicionar/remover atributos de personalidade`,
      sampledialogues_desc: `Adicionar/remover pares de diálogo de exemplo`,
      promptsnapshot_desc: `Ver prompts completos em /context e /tool prompt snapshot`,
      select_placeholder: `Selecione o que os membros podem fazer comigo`,
      select_embed_title: `Permissões de Membros do Servidor`,
      select_embed_description: `Selecione o que membros não administradores podem fazer. Marcado = permitido.`,
    },

    alwaysreply: {
      description: `Alternar modo de resposta sempre ativa para a persona principal.`,
    },
    deliberatetriggermode: {
      description: `Alternar modo de gatilho deliberado (MGD) para este servidor.`,
    },
    deliberatetoolmode: {
      description: `Alternar modo de ferramenta deliberado para este servidor.`,
    },
    "deliberate-tool-mode": {
      description: `Alternar modo de ferramenta deliberado para este servidor.`,
    },
  },
};
