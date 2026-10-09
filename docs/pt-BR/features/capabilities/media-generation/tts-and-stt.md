---
title: "Voz: TTS & STT"
sidebar:
  order: 3
---

TomoriBot pode falar e ouvir em Discord: enviar respostas de voz com conversão de texto em fala (TTS) e transcrever mensagens de áudio em contexto de conversa com conversão de fala em texto (STT).

Ambos usam o sistema de endpoint do provedor. ElevenLabs é a opção de nuvem mais rápida. Você também pode executar modelos de voz locais em seu próprio hardware usando mecanismos auto-hospedados.

## Texto-para-Fala
<!-- anchor: text-to-speech -->

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
