---
title: "Transcrição WhisperX"
sidebar:
  order: 1
---

Configure fala para texto local e precisa para TomoriBot usando o servidor [WhisperX](https://github.com/m-bain/whisperX) incluído. WhisperX fornece transcrição de áudio rápida com alinhamento em nível de palavra.

## Configuração

Execute estes comandos na raiz do repositório TomoriBot:

### Windows PowerShell

```powershell
cd servers/stt
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python whisperx_server.py
```

### Linux/macOS Bash

```bash
cd servers/stt
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python whisperx_server.py
```

Mantenha esse terminal aberto enquanto TomoriBot estiver usando WhisperX. O URL do terminal padrão é `http://127.0.0.1:8021`.

## Registrar na TomoriBot

Execute `/providers`, escolha `Adicionar Novo Endpoint Personalizado`, e use a compatibilidade da API de transcrição:

- API Compatibility: `openai-compatible-transcription`
- `endpoint_url`: `http://127.0.0.1:8021`

Depois de salvar a conexão, selecione-a e use o menu suspenso do modelo para adicionar `large-v3`, ou qualquer que seja o valor definido em `WHISPERX_MODEL`, como um modelo de Transcrição.

Use `/providers` para o registro do endpoint e configuração do modelo. Em seguida, abra `/config` > Models > Switch Models para selecionar e ativar o endpoint registrado.

## Usar transcrições

Após o registro, TomoriBot transcreve anexos de áudio em segundo plano e adiciona o texto ao contexto do bate-papo. Use `/config` > Mecanismo > Avisos somente se você também quiser que as transcrições sejam postadas de forma visível no bate-papo.
