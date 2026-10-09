---
title: "MOSS-TTS"
---

Avalie localmente a clonagem de voz e o design de voz em linguagem natural por meio de um endpoint de fala unificado usando [MOSS-TTS](https://github.com/OpenMOSS/MOSS-TTS).

Usando `servers/tts/moss/server.py`, TomoriBot roteia solicitações de síntese dinamicamente: ele carrega o modelo clone quando uma persona fornece `ref_audio` e muda para MOSS-VoiceGenerator quando recebe orientação `instruct` em linguagem natural. Apenas um modelo é mantido na memória da GPU por vez para funcionar dentro de orçamentos de VRAM de 16 GB.

O modelo de clone padrão é [MOSS-TTS-Local-Transformer-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5) (4B), selecionado como linha de base prática para GPUs de 16 GB. [MOSS-TTS-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-v1.5) é uma alternativa carro-chefe de 8B que requer mais VRAM no BF16. O design de voz usa [MOSS-VoiceGenerator](https://huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator) (aproximadamente 1,7B). A troca entre clonagem e design de voz incorre em um atraso no carregamento do modelo.

## Configuração

Execute comandos da raiz do repositório TomoriBot usando Python 3.12 e um driver compatível com CUDA 12.8:

### Windows PowerShell

```powershell
python -m venv servers\tts\moss\.venv
servers\tts\moss\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers\tts\moss\requirements.txt
python servers\tts\moss\prefetch_models.py
python servers\tts\moss\server.py
```

### Linux ou WSL Bash

```bash
python3.12 -m venv servers/tts/moss/.venv
source servers/tts/moss/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers/tts/moss/requirements.txt
python servers/tts/moss/prefetch_models.py
python servers/tts/moss/server.py
```

O comando de pré-busca baixa o modelo clone, VoiceGenerator e tokenizers de áudio em seu cache Hugging Face antes de iniciar o servidor. Se o espaço em disco for limitado, configure `HF_HOME` para uma partição maior. Para baixar apenas um modelo, passe `--mode clone` ou `--mode voice-design`.

O terminal padrão é `http://127.0.0.1:8018`. Execute `bun run launch --moss` para iniciar o servidor junto com TomoriBot. O modo automático pré-aquece o modelo clone do cache local. Em vez disso, defina `MOSS_TTS_WARM_MODE=voice-design` para pré-aquecer o VoiceGenerator ou `MOSS_TTS_WARM_MODE=none` para inicialização lenta. Verifique `GET /health` para `warm_mode`, `active_mode` e `model_id` ativos. O wrapper usa Hugging Face `trust_remote_code=True`, portanto revise o código upstream antes das atualizações.

## Registrar no TomoriBot

Em `/providers`, escolha `Add New Custom Endpoint`, defina Compatibilidade API como `tts-clone` e use o URL do terminal `http://127.0.0.1:8018`. Adicione um modelo de fala com `Modo de Fonte de Voz` definido como `Automático` e `Script Markup` definido como `Simples`. Ative-o em `/config` > `Modelos` > Switch Models.

Para clonagem de voz, carregue um clipe de referência limpo em `/config` > `Modelos` > TTS Parâmetros e vozes e atribua-o em Persona > `Voz`. Clipes de áudio mais curtos e limpos produzem resultados mais consistentes. Para design de voz, salve uma descrição em linguagem natural em Persona > `Voz`. Observe que o MOSS-VoiceGenerator foi projetado para inglês e chinês. Embora o modelo clone 4B suporte o japonês, as tags de idioma explícitas melhoram a clareza da síntese.

O adaptador clone do TomoriBot não envia tags de idioma automaticamente. Para uso em um único idioma, defina `MOSS_TTS_DEFAULT_LANGUAGE=Japanese` (ou `Português (Brasil)`, `Chinese`, etc.) antes de iniciar o servidor. Chamadas `/synthesize` manuais podem passar `language` diretamente.

O servidor lê seu próprio ambiente shell; as configurações no `.env` do bot não se aplicam a um terminal Python iniciado de forma independente.

Para executar o modelo 8B em hardware com muita memória, defina `MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5` antes da pré-busca. `MOSS_TTS_PORT`, `MOSS_TTS_DEVICE`, `MOSS_TTS_DTYPE` e `MOSS_TTS_MAX_NEW_TOKENS` são configuráveis em `.env.optional.example`. Aumente `TTS_SYNTHESIZE_TIMEOUT_MS` em TomoriBot se trocas de modelo ou execução de CPU causarem tempos limite.
