export default {
  persona: {
    description: `Gerenciar predefinições de personalidade`,
    "image-tags": {
      modal_title: `Tags de Imagem da Persona`,
      tags_input_label: `Tags de Aparência Física`,
      tags_input_description: `Tags de aparência física separadas por vírgula no estilo imageboard para esta persona. Deixe em branco para limpar.`,
      tags_input_placeholder: `cabelo branco curto, olhos vermelhos, uniforme escolar`,
      no_tags_title: `Nenhuma Tag Fornecida`,
      no_tags_description: `Por favor, forneça pelo menos uma tag de aparência física.`,
      too_many_tags_title: `Muitas Tags`,
      too_many_tags_description: `Você pode definir no máximo {max_tags} tags de imagem por persona.`,
      tag_too_long_title: `Tag Muito Longa`,
      tag_too_long_description: `Cada tag de imagem deve ter {max_length} caracteres ou menos.`,
      success_title: `Aparência Física Atualizada`,
      success_description: `Tags de aparência física atualizadas para **{persona_name}**:
\`\`\`
{tag_list}
\`\`\``,
      cleared_title: `Aparência Física Limpa`,
      cleared_description: `Tags de aparência física limpas para **{persona_name}**.`,
    },
    sprites: {
      add: {
        sprite_name_label: `Nome do Sprite`,
        sprite_name_description: `Rótulo usado para o sprite. Reutilizar um rótulo substitui o sprite correspondente.`,
        sprite_name_placeholder: `brava`,
        image_label: `Imagem do Sprite`,
        image_description: `Envie um arquivo PNG, JPG ou GIF. Ele será convertido para PNG.`,
        instructions_label: `Instruções de Uso`,
        instructions_description: `Orientação opcional de quando este sprite deve ser usado.`,
        instructions_placeholder: `Use quando estiver brava, irritada ou visivelmente chateada.`,
        identity_label: `Salvar como Identidade`,
        identity_description: `Mostra o nome decorado "Sprite (Persona)" no Discord, útil para identidades de alter. Desligado = normal.`,
      },
      edit: {
        image_description: `Opcional. Envie um PNG, JPG ou GIF para substituir a imagem do sprite.`,
        identity_status_on: `Identidade`,
        identity_status_off: `Sprite normal`,
      },
      import: {
        archive_label: `Arquivo de Sprite`,
        archive_description: `Envie um arquivo .zip criado por /persona sprites export.`,
      },
    },
    attribute: {
      description: `Gerenciar atributos da persona.`,
      add: {
        description: `Adicionar um atributo a uma persona.`,
      },
      remove: {
        description: `Remover um atributo de uma persona.`,
      },
    },
    prompt: {
      description: `Gerenciar instruções de prompt da persona.`,
      set: {
        description: `Definir um prompt da persona.`,
      },
      remove: {
        description: `Remover um prompt da persona.`,
      },
    },
    "sample-dialogue": {
      description: `Adicionar um par de diálogo usuário/bot de exemplo para mostrar como devo responder.`,
      add: {
        description: `Adicionar um par de diálogo usuário/bot de exemplo para mostrar como devo responder.`,
      },
      remove: {
        description: `Remover um par de diálogo usuário/bot de exemplo da minha memória.`,
      },
    },
    name_conflict_title: `🔴 Conflito de Nome de Persona`,
    name_conflict_description: `Uma persona chamada **{name}** já existe neste servidor. Nomes de persona devem ser únicos dentro de um servidor.`,
    export: {
      description: `Exportar a personalidade atual como um arquivo PNG compartilhável`,
      export_json_select_label: `Exportar JSON`,
      export_json_select_description: `Opcional: exportar um arquivo JSON importável em vez disso (sem imagem de avatar)`,
      persona_modal_title: `Selecionar Persona`,
      persona_select_label: `Persona`,
      persona_select_description: `Escolha qual persona exportar.`,
      persona_select_placeholder: `Selecione uma persona...`,
      main_persona_description: `Persona Principal`,
      alter_persona_description: `Alter`,
      success_title: `🟢 Persona Exportada com Sucesso`,
      success_description: `A persona atual **{nickname}** foi exportada! Compartilhe este arquivo PNG com outros para espalhar esta configuração de personalidade.`,
      success_description_json: `A persona atual **{nickname}** foi exportada como um arquivo JSON.

**Nota:** Este JSON pode ser reimportado com \`/persona import\`. Ele não inclui a imagem do avatar. Use a exportação em PNG para compartilhar o avatar também.`,
      json_importable_note: `Esta exportação em JSON pode ser importada com /persona import. Ela não inclui a imagem do avatar; use a exportação em PNG para compartilhar o avatar também.`,
      failed_title: `🔴 Falha na Exportação`,
      avatar_failed_title: `🔴 Falha no Download do Avatar`,
      avatar_failed_description: `Falha ao baixar o avatar da persona. Por favor, tente novamente mais tarde.`,
      embed_failed_title: `🔴 Falha no Processamento do PNG`,
      embed_failed_description: `Falha ao incorporar metadados no arquivo PNG. Por favor, tente novamente.`,
      error_no_server_data: `Servidor não encontrado no banco de dados. Por favor, execute /setup primeiro.`,
      error_no_preset_data: `Dados da persona não encontrados. Por favor, execute /setup primeiro.`,
      error_validation_failed: `Falha ao validar a estrutura de dados da exportação`,
      error_export_failed: `Falha ao exportar os dados da persona`,
    },
    import: {
      description: `Importar uma persona a partir de um arquivo PNG, JSON ou CHARX`,
      file_description: `Arquivo PNG, JSON ou CHARX contendo os dados da persona`,
      type_description: `Importar como persona principal ou alter`,
      triggers_description: `Palavras-gatilho extras opcionais, separadas por vírgula ("," ou "、")`,
      memories_description: `Preservar as memórias do servidor e do usuário desta persona?`,
      memories_choice_preserve: `Sim, preservar memórias do usuário/servidor`,
      memories_choice_fork: `Não, começar novas memórias do usuário/servidor`,
      type_choice_main: `Persona Principal (substitui a persona atual)`,
      type_choice_alter: `Alter`,
      success_title: `🟢 Persona Importada com Sucesso`,
      success_description: `Persona **{nickname}** importada com sucesso!
Atributos: {attribute_count}
Diálogos de Exemplo: {dialogue_count}
Palavras-gatilho: {trigger_word_count}`,
      success_confirmation: `Persona principal **{nickname}** importada com sucesso! As informações detalhadas da importação foram postadas no canal.`,
      post_missing_permission: `Persona importada, mas não consegui publicar a confirmação. Peça a um administrador que me conceda {permission} neste canal.`,
      nickname_update_success: `O apelido do servidor foi atualizado.`,
      nickname_update_failed: `🟡 O apelido do servidor não pôde ser atualizado, provavelmente devido aos limites de taxa do Discord. Por favor, altere-o manualmente.`,
      avatar_update_success: `O avatar do servidor foi atualizado.`,
      avatar_update_skipped_no_image: `🟡 O arquivo importado não incluiu uma imagem de avatar, então o avatar atual da persona principal foi mantido.`,
      avatar_update_rate_limited: `🟡 O avatar do servidor não foi atualizado devido aos limites de taxa do Discord. Por favor, altere-o manualmente.`,
      avatar_update_failed: `🟡 O avatar do servidor não pôde ser atualizado, provavelmente devido aos limites de taxa do Discord. Por favor, altere-o manualmente.`,
      alter_success_title: `🟢 Alter Importado com Sucesso`,
      alter_success_description: `Alter **{nickname}** importado com sucesso!
Palavras-gatilho Únicas: {trigger_count}
Gatilhos: {triggers}

Esta persona responderá quando esses gatilhos aparecerem nas mensagens.`,
      alter_success_confirmation: `Alter **{nickname}** importado com sucesso com {trigger_count} palavras-gatilho únicas! As informações detalhadas da importação foram postadas no canal.`,
      alter_avatar_fallback_main: `🟡 Esta importação não incluiu uma imagem de avatar, então este alter está usando o avatar atual da persona principal de **{nickname}** como substituto. Você pode alterá-lo usando \`/config\` > Persona > Geral.`,
      alter_avatar_warning: `⚠️ Não exclua o embed da imagem do avatar acima, ou o avatar do alter será perdido.`,
      alter_dm_not_allowed_title: `🔴 Alters Não Permitidos em DMs`,
      alter_dm_not_allowed_description: `Alters só podem ser importados em servidores, não em Mensagens Diretas. Por favor, execute este comando em um servidor.`,
      alter_no_triggers_warning: `⚠️ Esta persona não tem palavras-gatilho. Ela não responderá a nenhuma mensagem até que você adicione gatilhos usando \`/config\` > Persona > Geral.`,
      alter_name_conflict_title: `🔴 Nome de Persona Já Existe`,
      alter_name_conflict_description: `Uma persona com o nome **{name}** já existe neste servidor. Cada persona deve ter um nome único.

Por favor, edite o arquivo de importação para usar um nome diferente, ou remova a persona existente usando \`/persona remove\`.`,
      alter_limit_title: `🔴 Limite de Personas Atingido`,
      alter_limit_description: `Este servidor já possui {current} personas. O máximo permitido é {max}. Por favor, remova um alter com \`/persona remove\` antes de importar um novo.`,
      failed_title: `🔴 Falha na Importação`,
      failed_description: `Falha ao importar a persona. Por favor, verifique o arquivo e tente novamente.`,
      sprite_snapshot_failed_description: `A importação foi cancelada porque os sprites atuais da persona não puderam ser lidos. Nenhum dado da persona foi alterado. Por favor, tente novamente.`,
      sprite_cleanup_failed_description: `A persona foi importada, mas as linhas de sprite anteriores não puderam ser limpas. A importação está incompleta. Por favor, tente novamente ou contate um administrador.`,
      sprite_storage_cleanup_partial_description: `A persona foi importada, mas {failed_count} imagem(ns) de sprite anterior(es) não pôde(eram) ser excluída(s) do armazenamento.`,
      invalid_file_type_title: `🔴 Tipo de Arquivo Inválido`,
      invalid_file_type_description: `Por favor, envie um arquivo .png, .json ou .charx válido contendo os dados da persona.`,
      file_too_large_title: `🔴 Arquivo Muito Grande`,
      file_too_large_description: `O arquivo é muito grande. O tamanho máximo do arquivo é {max_size}MB.`,
      download_failed_title: `🔴 Falha no Download`,
      download_failed_description: `Falha ao baixar o arquivo anexado. Por favor, tente novamente.`,
      invalid_charx_title: `🔴 Arquivo de Character Card Inválido`,
      invalid_charx_description: `Este arquivo .charx não pôde ser lido como um arquivo de Character Card V3. Baixe o cartão novamente do site onde ele está hospedado, ou exporte o cartão como um .png em vez disso.`,
      card_conversion_failed_title: `🟡 Character Card Detectado, Falha na Conversão`,
      card_conversion_failed_description: `Um cartão foi decodificado de **{source}**, mas a conversão para o formato Tomori falhou. A carga decodificada está anexada para inspeção. Por favor, reporte isso através de \`/support discord\` e inclua o arquivo anexado.`,
      charx_not_card_description: `Este arquivo .charx foi aberto, mas o cartão dentro dele não é um character card. Certifique-se de que o arquivo seja o próprio character card e não outro arquivo baixado na mesma ocasião.`,
      charx_too_large_description: `O cartão dentro deste arquivo é muito grande para importar. O tamanho máximo do cartão é {max_size}MB.`,
      charx_assets_too_large_description: `Este cartão agrupa mais mídia do que a importação pode inspecionar. Tente um cartão exportado sem suas imagens, áudios ou vídeos.`,
      charx_assets_ignored_description: `🟡 As imagens, sons e outras mídias agrupadas deste cartão não foram importadas. Apenas o texto da persona foi lido. Você pode definir um avatar com \`/server avatar\` e adicionar sprites em \`/config\` > Persona > Sprites.`,
      invalid_png_title: `🔴 Arquivo PNG Inválido`,
      invalid_png_description: `O arquivo enviado não é uma imagem PNG válida.`,
      no_metadata_title: `🔴 Nenhum Dado de Persona Encontrado`,
      no_metadata_description: `Este arquivo não contém dados de persona suportados. Use um arquivo exportado por \`/persona export\` ou um character card do SillyTavern suportado.`,
      invalid_file_title: `🔴 Arquivo de Persona Inválido`,
      invalid_file_description: `O formato do arquivo de persona é inválido ou incompatível.`,
      no_permission_title: `🔴 Permissão Negada`,
      no_permission_description: `Você precisa da permissão **Gerenciar Servidor** para importar personas.`,
      error_download_timeout: `O download do arquivo atingiu o tempo limite. Por favor, tente novamente.`,
      error_invalid_attribute: `Conteúdo de atributo inválido: {details}`,
      error_attribute_flags_mismatch: `As flags de visibilidade do atributo devem corresponder ao comprimento da lista de atributos.`,
      error_invalid_dialogue_in: `Diálogo de exemplo inválido (entrada): {details}`,
      error_invalid_dialogue_out: `Diálogo de exemplo inválido (saída): {details}`,
      error_invalid_trigger_word: `Palavra-gatilho inválida: {details}`,
      error_dialogue_mismatch: `As arrays de diálogo de exemplo não coincidem em comprimento`,
      error_invalid_config: `Campos de configuração inválidos nos dados da persona`,
      error_no_server_data: `Servidor não encontrado no banco de dados. Por favor, execute \`/setup\` primeiro.`,
      error_name_conflict: `Uma persona com o nome **{name}** já existe neste servidor. Por favor, use um nome diferente.`,
      error_nsfw_persona: `Esta persona está marcada como NSFW, então \`/persona import\` não pode carregá-la. Use \`/nsfw persona import\`.`,
      error_import_failed: `Falha ao importar os dados da persona`,
      error_not_json: `O arquivo importado deve conter dados JSON válidos`,
      error_incompatible_version: `Versão da predefinição incompatível. Esperado {expected}, obtido {actual}`,
      error_invalid_format: `Formato de arquivo de persona inválido`,
      error_invalid_type: `Tipo de persona inválido: {type}. Esperado "preset"`,
      avatar_update_skipped_dm: `A persona foi importada com sucesso, exceto as atualizações de avatar e apelido que não estão disponíveis nas Mensagens Diretas`,
      refresh_reminder: `Execute \`/refresh\` para aplicar a atualização da persona neste chat`,
    },
    remove: {
      description: `Remover um alter do servidor`,
      no_permission_title: `🔴 Permissão Negada`,
      no_permission_description: `Você precisa da permissão **Gerenciar Servidor** para remover alters.`,
      modal_title: `Remover Alter`,
      select_label: `Alter`,
      select_placeholder: `Escolha um alter para remover...`,
      no_alters_error_title: `🟡 Nenhum Alter`,
      no_alters_error_description: `Não há alters para remover. Importe alters usando \`/persona import type:alter\`.`,
      success_title: `🟢 Alter Removido`,
      success_description: `O alter **{nickname}** foi removido com sucesso.`,
    },
    default: {
      description: `Aplicar uma predefinição de personalidade`,
      type_description: `Mirar na persona principal/padrão ou criar como alter`,
      type_choice_default: `Persona Principal (substitui a persona atual)`,
      type_choice_alter: `Alter`,
      no_permission_title: `🔴 Permissão Negada`,
      no_permission_description: `Você precisa da permissão **Gerenciar Servidor** para aplicar predefinições de personalidade.`,
      modal_title: `Aplicar Predefinição de Personalidade`,
      select_label: `Predefinição de Personalidade`,
      select_description: `Escolha uma predefinição para aplicar. Isso sobrescreverá os atributos e diálogos atuais.`,
      select_placeholder: `Escolha uma predefinição...`,
      no_presets_title: `Nenhuma Predefinição Disponível`,
      no_presets_description: `Não há predefinições de personalidade disponíveis para o seu idioma. Por favor, reporte através de \`/support discord\`.`,
      preset_not_found: `A predefinição selecionada não pôde ser encontrada.`,
      success_title: `Predefinição Aplicada`,
      success_details_description: `Predefinição **{preset_name}** aplicada com sucesso à persona **{nickname}**!
Atributos: {attribute_count}
Diálogos de Exemplo: {dialogue_count}
Palavras-gatilho ({trigger_word_count}): {triggers}`,
      success_confirmation: `Predefinição aplicada a **{nickname}**. Informações detalhadas foram postadas neste canal.`,
      avatar_update_failed: `🟡️ O avatar do servidor não pôde ser atualizado devido a um erro da API do Discord, mas a persona foi aplicada com sucesso.`,
      avatar_update_skipped_dm: `A predefinição foi aplicada com sucesso, exceto pelas atualizações de avatar que não estão disponíveis em Mensagens Diretas`,
    },
    import_now: {
      button: `Importar Agora`,
      imported: `Importado`,
      already_imported_title: `🟡 Já Importado`,
      already_imported_description: `Esta persona já foi importada, ou uma importação está em andamento.`,
    },
    generate: {
      description: `Geração de personalidade baseada em IA (requer um provedor compatível)`,
      modal: {
        title: `Gerar Personalidade com IA`,
        character_name_label: `Nome do Personagem`,
        character_name_description: `Nomes separados por vírgula ("," ou "、"): todos viram gatilhos; o 1º vira o nome de exibição.`,
        character_name_placeholder: `ex: Hatsune Miku, Miku, 初音ミク`,
        character_info_label: `Info do Personagem & Exemplos de Fala`,
        character_info_description: `Descreva o personagem e como ele fala`,
        character_info_placeholder: `Personalidade, história, estilo de fala, exemplos de frases, etc.`,
        web_search_label: `Pesquisar na Web?`,
        web_search_description: `Pesquisar informações sobre o personagem (para personagens existentes da mídia)`,
        web_search_placeholder: `Selecione Sim ou Não`,
        web_search_yes: `Sim, pesquisar informações sobre o personagem`,
        web_search_no: `Não, criar personagem original`,
        additional_inst_label: `Instruções Adicionais`,
        additional_inst_placeholder: `Opcional: Outras instruções (ex: "por favor, mantenha as respostas do personagem curtas")`,
        file_upload_label: `Imagem do Personagem / Cartão (Opcional)`,
        file_upload_description: `Envie imagem, preset Tomori ou cartão PNG SillyTavern para gerar ou transformar a persona.`,
      },
      field_character_name: `Nome do Personagem`,
      field_character_info: `Info do Personagem & Exemplos de Fala`,
      field_web_search: `Pesquisar na Web?`,
      field_additional_inst: `Instruções Adicionais`,
      wrong_provider_title: `🔴 Provedor Incompatível`,
      wrong_provider_description: `A geração de predefinição requer um provedor compatível. Seu provedor atual é **{current_provider}**. Use \`/config\` > Modelos > Mudar Modelos para mudar para um provedor suportado.`,
      no_api_key_title: `🔴 Nenhuma Chave de API`,
      no_api_key_description: `Nenhum provedor ativo está configurado. Use \`/setup\` (primeira vez) ou \`/providers\` para registrar um.`,
      model_incompatible_title: `Modelo Incompatível`,
      model_incompatible_description: `Seu modelo atual (**{model_name}**) não suporta **SAÍDA ESTRUTURADA**, que é necessária para a geração de persona.

**Próximos passos:**
Use \`/config\` > Modelos > Mudar Modelos para mudar para um modelo que suporte saída estruturada (ex: modelos com a capacidade "STRUCT").`,
      image_vision_required_title: `🔴 Visão de Imagem Necessária`,
      image_vision_required_description: `Você enviou uma imagem, mas seu modelo atual (**{model_name}**) não suporta **VISÃO DE IMAGEM** e nenhum modelo de visão está configurado.

**Próximos passos:**
1. Use \`/config\` > Modelos > Mudar Modelos para definir um modelo de visão dedicado, OU
2. Use \`/config\` > Modelos > Mudar Modelos para mudar para um modelo capaz de visão, OU
3. Remova a imagem e gere novamente sem ela`,
      web_search_tools_required_title: `🔴 Pesquisa na Web Indisponível`,
      web_search_tools_required_description: `Você selecionou pesquisa na web, mas o modelo atual (**{model_name}**) não suporta **FERRAMENTAS**.

**Próximos passos:**
1. Use \`/config\` > Modelos > Mudar Modelos para mudar para um modelo com ferramentas habilitadas, OU
2. Gere novamente sem a pesquisa na web (escolha "Não" quando perguntado)`,
      api_key_decrypt_failed_title: `🔴 Erro na Chave de API`,
      api_key_decrypt_failed_description: `Falha ao descriptografar as credenciais do provedor ativo. Por favor, reconfigure-as usando \`/providers\`.`,
      vision_credentials_unavailable_title: `🔴 Credenciais do Modelo de Visão Indisponíveis`,
      vision_credentials_unavailable_description: `Seu modelo de visão (**{vision_model_name}**) roda no provedor **{vision_provider}**, mas sua chave de API salva não pôde ser usada para descrever a imagem. Reconfigure as credenciais desse provedor com \`/providers\`, ou verifique \`/config\` > Modelos.`,
      invalid_image_title: `🔴 Imagem Inválida`,
      invalid_image_description: `Por favor, envie um arquivo de imagem válido (PNG, JPG, JPEG, etc.).`,
      error_file_too_large: `A imagem do avatar deve ter {max_size}MB ou menos.`,
      error_download_timeout: `O download do avatar atingiu o tempo limite. Por favor, tente novamente.`,
      error_download_failed: `Falha ao baixar a imagem do avatar.`,
      processing_title: `Gerando Personalidade...`,
      processing_description: `Isso pode levar de 1 a 2 minutos. Por favor, aguarde enquanto o personagem é gerado...

Isso pode produzir resultados inesperados. Você pode gerar novamente se necessário.`,
      captioning_title: `Descrevendo seu avatar...`,
      captioning_description: `Seu modelo principal não consegue ver imagens, então primeiro peço ao seu modelo de visão (**{model_name}**) que descreva o avatar enviado. Depois, seu modelo principal escreve a personalidade a partir dessa descrição. Isso pode levar 1-2 minutos.`,
      generation_failed_title: `🔴 Falha na Geração`,
      generation_failed_description: `Falha ao gerar personalidade: {error}

Por favor, tente novamente com diferentes entradas ou verifique sua chave de API.`,
      vision_caption_failed_title: `🔴 Falha ao descrever o avatar`,
      vision_caption_failed_description: `Seu modelo de visão (**{vision_model_name}** em {vision_provider}) não conseguiu descrever o avatar enviado.

**Próximos passos:**
1. Verifique a chave de API desse provedor com \`/providers\`, OU
2. Remova a imagem e gere novamente, OU
3. Configure outro modelo de visão em \`/config\` > Modelos`,
      validation_failed_title: `🔴 Falha na Validação`,
      validation_failed_description: `Os dados da personalidade gerada falharam na validação. Por favor, tente novamente.`,
      image_processing_failed_title: `🔴 Falha no Processamento da Imagem`,
      image_processing_failed_description: `Falha ao processar a imagem enviada. Por favor, tente uma imagem diferente.`,
      avatar_fetch_failed_title: `🔴 Falha ao Obter o Avatar`,
      avatar_fetch_failed_description: `Falha ao obter o avatar do servidor para exportação. Por favor, tente enviar uma imagem em vez disso.`,
      metadata_embed_failed_title: `🔴 Falha na Exportação`,
      metadata_embed_failed_description: `Falha ao incorporar os dados da personalidade na imagem. Por favor, tente novamente.`,
      success_title: `🟢 {character_name} Gerado com Sucesso!`,
      success_description: `Uma persona para **{character_name}** foi gerada!
**Prévia dos Atributos:**
{attribute_preview}
**Diálogos de Exemplo:**
{dialogue_preview}`,
      success_next_steps_title: `Próximos Passos`,
      success_next_steps_description: `1. Baixe o arquivo PNG anexado à direita
2. Use \`/persona import\` com o PNG
Ou pressione o botão Importar`,
      success_next_steps_description_dm: `1. Baixe o arquivo PNG anexado
2. Use \`/persona import\` com o PNG
3. Execute \`/refresh\` para aplicar a nova personalidade`,
      success_next_steps_footer: `Depois você pode me personalizar mais em \`/config\`.`,
      avatar_update_skipped_dm: `Por favor, note que as atualizações de avatar e apelido não estão disponíveis para importação em Mensagens Diretas.`,
    },
    create: {
      description: `Criar uma predefinição de personalidade simples manualmente`,
      modal: {
        title: `Criar Persona`,
        character_name_label: `Nome do Personagem`,
        character_name_description: `Nomes separados por vírgula ("," ou "、"): todos viram gatilhos; o 1º vira o nome de exibição.`,
        character_name_placeholder: `ex: Hatsune Miku, Miku, 初音ミク`,
        character_desc_label: `Descrição do Personagem`,
        character_desc_placeholder: `Descreva seu personagem (personalidade, aparência, história, etc.)`,
        example_user_label: `Mensagem de Exemplo do Usuário`,
        example_user_description: `Dica: Adicione mais usando /persona sample-dialogue add depois`,
        example_user_placeholder: `Oi {bot}!`,
        example_bot_label: `Resposta de Exemplo do Bot`,
        example_bot_placeholder: `Olá {user}! Tudo bem com você?`,
        file_upload_label: `Imagem do Personagem (Opcional)`,
        file_upload_description: `Envie uma imagem para a exportação do personagem`,
      },
      field_character_name: `Nome do Personagem`,
      field_character_desc: `Descrição do Personagem`,
      field_example_user: `Mensagem de Exemplo do Usuário`,
      field_example_bot: `Resposta de Exemplo do Bot`,
      invalid_image_title: `🔴 Imagem Inválida`,
      invalid_image_description: `Por favor, envie um arquivo de imagem válido (PNG, JPG, JPEG, etc.).`,
      error_file_too_large: `A imagem do avatar deve ter {max_size}MB ou menos.`,
      error_download_timeout: `O download do avatar atingiu o tempo limite. Por favor, tente novamente.`,
      error_download_failed: `Falha ao baixar a imagem do avatar.`,
      desc_too_long_title: `Descrição Muito Longa`,
      desc_too_long_description: `A descrição do personagem é muito longa ({current_length} caracteres). O comprimento máximo permitido é de {max_allowed} caracteres.`,
      example_user_too_long_title: `Mensagem de Exemplo do Usuário Muito Longa`,
      example_user_too_long_description: `A mensagem de exemplo do usuário é muito longa ({current_length} caracteres). O comprimento máximo permitido é de {max_allowed} caracteres.`,
      example_bot_too_long_title: `Resposta de Exemplo do Bot Muito Longa`,
      example_bot_too_long_description: `A resposta de exemplo do bot é muito longa ({current_length} caracteres). O comprimento máximo permitido é de {max_allowed} caracteres.`,
      validation_failed_title: `🔴 Falha na Validação`,
      validation_failed_description: `Os dados da predefinição falharam na validação. Por favor, tente novamente.`,
      image_processing_failed_title: `🔴 Falha no Processamento da Imagem`,
      image_processing_failed_description: `Falha ao processar a imagem enviada. Por favor, tente uma imagem diferente.`,
      avatar_fetch_failed_title: `🔴 Falha ao Obter o Avatar`,
      avatar_fetch_failed_description: `Falha ao obter o avatar do servidor para exportação. Por favor, tente enviar uma imagem em vez disso.`,
      metadata_embed_failed_title: `🔴 Falha na Exportação`,
      metadata_embed_failed_description: `Falha ao incorporar os dados da personalidade na imagem. Por favor, tente novamente.`,
      success_title: `🟢 {character_name} Criado com Sucesso!`,
      success_description: `**Descrição:**
{character_description}`,
      success_dialogue_title: `Diálogo de Exemplo`,
      success_next_steps_title: `Próximos Passos`,
      success_next_steps_description: `1. Baixe o arquivo PNG anexado à direita
2. Use \`/persona import\` com o PNG
Ou pressione o botão Importar`,
      success_next_steps_footer: `Depois você pode me personalizar mais em \`/config\`.`,
      avatar_update_skipped_dm: `Por favor, note que as atualizações de avatar e apelido não estão disponíveis em Mensagens Diretas.`,
    },
  },
};
