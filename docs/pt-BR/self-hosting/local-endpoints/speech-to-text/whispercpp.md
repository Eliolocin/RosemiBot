---
title: "Transcrição com whisper.cpp"
sidebar:
  order: 2
---

Execute fala em texto leve e de alto desempenho para TomoriBot usando [whisper.cpp](https://github.com/ggerganov/whisper.cpp).

TomoriBot se conecta a Whisper.cpp por meio de seu endpoint de transcrição de áudio compatível com OpenAI (`POST /v1/audio/transcriptions`).

## Configuração

Inicie seu servidor HTTP do whisper.cpp e confirme se ele expõe um endpoint de transcrição compatível com a OpenAI:

- `POST /v1/audio/transcriptions`
- `GET /v1/models` ou `GET /models`

Mantenha o servidor em execução enquanto o TomoriBot o estiver utilizando. A URL do endpoint é a raiz do servidor, como `http://127.0.0.1:8022`.

Se a sua versão do whisper.cpp expuser uma estrutura de endpoint diferente, coloque um *wrapper* simples na frente dele que mapeie as requisições para o formato compatível com a OpenAI esperado pelo TomoriBot.

## Registrar no TomoriBot

Execute `/providers`, escolha `Adicionar Novo Endpoint Personalizado` e use a compatibilidade da API de transcrição:

- API Compatibility: `openai-compatible-transcription`
- `endpoint_url`: a raiz do servidor do seu whisper.cpp

Após salvar a conexão, selecione-a e use o menu suspenso do modelo para adicionar o nome do modelo que seu servidor relata como um modelo de Transcrição.

Use `/providers` para o registro do endpoint e configuração do modelo. Em seguida, abra `/config` > Models > Switch Models para selecionar e ativar o endpoint registrado.

## Usar transcrições

Após o registro, TomoriBot transcreve anexos de áudio em segundo plano e adiciona o texto ao contexto do bate-papo. Use `/config` > Mecanismo > Avisos somente se você também quiser que as transcrições sejam postadas de forma visível no bate-papo.
