---
title: "Voz: TTS & STT"
sidebar:
  order: 3
aiGenerated: true
---

TomoriBot pode falar e ouvir em Discord: enviar respostas de voz com conversão de texto em fala (TTS) e transcrever mensagens de áudio em contexto de conversa com conversão de fala em texto (STT).

Escolha os provedores de fala em `/providers`, ou use `/personal providers` para seus próprios modelos de fala do Google ou do OpenRouter. Você também pode executar modelos de voz locais no seu próprio hardware.

## Conversão de texto para fala
<!-- anchor: text-to-speech -->

### Vozes do Google e do OpenRouter

Adicionar o Google seleciona o Gemini Flash TTS para `TTS (Design de Voz)`. Adicionar o OpenRouter seleciona o Fish S2.1 Pro pago para `TTS (Clone de Voz)`, e preenche `TTS (Design de Voz)` com o Seed Audio 1.0 apenas quando esse slot estiver vazio. O OpenRouter nunca substitui um design do Gemini ou do Vertex que você já tenha escolhido, permitindo que ambos os provedores permaneçam ativos juntos. Se você adicionou o OpenRouter antes do Seed estar disponível, seu slot de Design permanecerá vazio até que você escolha o Seed. Adicionar a chave do OpenRouter novamente também preenche um slot de Design vazio com o Seed, inclusive um que você tenha limpado de propósito. O Flash-Lite e o Fish gratuito exigem seleção explícita de modelo; a disponibilidade e as cotas do provedor ainda se aplicam. Use `/config` > Modelos > Trocar Modelos para alterar ou limpar qualquer um dos slots.
As seleções pessoais e seus controles de ligar/desligar ficam em `/personal config` > Modelos > Trocar Modelos. Desativar um modo pessoal permite que esse modo use a seleção do servidor enquanto o outro permanece ativo.

