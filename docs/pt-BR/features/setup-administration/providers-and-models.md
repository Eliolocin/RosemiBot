---
title: "Provedores & Modelos"
sidebar:
  order: 1
---

TomoriBot se conecta a provedores externos de IA em vez de hospedar um modelo integrado. Você pode conectar serviços hospedados como Google Gemini, OpenRouter e NovelAI ou apontá-los para endpoints auto-hospedados locais. Você precisa de pelo menos um provedor para começar a conversar.

## Chaves de API
<!-- anchor: api-keys -->

Adicione uma chave de provedor durante a configuração inicial com `/setup` ou posteriormente em `/providers` escolhendo `+ Add new Provider`. As chaves são criptografadas em repouso, para que ninguém, incluindo os administradores do servidor, possa lê-las.

`/setup` pergunta como as respostas devem chegar a um modelo antes de qualquer coisa, e a resposta decide o que coleta:

| Modo | O que coleta |
|---|---|
| Provedor de IA (recomendado) | Um provedor do catálogo mais sua chave API, validada e criptografada como rascunho. |
| Endpoint personalizado (avançado) | A conexão do endpoint e um modelo de texto, registrado dentro do assistente. Consulte [Endpoints personalizados](#custom-endpoints). |
| Usuário BYOK (somente guildas) | Nada: o espaço de trabalho não mantém provedor próprio, portanto os membros devem fornecer provedores pessoais. |

Nada é gravado no banco de dados até que você pressione `Concluir Configuração`. Um assistente abandonado ou expirado deixa as linhas de provedor existentes do espaço de trabalho intactas. Para substituir uma chave existente, use `/providers`, porque `/setup` não será executado em um espaço de trabalho já configurado.

Cada provedor tem suas próprias etapas de geração de chaves. Em `/help`, escolha `Configuração`, depois `Obter uma Chave de API` e escolha seu provedor para obter uma explicação passo a passo ou use estes pontos de partida:

| Provedor | Notas | Obtenha uma chave |
|---|---|---|
| Google Gêmeos | Nível gratuito, executa todos os recursos. Primeira configuração recomendada. | [Estúdio de IA](https://aistudio.google.com/apikey) |
| OpenRouter | Uma chave, muitos modelos (alguns gratuitos). | [Teclas OpenRouter](https://openrouter.ai/settings/keys) |
| NovelAI | Subscrição; narrativa e dramatização sem censura (somente texto). | [NovelAI](https://novelai.net/) |
| DeepSeek | Modelos de raciocínio pré-pagos. | [DeepSeek](https://platform.deepseek.com/api_keys) |
| NVIDIA NIM | Texto hospedado, incorporações e imagem. | [Compilação NVIDIA](https://build.nvidia.com/) |
| Antrópica | Modelos Claude através do API (não do Código Claude). | [Antrópico](https://console.anthropic.com/) |
| Z.ai | Família GLM. ⚠️ Os ToS restringem o uso a cenários de codificação e agente. | [Z.ai](https://z.ai/) |
| Vertex AI | Nuvem Google via `gcloud` ADC (melhor para configurações executadas localmente ou de desenvolvimento). | Veja abaixo |
| Vertex AI Express | Google Nuvem API-chave BYOK (visualização, subconjunto Gemini). | [Modo Expresso](https://console.cloud.google.com/expressmode) |
| Personalizada | Qualquer endpoint compatível com OpenAI (Ollama, vLLM, LiteLLM,…). | consulte [Endpoints personalizados](#custom-endpoints) |

:::caution
Nunca compartilhe sua chave API com mais ninguém. Adicione ou substitua um token de autenticação do portador de um endpoint personalizado de sua ação `Editar Endpoint` em `/providers`.
:::

Vertex AI autentica com Application Default Credentials (ADC) em vez de um segredo armazenado. Para hospedagem local, o ADC pode vir de `gcloud`; as implantações hospedadas devem usar uma identidade de carga de trabalho ou conta de serviço. Uma chave AI Studio API sozinha não autentica Vertex AI completo. O projeto Google Cloud selecionado deve ter faturamento e Vertex AI API ativados, e a identidade do host precisa de acesso Vertex. O guia de configuração está disponível em Google Vertex AI na página `API Keys` em `/help`.

A configuração do provedor apoiado por Google valida credenciais por meio do endpoint de listagem de modelos autenticado. Ele não gera texto nem depende de qualquer modelo de chat atualmente marcado como padrão do catálogo, portanto, um modelo padrão retirado não pode impedir que uma credencial válida seja salva.

### Opcional: Chave do Brave Search

O Brave Search é separado do seu provedor de IA e aprimora a pesquisa na web com resultados de imagens, vídeos e notícias. Defina-o em `/providers`. ⚠️ O Brave inclui US$ 5/mês de crédito gratuito, portanto, defina um limite de uso de US$ 5 no painel do Brave para evitar cobranças inesperadas.

## Escolhendo Modelos

Use `/providers` para gerenciar credenciais de servidor, catálogos de modelos e registros de endpoint. Em seguida, use `/config` > `Modelos` > Switch Models para selecionar as atribuições de capacidade compartilhada que cada membro do servidor usa. Ambos os comandos requerem permissões de gerenciamento de servidor.

Membros individuais gerenciam suas próprias credenciais e catálogos com `/personal providers` e depois selecionam modelos pessoais em `/personal config`. As configurações pessoais os seguem em todos os servidores onde usam TomoriBot. Consulte [Personalização](/pt-BR/features/knowledge/personalization/#your-own-providers) para configuração do usuário.

Os painéis são intitulados `Provedores do Servidor` e `Provedores Pessoais`, portanto a propriedade fica clara na abertura.

Em `/config` > `Modelos` > Switch Models, você pode atribuir modelos e endpoints em oito slots de capacidade:

- **Texto**: o modelo de chat principal.
- **Visão**: lê imagens quando o modelo de chat não consegue.
- **Incorporações**: alimenta a [base de conhecimento de documentos](/pt-BR/features/knowledge/memory/#document-knowledge-base-rag).
- **Imagem padrão**: geração de imagem padrão (consulte [Geração de imagem](/pt-BR/features/capabilities/media-generation/image-generation/)).
- **Imagem NovelAI**: geração de imagem NovelAI.
- **Vídeo**: geração de vídeo.
- **Ponto final TTS**: ponto final de voz de conversão de texto em fala.
- **Ponto final STT**: ponto final de transcrição de áudio de fala para texto.

Os primeiros seis slots escolhem registros de catálogo de modelos. Os slots TTS e STT escolhem terminais com escopo de espaço de trabalho, ativando o terminal selecionado em vez de gravar uma coluna de modelo. Registre e edite esses endpoints em `/providers`. `/personal config` mantém seis slots de roteamento de modelo pessoal e não inclui seletores de endpoint TTS/STT pessoais.

Você também pode gerenciar chaves de backup para failover automático e balanceamento de carga em `/providers`.

## Modelos de Decisões
<!-- anchor: decision-models -->

Os modelos de decisões são uma categoria separada em `/providers` e `/personal providers`. Eles respondem a predicados tipados com probabilidades. O registro não altera o modelo de chat ativo, não estabelece calibração nem ativa a dispensa da revisão de respostas. Esses painéis ainda não selecionam um modelo de decisões.

OpenRouter é o provedor nativo com suporte. Salve sua chave, abra o menu suspenso de modelos e escolha `+ Adicionar um modelo de decisões`. Insira um ID do catálogo de decisões verificado dele. O catálogo global inclui `typesafe/jev-1.13`; registros adicionais pertencem ao seu servidor ou proprietário pessoal. A descoberta nativa fornece o limite de entrada documentado e os preços. Catálogos de chat não podem estabelecer suporte a decisões.

Para um serviço personalizado, escolha `Adicionar Novo Endpoint Personalizado` e, em seguida, `Compatível com System One` ou `Compatível com OpenAI Decisions` em `Compatibilidade de API`. Salve a URL base da API e a credencial Bearer opcional. O menu suspenso de modelos oferecerá `+ Adicionar um modelo de decisões` e herdará esse protocolo. Insira o ID do modelo documentado e o limite de tokens de entrada (no mínimo 512). Jev, Laya e Kev usam compatibilidade com System One. Endpoints existentes compatíveis com chat e nativos do Ollama não oferecem essa ação.

Origens simples são normalizadas para `/v1`. Versões explícitas e prefixos de gateway permanecem intactos: `https://decision.example.invalid/gateway/v1` chama `/gateway/v1/systemone` para System One ou `/gateway/v1/decisions` para OpenAI Decisions. A verificação de disponibilidade usa `GET <stored-base>/models` sem enviar dados de conversa; ela não certifica as capacidades do modelo. Modelos personalizados são registrados manualmente a partir da documentação do serviço quando a descoberta não consegue estabelecer os metadatos de capacidade necessários.

Abra um registro de decisão salvo para editá-lo. Edições personalizadas preservam a identidade exata do modelo e do endpoint. Escolha `Excluir este registro de decisão` em `Ação de registro` para removê-lo mantendo a conexão e as credenciais. A remoção do provedor ou endpoint pai remove os registros daquele proprietário. Outros proprietários retêm entradas compartilhadas. As listas de modelos paginam após 18 registros editáveis usando os controles de página existentes.

Registros e credenciais de provedores permanecem fora das exportações e importações de personas e configurações. A redefinição de configuração preserva registros salvos; a exclusão do pai os limpa explicitamente.

## Endpoints Personalizados
<!-- anchor: custom-endpoints -->

Endpoints personalizados permitem registrar serviços auto-hospedados ou apoiados por proxy (Ollama, LM Studio, LiteLLM, vLLM, ComfyUI, TTS/STT local) como pacotes de provedores rotulados.

- **Escopo do servidor**: abra `/providers` para registro e edição do endpoint do espaço de trabalho.
- **Escopo pessoal**: abra `/personal providers` para catálogos de modelos pessoais (consulte [Personalização](/pt-BR/features/knowledge/personalization/#your-own-providers)). Os pontos finais de fala pessoal não são selecionados em `/personal config`.

Um rótulo é o nome do menu voltado para o usuário e agrupa recursos em um pacote quando eles compartilham um URL de terminal. Nunca é enviado para o serviço remoto. Os recursos atendidos por URLs diferentes precisam de rótulos distintos.

Para adicionar um endpoint personalizado:

1. Em `/providers`, escolha `Add New Custom Endpoint`.
2. Selecione a compatibilidade API e salve a conexão. Salvar prepara os recursos suportados por esse protocolo sem registrar nenhum modelo.
3. Selecione o novo endpoint e use seu menu suspenso de modelo para registrar um código e capacidade de modelo exatos. Adicionar um modelo ativa esse recurso.
4. Use o mesmo menu suspenso para anexar mais modelos ou editar registros existentes. Os modelos de texto declaram seus próprios recursos nesse formato, e os modelos de imagem declaram quais modos de solicitação eles suportam.

Para TTS e STT, registre o endpoint e seus modelos em `/providers` e, em seguida, escolha e ative o endpoint em `/config` > `Modelos` > Switch Models. Esses slots de fala selecionam um terminal em vez de uma entrada de catálogo de modelo.

A compatibilidade API determina os caminhos de solicitação e as cargas que o serviço implementa, portanto, também determina quais slots de capacidade a conexão prepara. O registro de modelos exatos para esses slots é uma etapa separada, porque o protocolo não pode ser inferido de forma confiável apenas a partir do URL do terminal.

O modo `Endpoint Personalizado (Avançado)` do `/setup` executa as mesmas duas etapas dentro do assistente: `Configurar Conexão` salva a compatibilidade, rótulo, URL e token de autenticação opcional do API atrás de uma verificação de acessibilidade, e `Configurar Modelo de Texto` registra o modelo de texto exato e suas declarações de capacidade. O botão do modelo permanece desativado até que a conexão seja validada e salvar novamente a conexão limpa a declaração do modelo porque as declarações dependem da compatibilidade do API. O assistente cria as linhas de conexão, provedor salvo, modelo e modelo ativo juntos quando você pressiona `Concluir Configuração`. O assistente registra apenas modelos de texto; Os recursos de imagem, vídeo, TTS e STT são registrados em `/providers`.

OpenCode Go (`https://opencode.ai/zen/go/v1`) e OpenCode Zen (`https://opencode.ai/zen/v1`) funcionam como endpoints personalizados compatíveis com OpenAI. TomoriBot envia a eles o ID de sessão por conversa necessário, derivado de um hash do canal e da persona, para que nenhum ID Discord saia do bot.

Para instruções completas sobre a execução de servidores locais, consulte:

- [Configuração: LLM local](/pt-BR/self-hosting/local-endpoints/setup-local-llm/): Ollama, KoboldCPP, LM Studio, vLLM, LiteLLM.
- [Configuração: ComfyUI](/pt-BR/self-hosting/local-endpoints/setup-comfyui/): geração local de imagem e vídeo.
- [Configuração: ChatMock](/pt-BR/self-hosting/local-endpoints/setup-chatmock/): conta ChatGPT ou Codex CLI.

## Provedores Suportados
<!-- anchor: supported-providers -->

Se você não possui hardware para hospedar seus próprios modelos, o TomoriBot oferece suporte a uma ampla gama de serviços em nuvem. Nem todos os recursos estão disponíveis em todos os provedores.

### Provedores de LLM

| Provedor | Transmissão | Chamada de ferramenta | Entrada de imagem | Incorporações | Notas |
|---|---|---|---|---|---|
| Google Gêmeos | ✅ | ✅ | ✅ | ✅ | Modelos gratuitos disponíveis |
| OpenRouter | ✅ | ✅ | ✅ | ✅ | Modelos gratuitos disponíveis |
| Antrópico (API) | ✅ | ✅ | ✅ | - | Não é o Código Claude |
| NovelAI | ✅ | ✅ | - | - | Somente GLM 4.6 pode usar ferramentas |
| NVIDIA NIM | ✅ | ✅ | ✅ | ✅ | Modelos gratuitos disponíveis |
| DeepSeek | ✅ | ✅ | - | - | - |
| Z.ai | ✅ | ✅ | ✅ | - | Modelos gratuitos; ⚠️ ToS = apenas codificação e uso do agente |
| Codificação Z.ai | ✅ | ✅ | - | - | Plano de assinatura |
| Google Vertex AI | ✅ | ✅ | ✅ | ✅ | Inclui versão Express 'gratuita' |
| CLI do Codex (via ChatMock) | ✅ | ✅ | ✅ | - | [Configuração](/pt-BR/self-hosting/local-endpoints/setup-chatmock/) |

### Geração de Imagem

| Provedor | Texto para imagem | Imagem a imagem | Pintura | Notas |
|---|---|---|---|---|
| Google | ✅ | ✅ | - | - |
| OpenRouter | ✅ | ✅ | - | - |
| NovelAI | ✅ | ✅ | ✅ | Pode combinar com outros provedores |
| NVIDIA | ✅ | - | - | Somente texto para imagem; imagens de referência são ignoradas |
| Z.ai | ✅ | - | - | - |

Esses são os padrões a partir dos quais os modelos de imagem de um provedor começam. NovelAI executa seu próprio pipeline em vez desta tabela. Registrar um modelo de imagem por meio de `/providers` permite declarar os próprios modos desse modelo, que é como você habilita a pintura interna em um fluxo de trabalho ComfyUI ou em um modelo de provedor cujo API suporta edição mascarada. Um modelo que você nunca declara continua seguindo os padrões acima. Declare apenas o que o modelo suporta: TomoriBot oferece ferramentas apenas para os modos selecionados e os modos não suportados falharão no momento da geração.

### Geração de Vídeo

| Provedor | Texto para vídeo | Imagem para vídeo | Notas |
|---|---|---|---|
| Google | ✅ | ✅ | Fluxo de trabalho de pesquisa assíncrona |
| OpenRouter | ✅ | ✅ | Fluxo de trabalho de pesquisa assíncrona |
| Z.ai | ✅ | ✅ | Fluxo de trabalho de pesquisa assíncrona |

### Voz & Áudio

| Provedor | Conversão de texto para fala | Fala para texto |
|---|---|---|
| ElevenLabs | ✅ | ✅ |

Os mecanismos de voz locais são cobertos por [Auto-hospedagem](/pt-BR/self-hosting/). Para pesquisa na web integrada e leitura de URL, consulte [Ferramentas e extensões](/pt-BR/features/capabilities/tools-and-extensions/#web-search--url-reading).
