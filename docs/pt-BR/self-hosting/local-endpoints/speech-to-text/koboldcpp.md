---
title: "Transcrição com KoboldCPP"
sidebar:
  order: 3
---

Use sua instância [KoboldCPP](https://github.com/LostRuins/koboldcpp) existente para transcrever anexos de áudio e mensagens de voz em TomoriBot.

KoboldCPP inclui fala para texto baseada em Whisper. TomoriBot se conecta a KoboldCPP usando seu endpoint de transcrição de áudio compatível com OpenAI (`POST /v1/audio/transcriptions`).

## Configuração

Inicie o KoboldCPP com o Whisper/STT ativado e confirme se a sua build expõe:

- `POST /v1/audio/transcriptions`
- `GET /v1/models` ou `GET /models`

Mantenha o KoboldCPP rodando enquanto o TomoriBot estiver utilizando-o. Se a sua build expuser apenas `/api/extra/transcribe` ou outro formato personalizado, utilize um wrapper até que o TomoriBot tenha um adaptador dedicado.

## Registrar no TomoriBot

Execute `/providers`, escolha `Adicionar Novo Endpoint Personalizado` e use a compatibilidade da API de transcrição:

- API Compatibility: `openai-compatible-transcription`
- `endpoint_url`: a raiz do servidor do seu KoboldCPP

Após salvar a conexão, selecione-a e use o menu suspenso de modelo para adicionar o nome do modelo que o seu servidor reporta como um modelo de transcrição.

Use `/providers` para registro de endpoint e configuração do modelo. Depois, abra `/config` > Models > Switch Models para selecionar e ativar o endpoint registrado.

## Usar transcrições

Após o registro, TomoriBot transcreve anexos de áudio em segundo plano e adiciona o texto ao contexto do bate-papo. Use `/config` > Mecanismo > Avisos somente se você também quiser que as transcrições sejam postadas de forma visível no bate-papo.