Use uma chave de API para o provedor no mesmo escopo da seleção. Uma assinatura de chat por si só não concede acesso à API. O [nível gratuito de API](https://ai.google.dev/gemini-api/docs/pricing) do Gemini possui cotas de projeto e requisitos de elegibilidade; verifique o acesso no AI Studio. O Fish gratuito é um código de modelo separado, `fish-audio/s2.1-pro-free:free`, e deve ser selecionado explicitamente. Uma falha no modelo gratuito pessoal ainda pode recorrer à seleção paga do servidor quando o Fallback com o Modelo do Servidor estiver ativado.

Em `/config` > Persona > Voz, escolha `Descrever Voz` para salvar uma descrição de até 1.000 caracteres. Você pode redigi-la antes de escolher um modelo. Para usar o Fish ou um modelo de clonagem local, adicione uma referência em `/config` > Modelos > Parâmetros TTS e Vozes e atribua-a na página Voz da persona. Ambas as entradas permanecem salvas ao trocar de provedor. Escolha `Design de Voz` ou `Clone de Voz` para definir a prioridade; se a entrada preferida não tiver um modelo correspondente ou uma voz utilizável, a outra entrada salva poderá ser usada. A página explica qual fonte é efetiva para as seleções do servidor.

Execute `/generate voice-message` para inserir um roteiro curto, ou peça à persona para enviar uma mensagem de voz. O comando também aceita uma descrição única ou o upload de uma referência. Descrições salvas reutilizam uma identidade de voz do Gemini; edições a aposentam. Descrições avulsas criam uma identidade temporária que o bot exclui após a geração. Falhas na limpeza são tentadas novamente quando essas credenciais forem reutilizadas; os administradores podem precisar remover vozes no console do provedor após falhas ou tempos limite ambíguos.
As descrições são incluídas em cartões de persona exportados em PNG e JSON; identidades de voz remotas e atribuições de referência são excluídas. O Google armazena a identidade projetada no projeto da API. A clonagem por áudio de referência do Gemini está adiada até que o bot possa coletar gravações de consentimento.

O Seed Audio funciona de forma diferente do Gemini. Ele constrói a voz a partir da descrição toda vez que fala, portanto a mesma descrição pode soar um pouco diferente de uma mensagem para outra. Se você precisa de uma voz que permaneça sempre idêntica, use o Gemini ou uma amostra de referência. O Seed funciona melhor em inglês e chinês e gera no máximo dois minutos de áudio por mensagem, então seus roteiros param em 1.100 caracteres. A descrição, quaisquer instruções de entonação e o roteiro também compartilham um total de 2.048 caracteres, de modo que uma descrição longa deixa menos espaço para o roteiro. Um roteiro que não couber será recusado antes do envio, e o bot solicitará que você o encurte.
O OpenRouter cobra o Seed por segundo de áudio, o que custa cerca de dez vezes mais por minuto do que o Fish. Para mudar para o Gemini ou limpar o slot, use `/config` > Modelos > Trocar Modelos.

Falhas de fala pessoais seguem a configuração de Fallback com o Modelo do Servidor e as permissões do servidor. Um fallback bem-sucedido é informado no recibo do comando. Os provedores podem faturar trabalhos que falharam ou foram cancelados; limites de roteiro e áudio não definem um teto de gastos.

### ElevenLabs (nuvem, mais fácil)

1. Obtenha uma chave API de [ElevenLabs](https://elevenlabs.io/app/settings/api-keys).
2. Execute `/providers`, escolha `Adicionar Novo Provedor`, selecione `ElevenLabs` e cole a chave. Este fluxo:
   - registra o ponto final de fala ElevenLabs e o ponto final de transcrição,
   - ativa ambos os pontos finais,
   - opcionalmente, atribui uma voz a uma persona imediatamente.
3. Atribua vozes a personas adicionais em `/config` > `Persona` > Voz. Procure vozes na [Biblioteca de Vozes ElevenLabs](https://elevenlabs.io/app/voice-library), onde você também pode clonar as suas próprias.

Selecione ElevenLabs em `/providers` e escolha `Editar Endpoint` sempre que precisar atualizar a chave.

Notas:

- No plano gratuito, apenas vozes pré-fabricadas funcionam. Navegue pela [lista de vozes predefinidas](https://elevenlabs-sdk.mintlify.app/voices/premade-voices).
- Os caracteres são contados quando ela gera mensagens de voz. O nível gratuito tem limites mensais, portanto monitore seu painel ElevenLabs.
- As respostas de voz requerem `voice_message_enabled` em `/config` > `Permissões`, e a persona ativa deve ter uma voz atribuída.
- Alterar `/config` > `Persona` > Voz requer a permissão Gerenciar Servidor em um servidor e permanece disponível para o proprietário em DMs.

Em `/help`, escolha `Recursos` e depois `Voz` para o passo a passo interativo em Discord.

### Motores locais de clonagem de voz (hospedagem própria)

Em instâncias auto-hospedadas, você pode executar um servidor local de clone de voz. O fluxo de trabalho: inicie o servidor, registre sua conexão e modelo em `/providers`, selecione-o em `/providers`, carregue uma amostra de referência em `/config` > `Modelos` > TTS Parâmetros e vozes e, em seguida, atribua-a em `/config` > `Persona` > Voz. Qualquer formato de áudio é aceito (convertido automaticamente para WAV mono); Clipes de 10 a 20 segundos sem música de fundo funcionam melhor.

Cada mecanismo tem seu próprio guia de configuração:

- [Chatterbox-Turbo/Nano](/pt-BR/self-hosting/local-endpoints/text-to-speech/chatterbox/): clonagem rápida de voz em inglês com tags de emoção como `[laugh]`.
- [Qwen3-TTS](/pt-BR/self-hosting/local-endpoints/text-to-speech/qwen3tts/): multilíngue (10 idiomas) mais um modo VoiceDesign em linguagem natural.
- [MOSS-TTS](/pt-BR/self-hosting/local-endpoints/text-to-speech/moss/): clonagem multilíngue e design de voz em inglês ou chinês.
- [IrodoriTTS](/pt-BR/self-hosting/local-endpoints/text-to-speech/irodoritts/): mecanismo especializado em japonês que lê emojis como sinais de emoção.

Consulte a [tabela de comparação de conversão de texto em fala](/pt-BR/self-hosting/local-endpoints/text-to-speech/) para obter orientação sobre hardware e a lista completa de mecanismos.

## Fala-para-Texto
<!-- anchor: speech-to-text -->

Os pontos finais de transcrição transformam os anexos de áudio do usuário em texto para contexto de conversa. Se as transcrições são postadas publicamente no bate-papo é controlado em `/config` > `Comportamento` > Aviso de Comportamento.

### ElevenLabs (nuvem)

Adicionar ElevenLabs de `/providers` registra o ponto final da transcrição junto com a fala. Use `/providers` para alternar entre pontos de extremidade de transcrição ativos.

### Motores locais (hospedagem própria)

- [WhisperX](/pt-BR/self-hosting/local-endpoints/speech-to-text/whisperx/): caminho local recomendado; cerca de 100 idiomas, acelerados por GPU, vários tamanhos de modelo.
- [KoboldCPP](/pt-BR/self-hosting/local-endpoints/speech-to-text/koboldcpp/): funciona quando sua compilação expõe um endpoint de transcrição compatível com OpenAI.
- [sussurro.cpp](/pt-BR/self-hosting/local-endpoints/speech-to-text/whispercpp/).

Consulte o hub [Speech-to-Text](/pt-BR/self-hosting/local-endpoints/speech-to-text/) para obter a lista completa de mecanismos. Para o resumo Discord, execute `/help` e escolha `Recursos` e `Transcrição`.
