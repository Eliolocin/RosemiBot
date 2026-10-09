---
title: "Qwen3-TTS"
aiGenerated: true
---

Sintetize fala de caracteres multilíngues altamente precisa usando [Qwen3-TTS](https://github.com/QwenAudio/Qwen3-TTS) nos modos de clonagem de voz e VoiceDesign descrito em texto.

Qwen3-TTS 12Hz 1.7B fornece síntese de fala local de alta precisão. A execução de `servers/tts/qwen3tts/server.py` em seu modo automático padrão seleciona dinamicamente o modelo de clonagem de voz Base ou o modelo VoiceDesign com base em cada solicitação recebida.

## Configuração

Execute estes comandos na raiz do repositório TomoriBot, a pasta onde você clonou TomoriBot:

### Windows PowerShell

```powershell
python -m venv servers\tts\qwen3tts\.venv
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r servers\tts\qwen3tts\requirements.txt
python servers\tts\qwen3tts\server.py
```

### Linux e macOS Bash

```bash
python3 -m venv servers/tts/qwen3tts/.venv
source servers/tts/qwen3tts/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r servers/tts/qwen3tts/requirements.txt
python servers/tts/qwen3tts/server.py
```

O URL do terminal de modo automático padrão é `http://127.0.0.1:8012`; configure `QWEN3TTS_PORT` para usar outra porta. Você também pode especificar explicitamente o modo automático:

```powershell
python servers\tts\qwen3tts\server.py --mode auto
```

O modo automático inspeciona cada solicitação `/synthesize`: solicitações com `ref_audio` usam o modelo clone, enquanto solicitações com `instruct` usam o modelo VoiceDesign. Ele mantém apenas um modelo carregado por vez e troca modelos quando o tipo de solicitação muda, portanto, a primeira solicitação após uma troca pode ser mais lenta.

## Registrar no TomoriBot

Para a maioria dos usuários, registre o servidor no modo automático para que um único endpoint possa suportar as personas tanto para clone de voz quanto para VoiceDesign.

Execute `/providers`, escolha `Adicionar Novo Endpoint Personalizado` e use a compatibilidade da API de fala:

- API Compatibility: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8012`

Após salvar a conexão, selecione-a e use o menu suspenso de modelo para adicionar um modelo de fala (Speech). O formulário do modelo pede por Modo de Fonte de Voz e Script Markup; escolha `Auto` e `Plain` para o servidor em modo automático.

Use `/providers` para registro do endpoint e configuração do modelo. Em seguida, abra `/config` > Models > Switch Models para selecionar e ativar o endpoint registrado.

## Configurar vozes pessoais

### Clonagem de voz

Use isto para personas que devem imitar um clipe de referência:

1. Prepare um clipe de voz limpo de 10 a 20 segundos com um alto-falante e sem música de fundo.
2. Abra `/config` em Modelos > `Parâmetros TTS e Vozes` e carregue o clipe.
3. Abra `/config` em Persona > `Voz` e escolha a persona e a amostra de voz.

Qwen3-TTS anuncia clonagem rápida a partir de apenas 3 segundos de áudio de referência, e seu tempo de execução não documenta nem impõe um limite de duração de referência. A duração do clipe é, portanto, uma compensação de qualidade que você controla, e não um limite que o servidor verifica.

### Design de Voz

Use isto para personas que devem usar uma descrição de voz escrita em vez de uma amostra:

1. Abra `/config` em Persona > `Voz` e escolha VoiceDesign.
2. Escolha a persona.
3. Insira um prompt de voz em linguagem natural, como idade, tom, sotaque e entrega do locutor.

Remova o prompt do VoiceDesign de uma persona de Persona > `Voz` em `/config`. Durante a geração, TomoriBot envia o prompt salvo no corpo JSON `/synthesize` como `instruct`; `voice_instructions` único da ferramenta são anexados.

O modo automático mantém ambas as configurações. Personas configuradas em Persona > `Voz` em `/config` usam síntese de clone ou síntese de VoiceDesign de acordo com sua seleção.

## Opcional: servidor somente VoiceDesign

Inicie o mesmo servidor no modo VoiceDesign ao atender `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`.

Windows PowerShell:

```powershell
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
$env:TOMORI_TTS_MODE = "voice-design"
python servers\tts\qwen3tts\server.py
```

Bash:

```bash
source servers/tts/qwen3tts/.venv/bin/activate
TOMORI_TTS_MODE=voice-design python servers/tts/qwen3tts/server.py
```

Você também pode passar `--mode voice-design` em vez de definir `TOMORI_TTS_MODE`. O URL de terminal padrão somente do VoiceDesign é `http://127.0.0.1:8014`.

Registre-o da mesma forma que o modo automático, mas use o URL do terminal `http://127.0.0.1:8014` e escolha `VoiceDesign` como o modo de fonte de voz no modelo de fala.
