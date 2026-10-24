export default {
  help: {
    description: `Navegue por configurações, recursos, provedores, memória, ferramentas e guias de integração.`,
    dashboard: {
      categories: {
        setup: `Configuração`,
        features: `Recursos`,
        moderation: `Moderação`,
        plugins: `Plug-ins`,
      },
      pages: {
        custom_endpoints: `Endpoints Personalizados`,
      },
      page_reference: `a página **{page}** em \`/help\``,
      page_select_placeholder: `Escolha uma página`,
      subsection_select_placeholder: `Escolha um tópico`,
      provider_select_placeholder: `Escolha o Provedor`,
      optional_provider_select_placeholder: `Serviços Opcionais`,
      previous_button: `← Anterior`,
      next_button: `Próximo →`,
      docs_link_label: `Ler a Versão Web`,
      support_link_label: `Obter Suporte Técnico`,
      sections: {
        getting_started: `Primeiros Passos`,
        getting_started_description: `Chave, gatilhos, persona e o que testar a seguir`,
        personal_profile: `Perfil Pessoal`,
        personal_profile_description: `Seu apelido, suas memórias, seu próprio provedor`,
        custom_endpoints: `Endpoints Personalizados (Avançado)`,
        custom_endpoints_description: `Registre um endpoint que você gerencia ou confia`,
        multiple_personas: `Múltiplas personas`,
        multiple_personas_description: `Mantenha várias identidades e importe cartões`,
        media_generation: `Geração de mídia`,
        media_generation_description: `Crie imagens, vídeos e mensagens de voz`,
        tons_of_tweakability: `Muitos Ajustes`,
        tons_of_tweakability_description: `Onde ficam os ajustes de comportamento e pessoais`,
        memory: `Memória`,
        memory_description: `O que eu lembro e por quanto tempo`,
        scheduled_tasks: `Tarefas Agendadas`,
        scheduled_tasks_description: `Lembretes e tarefas que eu retomo por conta própria`,
        server_moderation: `Moderação do Servidor`,
        server_moderation_description: `Quem pode me usar aqui, e onde`,
        quotas: `Cotas`,
        quotas_description: `Limite quanta geração este servidor permite`,
        age_restricted_commands: `Comandos Restritos por Idade`,
        age_restricted_commands_description: `Recursos adultos e o que eu não filtro`,
        user_byok: `BYOK do Usuário (Avançado)`,
        user_byok_description: `Faça cada membro trazer sua própria chave`,
        sillytavern_presets: `Predefinições do SillyTavern`,
        sillytavern_presets_description: `Construa meus prompts de uma predefinição importada`,
        mcp_servers: `Servidores MCP`,
        mcp_servers_description: `Conecte ferramentas externas que eu possa usar`,
        matrix: `Matrix`,
        matrix_description: `Conecte uma sala do Matrix a um canal do Discord`,
      },
      subsections: {
        get_api_key: `Obter uma Chave de API`,
        get_api_key_description: `Onde conseguir uma e como mantê-la segura`,
        change_trigger_behavior: `Mudar Comportamento de Gatilho`,
        change_trigger_behavior_description: `Quando e onde tenho permissão para responder`,
        create_first_persona: `Crie sua Primeira Persona`,
        create_first_persona_description: `Edite-me, gere uma nova ou importe uma`,
        explore_features: `Explore meus Recursos!`,
        explore_features_description: `Um breve tour pelo que eu posso fazer agora`,
        nickname_pronouns: `Seu Apelido e Pronomes`,
        nickname_pronouns_description: `Como eu me dirijo a você, em todos os servidores`,
        personal_memories: `Memórias Pessoais`,
        personal_memories_description: `O que eu lembro sobre você especificamente`,
        personal_providers: `Provedores Pessoais (Avançado)`,
        personal_providers_description: `Responda com sua própria chave e modelo`,
        text_models: `Modelos de Texto`,
        text_models_description: `Registre um endpoint de chat e seu modelo`,
        comfyui: `ComfyUI (para vídeo e imagem)`,
        comfyui_description: `Faça upload de um workflow e gere a partir dele`,
        text_to_speech: `Conversão de Texto em Voz (para voz)`,
        text_to_speech_description: `Dê a cada persona uma voz real`,
        image_generation: `Geração de Imagem`,
        image_generation_description: `Desenhe seu prompt ou a cena atual`,
        video_generation: `Geração de Vídeo`,
        video_generation_description: `Clipes curtos, com um quadro inicial opcional`,
        speech_generation: `Geração de Voz`,
        speech_generation_description: `Transforme texto em uma mensagem de voz`,
        art_search: `Busca de Arte`,
        art_search_description: `Envie arte de anime existente do Danbooru`,
        behavior_tuning: `Ajuste de Comportamento`,
        behavior_tuning_description: `Modelo, humanizador, instruções e ferramentas`,
        server_wide_settings: `Configurações do Servidor`,
        server_wide_settings_description: `Limites que se aplicam a todos aqui`,
        personal_settings: `Configurações Pessoais`,
        personal_settings_description: `Suas preferências, em todos os servidores`,
        long_term_memory: `Memória de Longo Prazo`,
        long_term_memory_description: `Fatos que guardo permanentemente`,
        short_term_memory: `Memória de Curto Prazo`,
        short_term_memory_description: `Minha nota de trabalho desta conversa`,
        rewards_punishments: `Recompensas e Punições`,
        rewards_punishments_description: `Gestos que percebo e lembro`,
        memory_tagging: `Marcação de Memória (Avançado)`,
        memory_tagging_description: `Desperte uma memória apenas quando for relevante`,
        blacklisting: `Lista Negra`,
        blacklisting_description: "Faça-me ignorar um membro completamente",
      },
    },
    breadcrumbs: {
      persona: {
        general: `Persona > Identidade e Personalidade`,
        advanced: `Persona > Avançado`,
        voice: `Persona > Voz`,
        sprites: `Persona > Sprites`,
        triggers: `Persona > Gatilhos`,
      },
      behavior: {
        general: `Comportamento > Comportamento Geral`,
        trigger: `Comportamento > Comportamento de Gatilho`,
        memory: `Comportamento > Memória Avançada`,
      },
      channels: {
        destinations: `Canais > Registros e Boas-vindas`,
        "auto-trigger": `Canais > Gatilho Automático`,
        overrides: `Canais > Exceções de Canal`,
      },
      plugins: {
        "available-tools": `Plugins > Ferramentas Disponíveis`,
        "mcp-servers": `Plugins > Servidores MCP`,
        "sillytavern-presets": `Plugins > Predefinições do SillyTavern`,
      },
      models: {
        switch: `Modelos > Trocar Modelos`,
        voices: `Modelos > Parâmetros de TTS e Vozes`,
        image: `Modelos > Padrões de Geração de Imagem`,
        parameters: `Modelos > Samplers de Texto e Parâmetros`,
      },
      personal: {
        profile: {
          general: `Perfil > Preferências Gerais`,
        },
        privacy: {
          controls: `Privacidade > Controles de Privacidade`,
        },
        models: {
          switch: `Modelos > Trocar Modelos`,
        },
        advanced: {
          spotlight: `Avançado > Foco Pessoal`,
        },
      },
      moderation: {
        "member-access": `Acesso de Membros`,
        "user-blacklist": `Lista Negra de Usuários`,
        whitelist: `Lista Branca`,
        quotas: `Cotas`,
      },
    },
    features: {
      title: `Recursos da TomoriBot (Versão {version})`,
    },
    matrix: {
      bot_user_fallback: `a conta configurada do bot Matrix`,
    },
    "api-key": {
      provider_choice_brave: `Brave Search`,
      provider_choice_google: `Google Gemini (Recomendado, Grátis)`,
      provider_choice_deepseek: `DeepSeek`,
      provider_choice_custom: `Endpoint Personalizado`,
      provider_choice_nvidia: `NVIDIA NIM (Grátis)`,
      provider_choice_novelai: `NovelAI`,
      provider_choice_openrouter: `OpenRouter (Recomendado)`,
      provider_description_google: `Uso geral e possui nível gratuito generoso`,
      provider_description_openrouter: `Pago, mas confiável e flexível; pode gerar imagens, vídeos e voz`,
      provider_description_deepseek: `Alternativa paga mais barata e bem sem censura`,
      provider_description_novelai: `Para dramatização (roleplay), histórias e imagens sem censura`,
      provider_description_nvidia: `Modelos hospedados de texto, embeddings e imagens`,
      provider_description_zai: `Modelos GLM (texto e imagem) com limites para uso em código`,
      provider_description_vertexexpress: `Gemini no Google Cloud com autenticação por chave de API`,
      provider_description_vertex: `Gemini Empresarial via credenciais do Google Cloud`,
      provider_description_custom: `Endpoint próprio ou proxy; autenticação pode ser opcional`,
      provider_description_brave: `Pesquisa web, de imagens, vídeos e notícias (opcional)`,
      provider_description_elevenlabs: `API de fala e transcrição, não é um modelo de texto`,
      provider_choice_zai: `Z.ai`,
      provider_choice_vertex: `Google Vertex AI`,
      provider_choice_vertexexpress: `Google Vertex AI Express`,
      provider_choice_elevenlabs: `ElevenLabs TTS`,
      brave_title: `Configurando a Chave de API do Brave Search`,
      brave_description: `O Brave Search é opcional e apenas aprimora minhas capacidades de pesquisa. Ele NÃO alimenta minha IA, pois isso é feito pelo seu provedor principal.
- Habilita pesquisa de imagem, vídeo e notícias
- Fornece informações em tempo real da internet
- Aprimora minha capacidade de responder a perguntas atuais`,
      brave_getting_key_title: `Obtendo sua Chave de API:`,
      brave_getting_key_description: `1. Acesse [Brave Search API](https://brave.com/search/api/)
2. Cadastre-se para uma conta gratuita
3. Navegue até a seção [API Keys](https://api-dashboard.search.brave.com/app/keys) no Painel
4. Crie uma nova chave de API
5. Copie e insira sua chave usando o comando {configBraveapiSet}`,
      brave_important_title: `Notas Importantes:`,
      brave_important_description: `- Isso é separado do seu provedor principal de IA
- Sem a chave da API do Brave, eu ainda posso funcionar e usar a pesquisa web embutida
- O Brave inclui US$ 5 em créditos mensais gratuitos, mas o uso acima disso pode ser cobrado. Se você quiser apenas o plano gratuito, defina um limite de uso de US$ 5 no [painel de limites de uso do Brave](https://api-dashboard.search.brave.com/app/subscriptions/usage-limits)`,
      brave_footer: `Para o seu provedor principal de IA, escolha outro provedor na página de Chaves de API em \`/help\``,
      google_title: `Configurando a Chave de API do Google Gemini`,
      google_description: `O Google Gemini oferece níveis gratuitos e pagos com modelos de IA poderosos.
- Nível gratuito disponível
- [Política de Privacidade do Gemini](https://ai.google.dev/gemini-api/terms)`,
      google_getting_key_title: `Obtendo sua Chave de API:`,
      google_getting_key_description: `1. Acesse o [Google AI Studio](https://aistudio.google.com/apikey)
2. Clique em \`Create API Key\` no canto superior direito (crie um novo Projeto se necessário)
3. Copie esta chave de API em {configSetup} ou {configApikeySet}`,
      google_footer: `Após configurar este provedor, você pode alterar seu modelo padrão com {configModel}`,
      deepseek_title: `Configurando a Chave de API do DeepSeek`,
      deepseek_description: `O DeepSeek é um provedor de texto pré-pago.
- [Docs da API do DeepSeek](https://api-docs.deepseek.com/)`,
      deepseek_getting_key_title: `Obtendo sua Chave de API:`,
      deepseek_getting_key_description: `1. Acesse [DeepSeek API Keys](https://platform.deepseek.com/api_keys)
2. Faça login ou crie uma conta na plataforma DeepSeek
3. Crie uma nova chave de API
4. Se necessário, adicione créditos na sua conta antes do uso
5. Copie esta chave de API em {configSetup} ou {configApikeySet}`,
      deepseek_footer: `Após configurar este provedor, você pode alterar seu modelo padrão com {configModel}`,
      custom_title: `Configuração de Endpoint Personalizado`,
      custom_description: `O fluxo antigo de Provedor Personalizado mudou.

Para endpoints do servidor, use {configSetup} e escolha **Endpoint Personalizado (conclua após config.)**, então execute {configCustomModelsAdd} e selecione-o com {configModel}.

Para endpoints pessoais, use {personalCustomModelsAdd}.

Use {helpCustomModels} para o guia completo de comandos, tipos de endpoints e capacidades.`,
      nvidia_title: `Configurando a Chave de API do NVIDIA NIM`,
      nvidia_description: `O NVIDIA NIM fornece APIs hospedadas de texto, embedding e imagem através do NVIDIA Build.`,
      nvidia_getting_key_title: `Obtendo sua Chave de API:`,
      nvidia_getting_key_description: `1. Acesse [NVIDIA Build](https://build.nvidia.com/)
2. Faça login ou crie uma conta de desenvolvedor NVIDIA
3. Crie ou gerencie suas chaves de API na [página de Chaves de API](https://build.nvidia.com/settings/api-keys)
4. Copie esta chave de API em {configSetup} ou {configApikeySet}`,
      nvidia_important_title: `Notas Importantes:`,
      nvidia_important_description: `- Texto e embeddings usam o endereço hospedado \`integrate.api.nvidia.com\` da NVIDIA
- Geração nativa de imagens usa o endpoint FLUX hospedado \`ai.api.nvidia.com\` da NVIDIA`,
      nvidia_footer: `Após configurar este provedor, você pode alterar os modelos de texto, embedding e imagem com {configModel}, {configModelEmbedding} e {configModelImage}`,
      zai_title: `Configurando a Chave de API do Z.ai`,
      zai_description: `A Z.ai fornece acesso à família GLM através de uma API geral e um endpoint separado para código.

⚠️ **Atualização dos Termos de Serviço:** Os Termos da Z.ai foram atualizados para permitir apenas casos de uso de código/agente. Usar o endpoint geral para chat sem ser código é por sua conta e risco.`,
      zai_getting_key_title: `Obtendo sua Chave de API:`,
      zai_getting_key_description: `1. Acesse a [Plataforma Z.ai](https://z.ai)
2. Faça login ou crie uma conta
3. Navegue até API Keys em seu painel
4. Crie uma nova chave de API
5. Copie esta chave de API em {configSetup} ou {configApikeySet}`,
      zai_important_title: `Notas Importantes:`,
      zai_important_description: `- Use o endpoint geral para chat normal, raciocínio e geração nativa de imagens
  - O endpoint de Código dedicado é separado e planejado para fluxos focados em programação
  - ⚠️ Os Termos restringem o uso para cenários de código/agentes; uso para chat/roleplay geral é por sua conta e risco`,
      zai_footer: `Após configurar este provedor, você pode alterar seu modelo padrão com {configModel}`,
      novelai_title: `Configurando a Chave de API do NovelAI`,
      novelai_description: `O NovelAI é um serviço de assinatura focado em narrativas criativas e roleplay.
- Mensagens ilimitadas sem censura
- Suporta geração de texto sem censura e imagens NovelAI, que é configurada separadamente
- Os modelos de texto do NovelAI não suportam entrada de visão
- [Termos de Serviço do NovelAI](https://novelai.net/terms)`,
      novelai_getting_key_title: `Obtendo sua Chave de API:`,
      novelai_getting_key_description: `1. Acesse [NovelAI](https://novelai.net/stories)
2. Navegue até as configurações através do ícone ⚙️ no canto superior esquerdo
3. Vá para \`Account\`
4. Procure por \`Get Persistent API Token\` (requer assinatura!)
5. Copie esta chave de API em {configSetup} ou {configApikeySet}`,
      novelai_footer: `Após configurar este provedor, você pode alterar seu modelo padrão com {configModel}`,
      openrouter_title: `Configurando a Chave de API do OpenRouter`,
      openrouter_description: `O OpenRouter fornece acesso a vários modelos de IA de diferentes provedores com modelo pré-pago.
 - Acesso aos modelos de IA mais recentes e poderosos (alguns são gratuitos)
 - [Termos de Serviço do OpenRouter](https://openrouter.ai/terms)`,
      openrouter_getting_key_title: `Obtendo sua Chave de API:`,
      openrouter_getting_key_description: `1. Acesse [OpenRouter](https://openrouter.ai/settings/keys)
2. Clique em \`Create API Key\`
3. Copie esta chave de API em {configSetup} ou {configApikeySet}`,
      openrouter_important_title: `Notas Importantes:`,
      openrouter_important_description: `- **Modelos gratuitos têm limites rígidos**; modelos pagos são geralmente mais confiáveis
- **Sempre verifique os preços** antes de selecionar um modelo
- As configurações da sua conta OpenRouter continuam valendo aqui
- Se você precisar de um modelo que não está listado, sugira em {supportServer}`,
      openrouter_footer: `Após configurar este provedor, você pode alterar seu modelo padrão com {configModel}`,
      vertex_title: `Configurando o Google Vertex AI`,
      vertex_description: `O Google Vertex AI fornece acesso empresarial aos modelos Gemini por meio do Google Cloud.
- Usa o Application Default Credentials (ADC) para autenticação; sem chave de API para gerenciar
- Usa ADC local gcloud ou identidade/conta de serviço hospedada
- [Documentação do Vertex AI](https://cloud.google.com/vertex-ai/docs)`,
      vertex_getting_key_title: `Configuração:`,
      vertex_getting_key_description: `**Passo 1: Instale o [Google Cloud CLI](https://cloud.google.com/cli)**

**Passo 2: Crie um projeto no Google Cloud**
Execute: \`gcloud projects create PROJECT_ID --name="Vertex AI Project"\`
(substitua \`PROJECT_ID\` por um ID único, ex. \`meu-projeto-vertex-123\`)

**Passo 3: Defina-o como seu projeto ativo**
Execute: \`gcloud config set project PROJECT_ID\`

**Passo 4: Vincule uma conta de faturamento**
Execute: \`gcloud billing accounts list\` para achar o ID da sua conta,
então: \`gcloud billing projects link PROJECT_ID --billing-account=ACCOUNT_ID\`

**Passo 5: Habilite a API do Vertex AI**
Execute: \`gcloud services enable aiplatform.googleapis.com\`

**Passo 6: Configure o Application Default Credentials**
Execute: \`gcloud auth application-default login\` e faça login no navegador.

**Passo 7: Insira sua configuração**
Digite \`{project_id}::{location}\` usando {configSetup} ou {configApikeySet}
- Use \`global\` como localização (recomendado para modelos preview e melhor disponibilidade)
- Exemplo: \`meu-projeto-vertex-123::global\``,
      vertex_important_title: `Notas Importantes:`,
      vertex_important_description: `- O valor salvo é a **configuração** (projeto + local), não um segredo/credencial
- Todas as solicitações Vertex usam a identidade Application Default Credentials do host
- Apenas uma chave do AI Studio não autentica este provedor. O projeto deve ter faturamento e a API habilitada, e a identidade do host precisa de acesso ao Vertex.
- Suporta chat, uso de ferramentas, streaming, saída estruturada, compactação, embeddings e predefinições`,
      vertex_footer: `Após configurar este provedor, você pode alterar seu modelo padrão com {configModel}`,
      vertexexpress_title: `Configurando o Google Vertex AI Express`,
      vertexexpress_description: `O Google Vertex AI Express fornece acesso por chave de API ao Gemini no Vertex AI.
- Usa sua própria chave de API do Google Cloud em vez das Credenciais Padrão (ADC) do host
- Ideal para configurações de implantação BYOK onde cada usuário armazena sua própria chave
- Recurso Preview com um catálogo menor exclusivo do Gemini
- [Visão Geral do Vertex AI Express Mode](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/overview)`,
      vertexexpress_getting_key_title: `Passos de Configuração:`,
      vertexexpress_getting_key_description: `1. Abra o [Vertex AI Express Mode](https://console.cloud.google.com/expressmode)
2. Se o Google te redirecionar para o Google Cloud padrão, use o provedor \`vertex\` separado em vez disso. Isso ocorre porque o Modo Express só funciona com contas do Google que ainda não criaram uma conta GCP com faturamento.
3. No console Express, abra **APIs & Services > Credentials** e copie a chave da API Express
4. Adicione essa chave bruta com {configSetup} ou {configApikeySet}
5. Escolha um modelo Vertex AI Express com {configModel}`,
      vertexexpress_important_title: `Notas Importantes:`,
      vertexexpress_important_description: `- Armazene a chave de API bruta, não \`{project_id}::{location}\`
- Nenhuma configuração de local é necessária aqui; \`global\` é apenas para o provedor \`vertex\` separado
- Projetos completos do Google Cloud Vertex devem usar \`vertex\`, não \`vertexexpress\`
- A disponibilidade de modelos é limitada ao catálogo do Vertex AI Express Gemini
- A geração de imagem está disponível, mas vídeo e embeddings não
- O Express Mode atualmente é um recurso Preview do Google`,
      vertexexpress_footer: `Após configurar este provedor, você pode alterar seu modelo padrão com {configModel}`,
    },
    elevenlabs: {
      description: `Aprenda a configurar conversão de texto em voz do ElevenLabs`,
      title: `Configurando ElevenLabs TTS`,
      getting_key_title: `Obtendo sua Chave de API:`,
      getting_key_description: `1. Acesse [ElevenLabs](https://elevenlabs.io/app/settings/api-keys)
2. Inscreva-se ou faça login na sua conta
3. Crie uma nova chave de API
4. Copie esta chave de API usando {configSpeechElevenlabs}`,
      choosing_voice_title: `Escolhendo uma Voz:`,
      choosing_voice_description: `Após configurar sua chave de API, use {configSpeechVoiceAssign} para navegar pelas vozes disponíveis.
- Adicione mais vozes da [Voice Library](https://elevenlabs.io/app/voice-library), onde você também pode clonar suas próprias vozes.`,
      free_voices_title: `Vozes Prontas (Plano Gratuito):`,
      free_voices_description: `Apenas vozes prontas (premade) funcionam no plano gratuito. Navegue pela lista completa em [ElevenLabs Premade Voices](https://elevenlabs-sdk.mintlify.app/voices/premade-voices), depois use {configSpeechElevenlabs} ou {configSpeechVoiceAssign} para atribuir uma a cada persona.`,
      important_notes_title: `Notas Importantes:`,
      important_notes_description: `- Caracteres são contados quando gero e leio mensagens de voz
- O nível gratuito tem limites mensais; verifique seu uso no painel do ElevenLabs
- A postagem visível de transcrições é controlada separadamente por {configSpeechTranscripts}`,
      footer: `Execute {configSpeechElevenlabs} novamente para atualizar a chave do ElevenLabs.`,
    },
    getting_started: {
      title: `Primeiros Passos`,
      description: `Guia sobre como começar a me usar e sobre meus recursos`,
      get_api_key: {
        title: `Obter uma Chave de API`,
        description:
          "Uma chave de API me concede acesso ao modelo de um provedor de IA. Tudo que eu gerar será cobrado nessa chave, então trate como qualquer outra senha. Para terminar a configuração eu preciso de uma:\n> **1.** Escolha um provedor abaixo para abrir seu guia.\n> **2.** Copie a chave que ele fornece. **NÃO compartilhe-a** com ninguém, e nunca a cole em um canal: apenas na caixa que {setup} abre para você.\n> **3.** Execute {setup} e cole a chave quando eu pedir.",
        picker_footer:
          "-# Se o seu endpoint não estiver listado, pule a chave e leia **Endpoints Personalizados (Avançado)** nesta mesma página.",
      },
      change_trigger_behavior: {
        title: `Mudar Comportamento de Gatilho`,
        description:
          "Por padrão, eu respondo quando você diz meu nome, me menciona ou me responde. Você pode ampliar, restringir ou desativar isso por canal.\n\n**Onde tenho permissão para falar**\nVocê pode me fazer responder apenas em canais na lista branca. Adicione-os em {moderationWhitelist}.\n> Um canal que não está na lista permanece em silêncio.\n\n**Falando por conta própria**\n{configAutoTrigger} permite que eu envie uma mensagem automaticamente a cada poucas mensagens ou de forma aleatória.\n\n**Acione-me apenas com menções**\nO Modo de Gatilho Deliberado impede que eu responda a um simples chamado do meu nome. Faz com que eu espere por @menções. Ative-o em {configBehaviorTrigger}.",
      },
      create_first_persona: {
        title: `Crie sua Primeira Persona`,
        description:
          "Uma *Persona* sou eu com nome, avatar e personalidade diferentes, mas com os mesmos recursos! Edite a que você já tem, ou crie novas.\n\n**Altere a que você possui**\n{configPersonaGeneral} define meu nome, personalidade e como eu me dirijo às pessoas. {configPersonaAppearance} define meu avatar.\n\n**Escreva uma nova a partir de uma frase**\n{personaGenerate} constrói uma persona inteira a partir de uma breve descrição. {personaCreate} fornece o modelo em branco.\n\n**Traga uma de outro lugar**\n{personaImport} aceita cartões de personagens baixados de sites de cartões como botbooru ou chub.",
        footer: "Você pode manter várias personas ao mesmo tempo. Veja **Múltiplas personas** em Recursos.",
      },
      explore_features: {
        title: `Explore meus Recursos!`,
        description:
          "A configuração terminou. Aqui está o que posso fazer agora que posso falar.\n- **Use os emojis e figurinhas deste servidor** assim que executar {expressionsInitialize}.\n- **Receba novos membros** através de {configWelcome}.\n- **Lembrar e lembrar você**: basta pedir para eu te lembrar, ou me conte algo que vale a pena guardar.\n- **Pesquise na web** e use outras ferramentas, ativadas em {configTools}.\n- **Faça imagens, vídeos e voz** com {generateImage}, {generateVideo}, e {generateVoice}.\n\nA maioria dos meus interruptores fica em {config}, mas não todos.",
        footer:
          "**Brave Search** adiciona resultados da web à pesquisa que eu já faço. Ele precisa da sua própria chave, e **Obter uma Chave de API** em Configuração abre seu guia da lista de serviços opcionais. O site de documentação é a versão completa deste painel e explica cada configuração em detalhes.",
      },
    },
    personal_profile: {
      title: `Perfil Pessoal`,
      description: "Configurações que pertencem a você e acompanham você em todos os servidores onde estou.",
      nickname_pronouns: {
        title: `Seu Apelido e Pronomes`,
        description:
          "Diga-me como devo chamar você, o que usarei em todos os lugares.\n\nConfigure isso em {personalProfile}.\n> Apelido: como o chamo em vez do seu nome do Discord\n> Prefixo e sufixo: um título ou honorífico, como `-san`\n> Pronomes: `ela/dela`, `ele/dele`, `qualquer`, ou seu nome\n\nDeixe um campo em branco e volto ao seu nome do Discord e aos próprios hábitos de nomenclatura da persona.",
        footer:
          "Uma única persona pode se dirigir a você de maneira diferente. Configure isso em Perfil > Preferências Específicas da Persona.",
      },
      personal_memories: {
        title: `Memórias Pessoais`,
        description:
          "Coisas que eu lembro sobre você especificamente, em todos os servidores.\n\n**Apenas me conte**\nDiga isso no chat e eu mesmo salvarei. Uma mensagem de confirmação aparecerá quando isso acontecer.\n\n**Ou gerencie-as manualmente**\n{personalMemories} lista tudo que guardo sobre você e permite editar ou excluir qualquer entrada individual.\n\n**Decida quanto posso usar**\n{personalPrivacy} define seu nível de privacidade, de total personalização até nenhuma personalização.",
        footer:
          "Estas são separadas das memórias compartilhadas deste servidor, que qualquer um aqui pode ver e editar.",
      },
      personal_providers: {
        title: `Provedores Pessoais (Avançado)`,
        description:
          "Responda com sua própria chave de API e seu próprio modelo em vez do que o servidor usa, em todo lugar que você falar comigo.\n\n**Salvar um provedor**\n{personalProviders} armazena sua chave e liga o seu modelo de texto pessoal imediatamente.\n\n**Escolha um modelo diferente**\n{personalModels} troca os modelos, e samplers e fallbacks ficam ao lado disso na mesma categoria.\n> Sua configuração pessoal afeta apenas as respostas que você aciona.\n> Ninguém mais no servidor é alterado.\n\nAlguns servidores exigem isso. Se um servidor tiver o BYOK do Usuário ligado, não poderei te responder até você salvar um provedor aqui.",
      },
    },
    custom_endpoints: {
      title: `Endpoints Personalizados (Avançado)`,
      description:
        "Aponte-me para um endpoint que você administra ou confia: Ollama, LM Studio, LiteLLM, KoboldCPP, ComfyUI, ou um servidor de fala auto-hospedado.\n> {providers} registra um para todo o servidor.\n> {personalProviders} registra um apenas para você.",
      text_models: {
        title: `Modelos de Texto`,
        description:
          "Escolha **Adicionar Novo Endpoint Personalizado**, então dê a ele um rótulo, uma URL base e o estilo da API. Adicione um token de auth se necessário.\n\nSelecione o rótulo salvo, escolha **+ Adicionar novo Modelo de Texto**, e insira o código exato do modelo que o endpoint espera. Adicionar o modelo o ativa.\n> Declare suporte a visão, ferramentas e saída estruturada com honestidade.\n> Eu confio nessas marcações quando decido o que enviar a você.\n\nMude para ele mais tarde a partir de {configSwitchModels}.",
        footer: "A referência completa de compatibilidade e estilos de API está no site da documentação.",
      },
      comfyui: {
        title: `ComfyUI (para vídeo e imagem)`,
        description:
          "Construa e teste o workflow no ComfyUI primeiro, depois exporte-o com **Save (API Format)**.\n\nColoque o placeholder de prompt onde o prompt pertence, e os outros placeholders onde quiser que tamanho, duração, ou o código do modelo sejam injetados.\n\nRegistre o endpoint com Compatibilidade de API `ComfyUI` (por exemplo, `http://127.0.0.1:8188`), então adicione um modelo de imagem ou vídeo a ele e faça o upload do JSON exportado.\n> O grafo precisa terminar em um nó de salvamento real. Nós de pré-visualização me deixam sem nenhum arquivo para baixar.",
        footer:
          "Workflows prontos vêm no repositório do GitHub, e a lista completa de placeholders está no site da documentação.",
      },
      text_to_speech: {
        title: `Conversão de Texto em Voz (para voz)`,
        description:
          "Registre um endpoint de fala da mesma maneira, depois dê uma voz a cada persona.\n\nServiços hospedados e servidores com hospedagem própria funcionam, entre eles Chatterbox-Turbo, Qwen3-TTS, IrodoriTTS e ElevenLabs. Registre o endpoint, então adicione um modelo de fala a ele.\n> Atribua a voz em {configPersonaVoice}.\n> Ajuste a velocidade e padrões em {configVoices}.",
        footer:
          "As mensagens de voz que você me enviar são transcritas pelo mesmo endpoint, configurado da mesma forma. Para vozes hospedadas, o ElevenLabs tem seu próprio guia em **Obter uma Chave de API** na Configuração, listado junto aos serviços opcionais.",
      },
    },
    multiple_personas: {
      title: `Múltiplas personas`,
      description:
        "Você pode ter múltiplas personas em um servidor, cada uma com seu próprio nome, memórias e objetivos!",
      mains_alters_title: `Personas principais e alters`,
      mains_alters_body:
        "A persona principal é a persona que me representa no servidor. Um alter é uma segunda identidade com a qual posso falar, com seu próprio nome e avatar na própria mensagem.",
      bringing_in_title: `Trazendo uma persona`,
      bringing_in_body:
        "{personaImport} recebe um cartão de personagem como um arquivo:\n> Cartão `.png`, do TomoriBot ou SillyTavern\n> Cartão `.json`, do TomoriBot ou SillyTavern\n> Arquivo `.charx`, Character Card V3\n\nApenas o texto do personagem é lido. Atualmente, os sprites, áudio e vídeo empacotados são ignorados, então defina isso você mesmo em {configPersonaAppearance} e {configPersonaSprites}.",
      where_to_find_title: `Onde encontrar cartões`,
      where_to_find_body:
        "Faça o seu próprio com {personaGenerate} ou {personaCreate}, ou procure um que já exista.\n\nSites de cartões como botbooru e chub hospedam milhares deles. Eles são sites de terceiros, e um cartão feito para outro bot pode não ser convertido perfeitamente.",
      talking_title: `Deixando-as conversarem entre si`,
      talking_body:
        "Dê a cada persona suas próprias palavras-gatilho e canais em {configPersonaTriggers}, e elas responderão lado a lado na mesma conversa.",
      footer: `Compartilhe uma das suas com {personaExport}.`,
    },
    media_generation: {
      title: `Geração de mídia`,
      description:
        "Eu posso fazer imagens, vídeo e voz, seja a partir de um comando ou porque você me pediu em uma conversa.\n> Cada um conta contra a cota do servidor. Veja **Cotas** em Moderação.",
      image_generation: {
        title: `Geração de Imagem`,
        description:
          "{generateImage} abre uma caixa de prompt. Escreva seu próprio prompt, ou escolha **Desenhe o que está acontecendo agora** e eu ilustrarei a cena por conta própria.\n> Anexe até três imagens de referência para guiar o resultado.\n> Escolha a proporção de tela na mesma caixa.\n\nQualquer provedor ou endpoint salvo aqui que liste suporte a imagens pode desenhar, e {providers} mostra quais dos seus podem. Um que não possa usar imagens de referência dirá isso e desenhará pelo texto.",
        footer: `Os padrões ficam em {configImageDefaults}.`,
      },
      video_generation: {
        title: `Geração de Vídeo`,
        description:
          "{generateVideo} recebe um prompt e, opcionalmente, um quadro inicial de uma imagem que já está no canal.\n\nQualquer provedor ou endpoint que liste suporte a vídeos pode fazer um, incluindo workflows de vídeo do ComfyUI. {providers} mostra quais dos seus suportam isso.\n> O vídeo é lento e custoso em todo lugar. Espere demorar um pouco.",
      },
      speech_generation: {
        title: `Geração de Voz`,
        description:
          "{generateVoice} transforma texto em uma mensagem de voz com a voz da persona atual.\n\nUm endpoint de fala precisa ser registrado primeiro, hospedado ou com hospedagem própria: veja **Endpoints Personalizados (Avançado)** em Configuração.\n> Cada persona pode soar diferente. A voz vem de {configPersonaVoice}.",
      },
      art_search: {
        title: `Busca de Arte`,
        description:
          "{booruSearch} envia 4 imagens aleatórias bem avaliadas do Danbooru para uma ou duas tags. Sugestões aparecem enquanto você digita, e um apelido ou erro de digitação é convertido na tag real.\n> Resultados questionáveis e explícitos só aparecem em canais com restrição de idade.\n\nVocê também pode apenas me pedir para mostrar alguma arte; a opção **Busca no Danbooru** em {configTools} controla isso. Para limitar quem pode usar o comando, acesse Configurações do Servidor > Integrações.",
      },
    },
    tons_of_tweakability: {
      title: `Muitos Ajustes`,
      description: `Ajuste-me de acordo com as suas preferências e as do servidor`,
      behavior_tuning: {
        title: `Ajuste de Comportamento`,
        description:
          "Como escrevo, como penso, e o que eu posso fazer.\n> **Modelo**: {configSwitchModels} escolhe o modelo que está de fato respondendo, bem como seus parâmetros\n> **Humanizador**: {configBehaviorGeneral} controla o quão humana é a minha entrega, do formal ao muito casual.\n> **Instruções do sistema**: também em {configBehaviorGeneral}, para ordens que se aplicam a todas as respostas.\n> **Ferramentas**: {configTools} decide quais capacidades eu posso buscar, como pesquisa na web ou geração de imagem.",
        footer:
          "Controles no nível do sampler (temperatura e afins) ficam em {configParameters} para ajustar aleatoriedade, etc.",
      },
      server_wide_settings: {
        title: `Configurações do Servidor`,
        description:
          "Limites que se aplicam a todos neste servidor. Apenas para gerentes.\n> **Onde eu falo**: canais na lista branca, limites de canal por persona e tempos de recarga, tudo em {moderation}.\n> **Quando falo por mim mesma**: {configAutoTrigger}.\n> **Quem pode me acionar**: cargos na lista branca, também em {moderation}.\n> **Para onde vão minhas notas**: {configWelcome} define os canais de registro e de boas-vindas.",
        footer:
          "As exceções em nível de canal podem dar a um canal regras ou modelos próprios. Veja {configChannelOverrides}.",
      },
      personal_settings: {
        title: `Configurações Pessoais`,
        description:
          "Suas preferências, que secretamente substituem as do servidor para as respostas que você aciona.\n> **Quem eu acho que você é**: apelido, pronomes e privacidade, em {personalProfile}.\n> **O que te responde**: seu provedor e modelo, em {personalProviders}.\n> **Como te trato**: modos de resposta e Foco Pessoal, em {personalConfig}.\n\nTudo isso viaja com você entre os servidores.",
        footer:
          "O Foco Pessoal permite que uma persona te trate como o seu foco principal, e é configurado em {personalSpotlight}.",
      },
    },
    memory_catalog: {
      title: `Memória`,
      description:
        "Eu mantenho dois tipos de memória: fatos duradouros e uma nota de trabalho da conversa que está acontecendo agora.",
      long_term_memory: {
        title: `Memória de Longo Prazo`,
        description:
          "Fatos que guardo permanentemente, para este servidor ou para você.\n\n**Me ensine**\nDiga-me no chat, ou adicione manualmente em {memories} para o servidor e em {personalMemories} para você mesmo.\n\n**Me faça esquecer**\nOs mesmos dois comandos listam todas as entradas e deletam qualquer uma delas.\n\n**Dê-me documentos**\n{memories} também aceita arquivos. Eu leio as partes relevantes de volta quando importam, em vez de tudo de uma vez usando Geração Aumentada de Recuperação (RAG).\n> Uma memória do servidor alcança todos aqui. Uma memória pessoal só vem à tona quando você faz parte da conversa.",
      },
      short_term_memory: {
        title: `Memória de Curto Prazo`,
        description:
          "Minha nota de trabalho da conversa neste canal agora mesmo, mantida separadamente por canal.\n\nEu resumo o que está acontecendo enquanto seguimos, para que uma longa thread permaneça coerente sem reenviar todas as mensagens.\n> **Cadência de renovação**: com que frequência atualizo essa nota.\n> **Modo de renderização**: se o resumo substitui as mensagens recentes ou fica ao lado delas.\n> **Categorias**: até cinco campos rotulados, como `Objetivos` ou `Inventário`, em vez de uma nota de texto livre.\n\nOs gerentes ajustam tudo isso em {configAdvancedMemory}, e {memories} pode limpar uma nota ativa.",
        footer: "Peça-me para lembrar algo para sempre e isso se tornará uma memória de longo prazo em vez disso.",
      },
      rewards_punishments: {
        title: `Recompensas e Punições`,
        description:
          "Comandos divertidos que de fato percebo e lembro. Seja legal comigo, ou não, e agirei de acordo.\n> {reward} para cafuné, abraço, beijo, cócegas ou alimentar.\n> {punish} para pancada, mordida, beliscão, tapa ou apertar.",
        footer: `Escolha qual persona você quis dizer se houver várias ativas.`,
      },
      memory_tagging: {
        title: `Marcação de Memória (Avançado)`,
        description:
          "Por padrão, toda memória no escopo é enviada com toda mensagem. A marcação restringe isso.\n> **Tags de palavras-chave**: uma memória marcada só desperta quando a palavra-chave aparece na conversa. Uma memória sem tag está sempre ativa.\n> **Canais**: uma memória do servidor pode ser limitada aos canais escolhidos no formulário (suas threads incluídas), e uma memória pessoal a uma tag `#canal`. Ambas combinam com tags de palavras-chave.\n\nAtive ambas em {configAdvancedMemory}, depois use {toolPromptSnapshot} para ver exatamente quais memórias estão ativas no momento.",
        footer: "Documentos enviados e histórico extraído também podem ser limitados a canais.",
      },
    },
    scheduled_tasks: {
      title: `Tarefas Agendadas`,
      description: `Eu posso responder em um temporizador, uma vez ou com repetição.`,
      making_title: `Criando uma`,
      making_body:
        'Apenas peça. "Me lembre de alongar às 14:30" ou "toda manhã, mande a pergunta da reunião diária" já basta, e eu irei configurar isso e confirmar os detalhes.',
      changing_title: `Alterando ou cancelando uma`,
      changing_body:
        "{scheduledTaskEdit} abre qualquer tarefa: seu conteúdo, próxima ativação, repetição e se ela menciona você. {scheduledTaskRemove} deleta uma.",
      who_title: `Quem pode mexer no quê`,
      who_body:
        "Você sempre pode editar a sua. Gerentes de servidor podem editar a de qualquer pessoa, pois a tarefa é enviada em um canal compartilhado.\n> Os horários usam o fuso definido na configuração, então confira duas vezes antes de confiar em um alarme às 6 da manhã.",
    },
    server_moderation: {
      title: `Moderação do Servidor`,
      description:
        "Tudo sobre quem pode me usar aqui, e onde. Isso tudo exige a permissão Gerenciar Servidor e fica em {moderation}.\n> **Acesso de Membros**: quem pode me acionar, e quais modelos eles podem alcançar.\n> **Lista Branca**: os canais, cargos e personas com as quais tenho permissão de responder.\n> **Cotas**: quanta geração este servidor permite.\n> **Lista Negra de Usuários**: membros que devo ignorar.",
      blacklisting: {
        title: `Lista Negra`,
        description:
          "Ignoro completamente um membro na lista negra: ele não pode me acionar em nenhum canal, com nenhuma persona, suas mensagens nunca chegam ao meu contexto e recuso os comandos que me fariam agir por ele, como `/respond`, `/reward` e `/punish`. Ele também não pode alterar memórias do servidor, atributos ou diálogos de exemplo.\n\nAdicione um em {moderationBlacklist}. A mesma página lista todas as entradas atuais e as remove, uma por uma ou em massa.\n> A lista negra é sobre acesso, não sobre remoção. As memórias sobre o membro permanecem até alguém removê-las.",
        footer: "Para silenciar um canal inteiro em vez de uma pessoa, basta remover o canal da lista branca.",
      },
    },
    quotas: {
      title: `Cotas`,
      description:
        "Uma cota limita quanta geração acontece aqui, para não gastarem os créditos de um mês acidentalmente.",
      spent_title: `Como é gasta`,
      spent_body:
        "Existem três fundos separados: texto, imagem e vídeo. Cada um é contado duas vezes, por membro e para o servidor como um todo, e o que acabar primeiro bloqueia o pedido.\n> Um pedido negado avisa você sobre qual fundo acabou e quando ele retornará.",
      limits_title: `Definindo os limites`,
      limits_body:
        "{moderationQuotas} define a cota diária de cada fundo. Deixe ilimitado se preferir não restringir o limite.",
      starting_over_title: `Reiniciando um fundo`,
      starting_over_body:
        "{quotaResetUser} limpa o uso diário de um membro, e {quotaResetGlobal} limpa a cota do servidor. Ambos exigem Gerenciar Servidor.",
      footer:
        "Os fundos zeram sozinhos diariamente. Uma redefinição manual é útil para quando alguém não devesse ter que esperar.",
    },
    age_restricted_commands: {
      title: `Comandos Restritos por Idade`,
      description: `Apenas adultos. Leia esta seção antes de ativar qualquer coisa.`,
      filter_title: `Eu não filtro por padrão`,
      filter_body:
        "Eu venho sem filtro de conteúdo meu, porque a filtragem degrada respostas comuns tanto quanto bloqueia qualquer outra. O que é apropriado aqui é decisão do gerente, não minha.\n> Seu provedor de IA ainda aplica suas próprias regras e pode recusar um pedido não importando o que foi definido aqui.",
      gated_title: `Recursos adultos intencionais bloqueados`,
      gated_body:
        "Qualquer coisa explicitamente adulta fica atrás de {nsfw} e funciona apenas em canais que o próprio Discord marca como restritos.\n\n{nsfwJailbreaks} escolhe quais estratégias de prompt estão ativas no servidor. Elas estão desativadas até que um gerente as ative.\n> Essas estratégias mudam como o meu prompt funciona. Podem fazer eu recusar menos, mas causam comportamento não intencional.",
      footer:
        "Ao habilitá-las, os gerentes do servidor confirmam que o canal é para adultos e assumem a responsabilidade.",
    },
    user_byok: {
      title: `BYOK do Usuário (Avançado)`,
      description:
        "BYOK significa traga sua própria chave: todos os membros pagam por suas respostas com seus próprios provedores.",
      changes_title: `O que ele altera`,
      changes_body:
        "Com o BYOK ativo, uma mensagem de um membro é respondida apenas se ele tiver salvo um provedor pessoal. O provedor do servidor não funciona como fallback para ele.\n> Ative isso em {moderationMemberAccess}, ou escolha isso durante o {setup}.",
      suits_title: `Para quem serve`,
      suits_body:
        "Um servidor grande onde uma chave de API compartilhada se esgotaria rápido. Servidores menores preferem compartilhar um só provedor.",
      members_title: `O que os membros precisam fazer`,
      members_body:
        "Salvar uma chave em {personalProviders}. Indique **Provedores Pessoais (Avançado)** na Configuração para as instruções passo a passo.",
      footer:
        "Apenas em servidores. Mensagens diretas não têm membros trazendo chaves, então a opção não é oferecida nelas.",
    },
    sillytavern_presets: {
      title: `Predefinições do SillyTavern`,
      description:
        "Importe uma predefinição do SillyTavern e construirei meus prompts da maneira que a predefinição diz.",
      importing_title: `Importando uma`,
      importing_body:
        "{configStPresets} aceita o JSON da predefinição, depois permite ativá-la, desativá-la ou removê-la mais tarde.",
      controls_title: `O que ela controla`,
      controls_body:
        "A predefinição assume a ordenação do prompt e os blocos de instruções ao redor da conversa.\n> Uma predefinição habilitada substitui o prompt de sistema em {configBehaviorGeneral} e o prompt da persona em {configPersonaAdvanced}.",
      still_applies_title: `O que ainda se aplica`,
      still_applies_body:
        "Atributos da persona, falas de exemplo, memórias e ferramentas ainda são enviados. A predefinição decide a organização, não o conteúdo.",
      footer: "Desative a predefinição para voltar ao meu próprio modelo de prompt sem perder nada.",
    },
    mcp_servers: {
      title: `Servidores MCP`,
      description:
        "MCP é um jeito padrão de dar uma ferramenta à IA. Conecte um e suas ferramentas se tornam coisas que eu posso de fato usar.",
      hosted_title: `Servidores hospedados`,
      hosted_body:
        "{configMcp} aceita uma URL e um token auth opcional. O que esse servidor fornecer, aparecerá na minha lista de ferramentas.",
      local_title: `Servidores locais`,
      local_body:
        "Um servidor local funcionará do mesmo jeito assim que estiver acessível. O site de documentação tem o guia para isso.",
      before_title: `Antes de conectar um`,
      before_body:
        "> As ferramentas do MCP rodam com o acesso que você der a ele, e eu vou usá-las se parecerem relevantes. Conecte servidores em que confia e leia o que as ferramentas fazem antes.",
      footer: `Desligue ferramentas separadamente quando quiser em {configTools}.`,
    },
    matrix_bridge: {
      title: `Matrix`,
      description:
        "Eu posso estar numa sala Matrix e num canal Discord ao mesmo tempo, carregando a conversa entre os dois.",
      linking_title: `Conectando uma sala`,
      linking_body:
        "{matrixLink} conecta o canal atual a um ID de sala do Matrix, parecido com `!abcdef:matrix.org`. Convide {matrixBotUser} para essa sala primeiro.",
      reads_title: `Como é a leitura`,
      reads_body:
        "Mensagens de ambos os lados chegam a mim como uma única conversa, e eu respondo em ambas as plataformas.\n> Anexos, edições e reações não sobrevivem perfeitamente à viagem. O texto é o que viaja sem falhas.",
      footer: "Nada conectado? Verifique se o convite foi aceito antes de tentar qualquer outra coisa.",
    },
  },
};
