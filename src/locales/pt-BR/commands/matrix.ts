export default {
  matrix: {
    description: `Vincule canais do Discord a salas do Matrix para retransmissão bidirecional.`,
    link: {
      description: `Vincule um canal do Discord a uma sala do Matrix para retransmissão bidirecional`,
      channel_description: `O canal do Discord para vincular`,
      room_description: `O ID da sala do Matrix para vincular (ex: !abc:matrix.org)`,
      success_title: `Sala do Matrix Vinculada`,
      success_description: `<#{channel_id}> agora está conectado a \`{room_id}\`. Minhas mensagens aparecerão na sala do Matrix, e mensagens do Matrix aparecerão aqui.

Abra {help_matrix}, depois Integrações > Matrix, para passos de configuração, notas sobre comandos exclusivos do Matrix e a lista atual de limitações.`,
      invalid_room_title: `ID da Sala Inválido`,
      invalid_room_description: `O ID da sala do Matrix deve começar com \`!\` e conter um \`:\` (ex: \`!abc:matrix.org\`). Por favor, verifique o ID da sala e tente novamente.`,
      join_failed_description: `<#{channel_id}> foi vinculado a \`{room_id}\`, mas eu não consegui entrar na sala do Matrix automaticamente. Por favor, convide \`{bot_user_id}\` para a sala manualmente. Se você precisar dos passos de configuração e lista de limitações, abra {help_matrix} e vá para Integrações > Matrix.`,
      encrypted_room_title: `Não é Possível Vincular Sala Criptografada`,
      encrypted_room_description: `\`{room_id}\` tem criptografia ponta a ponta ativada. A criptografia do Matrix não pode ser desativada uma vez definida, então esta sala não pode ser usada para ponte. Por favor, crie uma nova sala do Matrix **sem** criptografia e convide \`{bot_user_id}\` para ela.`,
      encryption_unknown_title: `Não Foi Possível Verificar a Criptografia da Sala`,
      encryption_unknown_description: `Não consegui confirmar se \`{room_id}\` não é criptografada, por isso não a vinculei. Só faço ponte com salas que posso verificar, pois as mensagens são transmitidas como texto sem formatação.

Convide \`{bot_user_id}\` para a sala, espere que ele entre e execute este comando novamente. Se o bot já estiver na sala, o homeserver pode estar inacessível; tente novamente em alguns minutos.`,
      matrix_not_configured_title: `Ponte Matrix Não Disponível`,
      matrix_not_configured_description: `A ponte Matrix não está configurada nesta instância do bot. Contate o dono do bot para ativá-la.`,
    },
    unlink: {
      description: `Remova a conexão da ponte Matrix de um canal do Discord`,
      channel_description: `O canal do Discord para desvincular da sua sala do Matrix`,
      success_title: `Sala do Matrix Desvinculada`,
      success_description: `<#{channel_id}> não está mais conectado a nenhuma sala do Matrix.`,
      not_linked_title: `Não Vinculado`,
      not_linked_description: `<#{channel_id}> não tem uma sala do Matrix vinculada a ele.`,
    },
  },
};
