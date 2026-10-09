export default {
  troubleshoot: {
    description: "Obtenha ajuda com algo que a TomoriBot fez.",
    chat: {
      description: "Cria um arquivo privado sobre um problema recente no chat.",
      message_description: "Link opcional para sua mensagem ou para a resposta da TomoriBot neste canal.",
      minutes_description: "Há quantos minutos aproximadamente o problema aconteceu (1-60).",
      invalid_request_title: "🔴 Solicitação Inválida",
      choose_one: "Use apenas um link de mensagem ou os minutos decorridos.",
      invalid_minutes: "Escolha um número de minutos entre 1 e 60.",
      invalid_link: "Use um link de mensagem do Discord deste canal.",
      no_recent_chat_title: "🟡 Sem Detalhes de Chat Recentes",
      no_recent_chat:
        "Não encontrei detalhes de chat recentes para nenhuma de suas mensagens aqui. Tente logo após o problema acontecer ou use um link de mensagem da última hora.",
      dm_title: "Arquivo de Diagnóstico do Chat",
      dm_description:
        "Aqui está o seu arquivo de diagnóstico do chat. Ele contém horários e contagens de eventos, sem textos do chat nem IDs diretos de usuários ou mensagens, então você pode compartilhá-lo ao pedir ajuda.",
      success_title: "🟢 Arquivo de Diagnóstico Pronto",
      dm_sent: "Enviei o arquivo de diagnóstico para as suas DMs.",
      dm_fallback: "Não consegui enviar uma DM para você, então anexei o arquivo de diagnóstico aqui de forma privada.",
    },
  },
};
