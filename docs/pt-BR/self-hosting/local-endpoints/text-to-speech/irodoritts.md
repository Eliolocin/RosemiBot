---
title: "IrodoriTTS"
aiGenerated: true
---

Gere fala japonesa natural com clonagem de voz, VoiceDesign baseado em legenda e marcação de emoji expressiva usando [Irodori-TTS v4.1](https://github.com/Aratako/Irodori-TTS).

Irodori-TTS v4.1 é um modelo de conversão de texto em fala com foco em japonês que suporta clonagem de voz e VoiceDesign descrito em texto em um único ponto de verificação. TomoriBot se conecta ao Irodori por meio do wrapper FastAPI local em `servers/tts/irodoritts/`, padronizando para `Aratako/Irodori-TTS-v4.1-Small`.

Os pontos de verificação Hugging Face compatíveis podem ser selecionados com `IRODORI_TTS_MODEL_ID`, incluindo ajustes finos da comunidade, como `phasefield-audio/Irodori-TTS-v4.1-Anime`.

## Configurar

Irodori usa `uv` para dependência e gerenciamento de backend PyTorch. O servidor mantém seu próprio `pyproject.toml` com dependências Irodori e `dacvae` fixadas para instalações reproduzíveis. Instale `uv` primeiro e depois execute o script de configuração na raiz do repositório TomoriBot:

### Windows PowerShell (NVIDIA)

```powershell
.\servers\tts\irodoritts\install-irodori.ps1 cu128
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

### Linux Bash (NVIDIA)

```bash
bash servers/tts/irodoritts/install-irodori.sh cu128
servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

Os scripts de configuração criam `servers/tts/irodoritts/.venv`, portanto `bun run launch --irodoritts` continua funcionando após a instalação.

Back-ends disponíveis:

- `cu128`: NVIDIA CUDA 12.8 no Windows e Linux
- `cpu`: somente CPU ou macOS CPU/MPS por meio de PyPI
- `rocm`: AMD ROCm em Linux/WSL
- `xpu`: Intel XPU no Windows e Linux

O URL do terminal padrão é `http://127.0.0.1:8013`.

## Usando um ponto de verificação diferente

O modelo padrão é `Aratako/Irodori-TTS-v4.1-Small`. Repositórios Hugging Face compatíveis, ajustes finos da comunidade (como `phasefield-audio/Irodori-TTS-v4.1-Anime`) ou arquivos de ponto de verificação local podem ser configurados por meio de variáveis de ambiente.

Quando você inicia o servidor (diretamente com Python ou via `bun run launch --irodoritts`), ele lê automaticamente a raiz do repositório `.env` (ou um `.env` local em `servers/tts/irodoritts/`) e registra o ID do modelo ativo na inicialização.

### Via `.env` (persistente)

Adicione ao seu `.env` na raiz TomoriBot:

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### Via variável de ambiente por sessão

No Windows PowerShell:

```powershell
$env:IRODORI_TTS_MODEL_ID = "phasefield-audio/Irodori-TTS-v4.1-Anime"
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

No Linux Bash:

```bash
IRODORI_TTS_MODEL_ID=phasefield-audio/Irodori-TTS-v4.1-Anime \
  servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

### Usando um arquivo de ponto de verificação local

Se você baixou um arquivo de ponto de verificação (`.pt` ou `.safetensors`) localmente, defina `IRODORI_TTS_CHECKPOINT` como seu caminho:

```dotenv
IRODORI_TTS_CHECKPOINT="/path/to/custom_checkpoint.pt"
```

O Irodori atual baixa o ponto de verificação junto com quaisquer ativos tokenizadores agrupados no repositório Hugging Face. As variantes da subpasta Hugging Face também são suportadas por `IRODORI_TTS_MODEL_ID` quando o repositório do modelo as fornece.

## Registre-se em TomoriBot

Execute `/providers`, escolha `Add New Custom Endpoint` e use a compatibilidade de fala API:

- Compatibilidade API: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8013`

Depois de salvar a conexão, selecione-a e use o menu suspenso de modelo para adicionar um modelo de fala. Para v4.1, as configurações recomendadas são:

- `Modo de Fonte de Voz`: `Automático`
- `Estilo de Marcação de Script`: `Emoji`

`Automático` permite que o mesmo endpoint Irodori suporte ambos os modos de voz TomoriBot, para que os sinais emocionais sobrevivam ao envio:

- Personas com uma amostra de voz atribuída em Persona > `Voz` enviam um clipe de referência armazenado para clonagem de voz.
- Personas com um prompt VoiceDesign definido em Persona > `Voz` enviam o prompt salvo em linguagem natural como condicionamento de legenda Irodori.

Você ainda pode escolher `Clone de Voz` como modo de fonte de voz se desejar apenas clonagem de voz de áudio de referência.

Use `/providers` para registro de endpoint e configuração de modelo. Em seguida, abra `/config` > `Modelos` > Switch Models para selecionar e ativar o endpoint registrado.

## Configurar vozes pessoais

### Clonagem de voz

1. Prepare um clipe de voz japonês limpo com um alto-falante e sem música de fundo. Cerca de 30 segundos já são suficientes: depois desse ponto, o áudio extra adquire pouca fidelidade de timbre, ao mesmo tempo que custa o tamanho do upload e o tempo de inferência.
2. Abra `/config` em Modelos > `Parâmetros TTS e Vozes` e carregue o clipe.
3. Abra `/config` em Persona > `Voz` e escolha a persona e a amostra de voz.

O Irodori v4.1 suporta condicionamento de referência mais longo do que os modelos anteriores, mas o áudio de fonte limpa continua mais importante do que a duração bruta.

O tempo de execução da v4.1 limita o clipe de referência no ponto de verificação padrão, que o ponto de verificação da v4.1 define como 120 segundos. Qualquer coisa a mais é reduzida a esse limite, em vez de recusada, e `IRODORI_MAX_REF_SECONDS` o substitui. Um clipe no teto de upload de 130 segundos do TomoriBot, portanto, ainda funciona: condições Irodori nos primeiros 120 segundos dele.

Clipes mais longos não melhoram a qualidade da voz. Upstream relata que aproximadamente 30 segundos de fala de referência limpa já capturam a maior parte do ganho mensurável de similaridade de locutor e que vários clipes mais curtos do mesmo locutor superam uma gravação longa. As etapas latentes de referência extras que vêm com um clipe mais longo também prolongam cada solicitação de síntese. Alcance os 30 segundos somente quando o timbre do locutor flutuar na gravação.

### Design de Voz

1. Abra `/config` em Persona > `Voz`.
2. Escolha a persona.
3. Insira uma descrição em linguagem natural da voz e entrega desejadas.

TomoriBot envia este prompt como `instruct`; o wrapper Irodori o mapeia para a condição v4.1 `caption`. As solicitações do VoiceDesign não exigem um clipe de referência armazenado.

TomoriBot remove a sintaxe de emoji personalizada Discord antes de enviar texto para TTS. Com `script_markup: emoji`, os emojis Unicode são preservados para o condicionamento de texto do Irodori.

### Controles de estilo emoji

IrodoriTTS oferece suporte a anotações de emoji no texto de entrada para influenciar efeitos sonoros, estilos de fala e expressões emocionais. Com `Estilo de Marcação de Script` de TomoriBot definido como `Emoji`, esses emojis Unicode são preservados e enviados para Irodori.

| Emoji | Significado / emoção / estilo |
| --- | --- |
| 👂 | Sussurro, soa perto do ouvido |
| 😮‍💨 | Respiração, suspiro, respiração adormecida |
| ⏸️ | Pausa, silêncio |
| 🤭 | Rir, rir, rir reprimida |
| 🥵 | Ofegante, gemido, gemido |
| 📢 | Eco, reverberação |
| 😏 | Provocando, divertidamente doce / persuasivo |
| 🥺 | Voz trêmula, tímida/incerta |
| 🌬️ | Falta de ar, respiração pesada |
| 😮 | Suspiro |
| 👅 | Som de lambida, som de mastigação, som molhado |
| 💋 | Estalo labial / ruído labial |
| 🫶 | Gentilmente, ternamente |
| 😭 | Soluçando, chorando, tristemente / tristemente |
| 😱 | Grite, grite, grite |
| 😪 | Sonolento, lentamente / languidamente |
| 😴 | Dormir falando, roncando |
| ⏩ | Fala rápido, dispara rápido, apressadamente |
| 📞 | Por telefone, através de um alto-falante |
| 🐢 | Devagar |
| 🥤 | Gole, som de engolir |
| 🤧 | Tossir, fungar, espirrar, pigarrear |
| 😒 | Tutting, estalando a língua |
| 😰 | Em pânico, agitado, nervoso, gaguejando |
| 😆 | Alegremente, felizmente |
| 💥 | Com força/momentum, vigorosamente |
| 😠 | Zangado, descontente, de mau humor |
| 😲 | Surpresa, admiração / exclamação |
| 🥱 | Bocejar |
| 😖 | Dolorosamente, agonizantemente |
| 😟 | Ansioso, preocupado |
| 🫣 | Tímido, timidamente |
| 🙄 | Exasperadamente, revirando os olhos |
| 😊 | Alegremente, com prazer |
| 😎 | Com confiança, orgulhosamente |
| 👌 | Backchanneling, som de acordo |
| 🙏 | Suplicando, implorando |
| 🥴 | Bêbada |
| 🎵 | Cantarolando |
| 🤐 | Abafado (boca coberta) |
| 😌 | Aliviado, satisfeito |
| 🤔 | Voz questionadora, imaginando |
| 💪 | Com esforço, fortemente |
| 👃 | Som de cheirar / cheirar |
| 📖 | Narração, monólogo |

Repetir o mesmo emoji pode fortalecer seu efeito. O controle de emojis não é perfeitamente consistente, portanto, trate-os como dicas de estilo, em vez de resultados garantidos. Veja as [anotações oficiais de emoji IrodoriTTS](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small/blob/main/EMOJI_ANNOTATIONS.md) para a lista upstream e atualizações futuras.

## Mensagens de voz longas

O Irodori v4.1 prevê o comprimento da saída com seu preditor de duração em vez de gerar um clipe de comprimento fixo, de modo que o servidor não impõe um limite próprio de duração por enunciado. TomoriBot ainda fragmenta texto longo antes da síntese e concatena o áudio gerado em uma resposta WAV, então Discord recebe uma mensagem de voz; a fragmentação mantém cada passagem de inferência curta, que é o que limita a latência.

A implementação começa a partir da abordagem de chunking usada pelo [servidor oficial compatível com Irodori OpenAI](https://github.com/Aratako/Irodori-TTS-Server/blob/main/src/irodori_openai_tts/app.py), cujos padrões permitem chunking em 80 caracteres sem espaço em branco. TomoriBot adiciona um tratamento de limites mais rigoroso para que aspas de fechamento e colchetes permaneçam com a pontuação que fecham, execuções de pontuação como `！？` e `...` permaneçam juntas, pontos decimais próximos aos dígitos não sejam divididos e caudas finais muito curtas sejam mescladas de volta no bloco anterior.

O chunking prefere finais de frase fortes, como `。`, `！`, `？`, `.`, `!`, `?`, reticências e quebras de linha quando o comprimento mínimo configurado for atingido. As vírgulas são usadas apenas como limites alternativos depois que o bloco cresce para cerca de 1,5 vezes esse limite. Com o `IRODORI_CHUNK_MIN_CHARS=80` padrão, limites fortes tornam-se elegíveis em 80 caracteres sem espaço em branco e vírgulas em cerca de 120. Se uma passagem longa não contiver pontuação qualificada, ela ainda poderá permanecer como uma única solicitação de síntese.

Para VoiceDesign somente com legenda, a semente Irodori gerada do primeiro pedaço é reutilizada para os pedaços restantes para reduzir a variação aleatória entre as costuras. A reutilização de uma semente não garante timbre idêntico em pedaços sintetizados independentemente. O modo de áudio de referência continua a aplicar o mesmo clipe de referência a cada pedaço.

Entradas longas requerem múltiplas passagens de inferência sequenciais e podem demorar substancialmente mais em hardware mais lento. O tempo limite padrão do cliente TTS do TomoriBot é de 240 segundos. Você pode desabilitar o chunking com `IRODORI_CHUNKING_ENABLED=false` ou ajustar o limite de divisão aproximado com `IRODORI_CHUNK_MIN_CHARS`.

## Inferência mais rápida com amostragem oscilante

O padrão continua sendo a amostragem linear de 40 etapas de alta qualidade do Irodori. Para menor latência, experimente o Sway Sampling com menos etapas:

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

Esta é uma troca de qualidade e velocidade de inferência, então teste-a com o ponto de verificação e as vozes escolhidas antes de torná-la permanente.

## Variáveis de ambiente

| Variável | Padrão | Propósito |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Abraçando repositório de modelo Face ou fonte de repositório/subpasta compatível |
| `IRODORI_TTS_CHECKPOINT` | desarmar | Ponto de verificação local `.pt` ou `.safetensors` opcional; substitui o modelo Hugging Face |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Endereço de ligação do servidor; consulte [Acesso à rede](/pt-BR/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `IRODORI_TTS_PORT` | `8013` | Porta do servidor |
| `IRODORI_MODEL_DEVICE` | `auto` | Dispositivo modelo (`auto`, `cuda`, `cpu`, `mps`, `xpu`) |
| `IRODORI_CODEC_DEVICE` | `auto` | Dispositivo codec |
| `IRODORI_MODEL_PRECISION` | `bf16` em CUDA, caso contrário `fp32` | Precisão do modelo |
| `IRODORI_CODEC_PRECISION` | `fp32` | Precisão do codec |
| `IRODORI_COMPILE_MODEL` | `false` | Habilite `torch.compile` para o modelo Irodori |
| `IRODORI_COMPILE_DYNAMIC` | `false` | Habilite formas dinâmicas ao compilar |
| `IRODORI_NUM_STEPS` | `40` | Etapas de amostragem de Euler |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | Cronograma de amostragem (`linear` ou `sway`) |
| `IRODORI_SWAY_COEFF` | `-1.0` | Coeficiente de oscilação ao usar o cronograma `sway` |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | Escala de orientação de texto |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | Escala de orientação de legenda / VoiceDesign |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | Escala de orientação do locutor de referência |
| `IRODORI_MAX_REF_SECONDS` | ponto de verificação padrão | Limite opcional na duração do áudio de referência |
| `IRODORI_CHUNKING_ENABLED` | `true` | Divida o texto longo nos limites de pontuação elegíveis e concatene os pedaços gerados |
| `IRODORI_CHUNK_MIN_CHARS` | `80` | Mínimo de caracteres sem espaço em branco antes da divisão de limites fortes de frases; vírgulas são limites alternativos em cerca de 1,5x esse valor |
