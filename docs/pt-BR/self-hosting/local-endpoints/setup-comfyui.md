---
title: "Configuração: ComfyUI"
sidebar:
  order: 2
aiGenerated: false
---

O TomoriBot pode gerar imagens e vídeos através da sua própria instância do
[ComfyUI](https://github.com/comfyanonymous/ComfyUI). Ele controla o ComfyUI enviando
um fluxo de trabalho em formato de API com o seu prompt e tamanho substituídos, e então verifica
o endpoint `/history` do ComfyUI continuamente até que a saída esteja pronta.

Este guia cobre a instalação/execução do ComfyUI e como registrá-lo. Para criar ou editar
um fluxo de trabalho compatível com o TomoriBot (os marcadores `{TOMORI_*}`), use o aprofundamento
no Discord, abra `/help`, escolha `Recursos`, depois `Endpoints Personalizados`, e use o
[README de fluxo de trabalho](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows)
no GitHub.

:::note[Nenhuma variável de ambiente necessária]
O ComfyUI é registrado através dos comandos de barra do Discord e armazenado criptografado no banco de dados.
Veja a [central de endpoints locais](/pt-BR/self-hosting/local-endpoints/).
:::

## Requisitos de hardware

A geração de imagens e vídeos é limitada pela GPU: o maior custo é a VRAM (a memória da sua placa de vídeo,
separada da RAM do sistema), definida pelo checkpoint do modelo que o seu fluxo de trabalho carrega, não pelo
próprio ComfyUI. Uma GPU NVIDIA é fortemente recomendada. Os dois fluxos de trabalho que acompanham o TomoriBot
são ambos modelos modernos e mais pesados que o SDXL:

| Fluxo de trabalho incluso | Modelo base | VRAM prática | Notas |
|---|---|---|---|
| Anima v1 (imagem) | Qwen-Image (~20B), fp8 | ~16 GB mínimo · 24 GB confortável | O codificador de texto e o VAE adicionam ~8-10 GB de sobrecarga. Abaixo de 16 GB, use uma build GGUF + `--lowvram`. |
| WAN i2v loop (vídeo) | Wan 2.2 14B, fp8 + 4-step LightX2V LoRAs | ~16 GB viável · 24 GB+ confortável | A opção mais pesada, espere minutos por clipe. Descarregue o codificador de texto UMT5 para a RAM (`t5_cpu`, necessita de 24 GB+ de RAM no sistema) em placas menores. |

Ambos os checkpoints inclusos já estão quantizados em fp8 para caber em placas de consumo. Se você tem menos
VRAM, troque a UNET por uma quantização menor e ative o `--lowvram` / descarregamento para CPU do ComfyUI. A difusão apenas
com CPU é impraticável (vários minutos por imagem, pior para vídeo) e pode exceder a janela de espera do TomoriBot,
então uma GPU é efetivamente necessária para uso regular.

:::tip[Diminuindo ainda mais: escolha uma quantização GGUF]
A quantização armazena o peso de cada modelo em menos bits para reduzir o uso de VRAM e disco, a um pequeno
custo de precisão. Os arquivos fp8 inclusos são uma forma leve disso, e para diminuir ainda mais, baixe uma
build GGUF do modelo no Hugging Face: o código em nomes como `Q4_K_M` / `Q5_K_M` representa os
bits por peso, e 4 bits (Q4) ou 5 bits (Q5) costuma ser o ponto ideal com a maior parte da qualidade
por uma fração do espaço do fp8/fp16. Abaixo de 4 bits diminui mais, mas degrada rapidamente. Carregar
UNETs GGUF no ComfyUI necessita do nó personalizado [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF).
:::


## 1. Execute o ComfyUI com a API ativada

Instale o ComfyUI de acordo com [seu README](https://github.com/comfyanonymous/ComfyUI) e inicie-o para que ele
escute na rede:

```sh
python main.py --listen 0.0.0.0 --port 8188
```

O `--listen 0.0.0.0` é importante se o TomoriBot rodar no Docker ou em uma máquina diferente, pois o
padrão se vincula apenas ao loopback. Confirme a acessibilidade a partir da máquina onde o bot está rodando:

```sh
curl http://127.0.0.1:8188/system_stats
```

Se você quiser testar, carregue os checkpoints do modelo que o fluxo de trabalho escolhido espera e faça uma geração manual na
interface web do ComfyUI para confirmar que funciona de ponta a ponta antes de conectar o TomoriBot.

## 2. Pegue um fluxo de trabalho do TomoriBot

Baixe um fluxo de trabalho pronto para uso no formato de API. Exemplos podem ser encontrados no repositório sob
[`assets/comfyui-workflows/`](https://github.com/Bredrumb/TomoriBot/tree/main/assets/comfyui-workflows):

| Fluxo de trabalho | Modos |
|----------|-------|
| Anima v1 (imagem) : `tomoribot-anima-v1-comfyui.json` | `txt2img`, `img2img`, `inpaint` |
| WAN i2v loop (vídeo) : `tomoribot-wan-i2v-loop-video.json` | imagem para vídeo |

Estes estão no formato de API (o JSON que o ComfyUI exporta via *Save (API Format)*), não no formato regular
salvo pela interface. Se você criar o seu próprio, ele deve conter os marcadores `{TOMORI_*}`
que o TomoriBot substitui (prompt, largura/altura, seed, imagens de referência, etc.). Veja o README
do fluxo de trabalho e a página `Endpoints Personalizados` sob Providers em `/help`.

## 3. Registre-o no Discord

Execute `/providers` (ou `/personal providers`), escolha `Adicionar Novo Endpoint Personalizado`, e insira:

| Campo | Valor para o ComfyUI |
|-------|-------------------|
| `endpoint_label` | Um nome de sua escolha, ex. `home-comfy` |
| API Compatibility | `ComfyUI` |
| `endpoint_url` | `http://127.0.0.1:8188` (raiz, sem `/v1`) |
| `auth_token` | *(deixe em branco, a menos que seu ComfyUI exija autenticação)* |

Após salvar a conexão, selecione-a e use o menu suspenso de modelos para adicionar um modelo de Imagem ou Vídeo.
Insira o nome de código exato do checkpoint e faça upload do `.json` do fluxo de trabalho que você baixou
no Passo 2. A capacidade do modelo deve corresponder ao fluxo de trabalho (fluxo de imagem → `image`, fluxo de vídeo → `video`).

Um modelo de imagem também solicita as suas `Capacidades de Imagem`: texto para imagem, imagem de referência,
inpainting, e prompt negativo. Marque apenas os modos que o seu fluxo de trabalho realmente implementa, porque a
Tomori oferece à ferramenta apenas os modos que você declarar. O inpainting aparece apenas para conexões do
ComfyUI, pois nenhuma outra compatibilidade de API aceita uma máscara. Editar o modelo mais tarde reabre o formulário
com a sua seleção atual, então alterar um nome de código não irá limpá-la.

Adicionar o modelo o torna o modelo de `image`/`video` ativo automaticamente. Acione a geração pedindo diretamente para a Tomori no chat. Se ele não estiver ativo por algum motivo, execute `/config` > Models > Switch Models
e selecione o seu endpoint do ComfyUI registrado.

## Solução de problemas

- Inacessível ao adicionar: O ComfyUI foi vinculado ao loopback enquanto o bot está no Docker / em outro
  host. Inicie-o com `--listen 0.0.0.0` e use `http://host.docker.internal:8188` ou o
  IP da LAN.
- A geração nunca é concluída: O TomoriBot verifica o `/history` até que a saída apareça. Inícios
  a frio e modelos grandes na CPU podem exceder a janela de verificação.
- Prompt/tamanho ignorado ou tamanho de saída incorreto: o fluxo de trabalho está sem os marcadores
  obrigatórios `{TOMORI_*}`, ou você fez upload de uma exportação do formato de interface em vez do formato de API.
- Capacidade incorreta: um fluxo de trabalho de `image` registrado sob `video` (ou vice-versa) não irá
  funcionar. Adicione-o novamente sob a capacidade correspondente.
