---
title: "Chatterbox TTS"
aiGenerated: true
---

Clone vozes em inglês com tags de emoção usando o servidor de conversão de texto em fala local [Chatterbox](https://github.com/resemble-ai/chatterbox).

Chatterbox é executado localmente via `servers/tts/chatterbox/server.py`. O padrão é o modelo rápido Chatterbox-Turbo (parâmetros 350M) com tags de evento de emoção inline como `[laugh]` e `[sigh]`. Você também pode configurar o modelo leve Chatterbox-Nano (parâmetros 110M) para configurações de CPU ou o modelo padrão 0,5B para orientação sem classificador (`cfg_weight`) e ajuste emocional do `exaggeration`. Este wrapper não carrega Chatterbox Multilingual V3.

## Configuração

Execute estes comandos na raiz do repositório TomoriBot, a pasta onde você clonou TomoriBot:

### Windows PowerShell

```powershell
python -m venv servers\tts\chatterbox\.venv
servers\tts\chatterbox\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install numpy
pip install -r servers\tts\chatterbox\requirements.txt
python servers\tts\chatterbox\server.py
```

### Linux/macOS Bash

```bash
python3 -m venv servers/tts/chatterbox/.venv
source servers/tts/chatterbox/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install numpy
python -m pip install -r servers/tts/chatterbox/requirements.txt
python servers/tts/chatterbox/server.py
```

Mantenha esse terminal aberto enquanto TomoriBot estiver usando Chatterbox. O URL do terminal padrão é `http://127.0.0.1:8011`; configure `CHATTERBOX_PORT` para usar outra porta.

### Opcional: usar Chatterbox-Nano

Nano requer uma construção Chatterbox com a opção de carregador `nano=True`. Após a configuração normal acima, instale a revisão upstream fixada no mesmo ambiente virtual. O hash de commit corrige a versão de origem compatível; não é uma garantia de segurança. Este comando requer `git` e mantém as dependências de tempo de execução já instaladas:

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

Em seguida, defina `CHATTERBOX_FAST_MODEL=nano` antes de iniciar o wrapper. Deixe a variável não definida para Turbo. No Windows PowerShell, configure-o com `$env:CHATTERBOX_FAST_MODEL = "nano"`; no Linux ou macOS, use `CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`. A resposta `/health` relata `fast_model` para que você possa verificar a escolha carregada. Nano e Turbo usam a mesma solicitação de clonagem e tags de eventos compatíveis. Ambos são apenas em inglês.

A alternância de modelo rápido `/config` deve permanecer habilitada para usar Nano ou Turbo. Desativá-lo seleciona o modelo Chatterbox 0,5B padrão para peso CFG e ajuste de exagero.

### Padrão Chatterbox (0,5B com CFG e exagero)

O modelo original Chatterbox de base 0,5B (`ChatterboxTTS`) é integrado diretamente no wrapper do servidor. Ele troca as tags de evento de suporte inline do Turbo por controle vocal refinado usando Classifier-Free Guidance (`cfg_weight`) e `exaggeration` emocional.

Para usar o modelo Padrão:
1. Inicie o wrapper do servidor normalmente.
2. Em Discord, execute `/config` > `Modelos` > `Parâmetros TTS e Vozes`.
3. Desative a opção `Fast Model (Turbo)`.
4. Na próxima geração, o wrapper baixa e carrega preguiçosamente o modelo padrão de 0,5B na memória.

Ambos os valores são campos de texto no modal `Editar Parâmetros`. Eles são sempre editáveis e a página indica que são ignorados enquanto o modelo rápido está ativado:
- **`cfg_weight`** (padrão `0.5`): Ajusta a aderência do áudio sintetizado ao andamento de referência e ao estilo vocal.
- **`exaggeration`** (padrão `0.5`): Controla a intensidade emocional e a inflexão dramática da entrega.

> [!OBSERVAÇÃO]
> O Chatterbox padrão não oferece suporte a tags de evento de colchetes embutidos (como `[laughs]` ou `[sigh]`). TomoriBot remove automaticamente as tags de colchetes do texto do prompt quando a alternância Modelo rápido está desativada.

## Registrar no TomoriBot

Inclua `Chatterbox` no rótulo do endpoint ou no nome do modelo. O TomoriBot só reconhece um endpoint do Chatterbox por esse nome (ou por uma URL de endpoint que o contenha), então a lista de tags permitidas do Turbo, a remoção de tags do modelo Standard e as opções do Chatterbox em `/generate voice-message` só se aplicam quando ele está presente.

Execute `/providers`, escolha `Adicionar Novo Endpoint Personalizado` e use a compatibilidade da API de fala:

- API Compatibility: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8011`

Após salvar a conexão, selecione-a e use a lista suspensa do modelo para adicionar um modelo de Fala. Escolha `Clone de Voz`
como o Modo de Fonte de Voz e `Tags em Colchetes` como o Script Markup para que as tags de entrega sobrevivam ao envio.

Use `/providers` para registro do endpoint e configuração do modelo. Em seguida, abra `/config` > Models > Switch Models para selecionar e ativar o endpoint registrado.

## Configure uma voz pessoal

1. Prepare um clipe de voz limpo de 10 segundos com um alto-falante e sem música de fundo.
2. Abra `/config` em Modelos > `Parâmetros TTS e Vozes` e carregue o clipe.
3. Abra `/config` em Persona > `Voz` e escolha a persona e a amostra de voz.

Um clipe mais longo não acrescenta nada para Chatterbox e também não é recusado. Seu tempo de execução trunca a referência antes do condicionamento, de modo que o áudio que passa pela janela é carregado, armazenado e depois ignorado ([`tts_turbo.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts_turbo.py), [`tts.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts.py)):

- O aviso acústico ocorre nos primeiros 10 segundos em cada variante.
- O contexto do token de fala são os primeiros 15 segundos no Turbo e Nano e 6 segundos no Standard.

Essas janelas são constantes no tempo de execução upstream, em vez de orientações publicadas: o repositório README não fornece comprimento de clipe de referência e seu nome de arquivo de exemplo é apenas `your_10s_ref_clip.wav`. A única duração que o tempo de execução realmente impõe é mínima, afirmando que o prompt dura mais de 5 segundos.

Dez segundos é, portanto, a meta prática. Ele preenche o prompt acústico, que é onde o timbre e a entrega são definidos, e um clipe entre 10 e 15 segundos adiciona contexto de token de fala apenas no Turbo e Nano. A incorporação do locutor ainda é computada a partir de todo o clipe, portanto, prolongar o tempo não altera a identidade do locutor, apenas quanto do prompt é descartado sem ser lido.

Turbo e Nano podem usar tags de evento de colchete, como `[laugh]` e `[sigh]`, quando a alternância de modelo rápido está habilitada.

## Afinação opcional

Use `/config` em Modelos > `Parâmetros TTS e Vozes` para ajustar a carga útil da solicitação Chatterbox:

- O padrão de alternância do modelo rápido é ativado. TomoriBot mantém tags de evento Turbo/Nano suportadas e remove descritores de colchetes não suportados antes que o wrapper chame `ChatterboxTurboTTS.generate(...)`.
- O padrão `cfg_weight` é `0.5`. O mínimo é `0`; TomoriBot não define um máximo rígido. Aplica-se apenas quando `turbo` é `false`; valores mais baixos podem ajudar a desacelerar vozes de referência rápidas, enquanto valores mais altos seguem a referência com mais força.
- O padrão `exaggeration` é `0.5`. O mínimo é `0`; TomoriBot não define um máximo rígido. Aplica-se apenas quando `turbo` é `false`; valores mais altos tornam a entrega mais expressiva ou dramática e podem acelerar a fala.

As tags de evento Turbo/Nano suportadas são `[clear throat]`, `[sigh]`, `[shush]`, `[cough]`, `[groan]`, `[sniff]`, `[gasp]`, `[chuckle]` e `[laugh]`. Descritores não suportados, como `[excited]`, `[whisper]` ou `[smiles]`, são removidos em vez de serem enviados para TTS.

Quando `turbo` está desabilitado, TomoriBot remove todos os descritores de colchetes antes de enviar o texto para TTS, então o wrapper carrega preguiçosamente o modelo `ChatterboxTTS` padrão e chama `model.generate(..., cfg_weight, exaggeration)`.
