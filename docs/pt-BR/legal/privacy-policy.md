---
title: Política de Privacidade
description: Como a instância oficial hospedada do TomoriBot coleta, armazena e exclui seus dados.
aiGenerated: false
---

*Aviso: Esta é uma tradução fornecida por conveniência. Em caso de conflito, a versão em inglês prevalece.*

Última atualização: 2026-09-12

Esta Política de Privacidade explica como a instância oficial hospedada do TomoriBot lida com dados. Se você fizer hospedagem própria (self-hosting) do TomoriBot a partir deste repositório, você controla seus próprios dados; este documento é um modelo de referência e não rege sua implantação de hospedagem própria.

Termos como "Servidor", "Memórias", "Persona/Predefinição", "Provedor", "Gatilho" e "Chave de API" são definidos em nossos [Termos de Serviço](/pt-BR/legal/terms-of-service/). Por favor, consulte esse documento para as definições.

## Privacidade em Resumo

- Não mantemos uma cópia do seu histórico de bate-papo do Discord. O TomoriBot lê mensagens recentes enquanto está respondendo e, em seguida, as descarta.
- Se a memória de curto prazo (STM) estiver ativada, o TomoriBot armazena resumos curtos derivados dessas conversas. Estes expiram após um período de inatividade (90 dias por padrão).
- Tudo o que você ensinar (memórias, configurações de persona, documentos enviados) ao TomoriBot de propósito é armazenado até que alguém exclua.
- Quando o TomoriBot responde, ele envia seu prompt e contexto recente para o provedor de IA configurado para esse servidor. Esse provedor tem seus próprios termos e práticas de privacidade, que não controlamos.
- `/personal nuke` apaga tudo o que armazenamos sobre você, em todos os servidores.

As seções abaixo fornecem detalhes por trás de cada um desses pontos.

## 1) Quem Esta Política Cobre

Esta política se aplica à instância oficial hospedada do TomoriBot. Os administradores do servidor configuram o TomoriBot para um Servidor, mas cada membro cujas mensagens o TomoriBot processa é coberto por esta política, tendo ou não executado um comando por conta própria.

Os administradores do servidor aceitam os Termos de Serviço durante o `/setup` e confirmam lá que disponibilizarão essas informações para seus membros. Qualquer membro pode ler as políticas atuais a qualquer momento com `/legal privacy-policy` e `/legal terms-of-service`.

## 2) O Que Armazenamos

### 2.1) Sobre Você
- Identidade e preferências: sua ID de usuário do Discord, preferência de idioma e status de recusa de privacidade.
- Configurações de personalização: o apelido que você escolhe, pronomes, identidade de gênero, formas de tratamento, marcadores de aparência física, um prompt de personificação, um URL de imagem de referência de personagem, deslocamento de fuso horário e substituições de prefixo/sufixo de mensagem.
- Preferências de nomenclatura: como cada persona deve chamar você.
- Memórias pessoais: fatos que você ensina ao TomoriBot sobre si mesmo, ou que ele salva sobre você quando memórias pessoais estão ativadas.
- Destaques: a configuração de destaque pessoal que você define por servidor.
- Registros de condicionamento: o texto e o motivo que você fornece por meio de `/reward` e `/punish`, que moldam como uma persona se comporta naquele Servidor.
- Contadores de uso: contagens diárias de comandos, modelos e ferramentas que você usou, além de totais de tokens, vinculados a você, ao Servidor e à persona. Isso alimenta o `/stats`.

### 2.2) Sobre Seu Servidor
- Configuração do servidor: atributos da persona, diálogos de exemplo, palavras-gatilho, provedor e seleções de modelo, permissões de canal e função, cotas, fuso horário e alternâncias de recursos.
- Memórias do servidor: fatos ensinados ao TomoriBot para todo o Servidor. Estes podem descrever membros, incluindo membros que não os escreveram.
- Metadados de emoji e figurinha: IDs do Discord, nomes, descrições e sinalizadores de formato. Os próprios arquivos de imagem não são armazenados.
- Lembretes: o texto do lembrete, a ID e o apelido do usuário de destino no Discord, o canal, a programação e qualquer configuração de recorrência.
- Resumos de memória de curto prazo: quando a memória de curto prazo (STM) está ativada, o TomoriBot grava resumos curtos derivados da conversa recente no banco de dados para que possa permanecer contextual entre os Gatilhos. Estes são excluídos após um período de inatividade (90 dias por padrão).
- Links de integração: links de sala e canal do Matrix, e os URLs, nomes de ferramentas descobertos e tokens de autenticação criptografados para quaisquer servidores MCP que um administrador conecte.

### 2.3) Credenciais
- Chaves de API do provedor que você escolhe armazenar, em nível de Servidor ou pessoalmente.
- Definições de endpoint personalizadas, incluindo o URL do endpoint e qualquer token de portador.

Todas as credenciais são criptografadas em repouso.

### 2.4) Conteúdo Que Você Envia
- Documentos: o texto completo extraído de arquivos enviados para a base de conhecimento de um Servidor, junto com o nome do arquivo, tipo de mídia, tamanho e embeddings de pesquisa gerados a partir desse texto.
- Imagens da persona: avatares, sprites e imagens de referência de personagens, armazenados no armazenamento de objetos para que as personas possam renderizar de forma consistente.
- Amostras de voz: amostras de áudio e suas transcrições de referência, quando a clonagem de voz está configurada.

### 2.5) Registros Operacionais
- Logs de erro: IDs de interação, IDs de usuário e Servidor, nomes de comando, tipos de erro e rastreamentos de pilha. O conteúdo das mensagens e as conversas não são registrados. Mantidos por 90 dias.
- Métricas de desempenho: amostras de tempo e recursos usados para manter a integridade do serviço. Mantidas por 30 dias.
- Mapeamentos de mensagens de persona: IDs de mensagens e canais do Discord vinculando uma mensagem enviada ao sprite da persona que usou, para que o TomoriBot possa atualizar ou limpar suas próprias mensagens. Mantidos por 30 dias.

## 3) O Que Não Armazenamos

O seguinte é lido enquanto o TomoriBot está preparando uma resposta e não é gravado em nosso banco de dados:

- Mensagens do Discord: mensagens recentes do canal (normalmente as últimas 80) são lidas na memória para construir o contexto e enviadas ao Provedor configurado. Elas são descartadas assim que a resposta é gerada. Os resumos podem ser retidos separadamente se a memória de curto prazo estiver ativada, conforme descrito na Seção 2.2.
- Anexos e mídias: imagens, vídeos e fotos de perfil analisados durante um Gatilho são processados na memória e descartados.
- Metadados de Servidor e canal: nomes de Servidor, descrições, nomes de canais e tópicos são lidos do zero a cada vez.
- Informações de presença: sua atividade ou status atual, quando disponível.
- Imagens de emoji e figurinha: buscadas no Discord cada vez que são usadas.

## 4) O Que Enviamos para Terceiros

- Provedores de IA: seu prompt, o contexto recente descrito acima, dados da persona e quaisquer anexos são enviados para o provedor configurado para esse Servidor ou para você, como Google, OpenRouter, NovelAI ou um endpoint personalizado. Isso abrange solicitações de texto, visão, embedding, imagem, vídeo, fala e transcrição. Seus termos, políticas de privacidade, filtros de segurança e regras de retenção se aplicam a esse conteúdo, e não os controlamos.
- Provedores de pesquisa: se a pesquisa na web estiver ativada, consultas de pesquisa e contexto relevante vão para o provedor de pesquisa configurado.
- Matrix: se uma ponte Matrix estiver configurada para um canal, as mensagens cruzam entre o Discord e a sala vinculada do Matrix.

Não vendemos dados pessoais. Os compartilhamos apenas conforme necessário para operar os recursos que você invoca, ou quando a lei exige.

## 5) Por Quanto Tempo Mantemos

| Dados | Retenção |
|---|---|
| Resumos de memória de curto prazo | 90 dias após a última atividade (padrão) |
| Logs de erro | 90 dias |
| Métricas de desempenho | 30 dias |
| Mapeamentos de mensagens da persona | 30 dias |
| Tudo o mais na Seção 2 | Até ser excluído por meio dos comandos na Seção 6 |

Quando o TomoriBot é removido de um Servidor, os dados daquele Servidor são mantidos para que a configuração sobreviva a um novo convite. Um administrador que deseja que isso seja removido deve executar `/nuke` antes de remover o bot.

## 6) Seus Controles

| O que você quer | Comando |
|---|---|
| Parar o TomoriBot de salvar memórias pessoais sobre você | `/personal config` |
| Revisar ou remover memórias pessoais individuais | `/personal memories` |
| Revisar ou remover memórias e documentos do Servidor | `/memories` |
| Fazer uma cópia de seus dados pessoais | `/export personal config`, `/export personal memories` |
| Fazer uma cópia dos dados de um Servidor | `/export config`, `/export memories` |
| Redefinir suas configurações pessoais para os padrões | `/reset personal config` |
| Apagar tudo o que armazenamos sobre você, em todos os Servidores | `/personal nuke` |
| Apagar os dados de um Servidor (apenas administradores) | `/nuke` |

O `/personal nuke` exclui suas memórias pessoais, personalização e configurações de nomenclatura, destaques, suas chaves de provedor salvas e endpoints pessoais, seus modelos registrados, seus contadores de uso, o condicionamento da persona com o qual você contribuiu e qualquer lembrete que você criou ou que foi definido para você. Duas consequências valem a pena conhecer antes de executá-lo:

- O condicionamento da persona que você contribuiu através de `/reward` e `/punish` molda como uma persona se comporta para todos naquele Servidor, portanto, removê-lo altera o comportamento compartilhado.
- As memórias do Servidor que você ensinou e os documentos que você enviou pertencem ao Servidor e são mantidos, com sua autoria removida. Se algum deles descrever você, peça a um administrador para removê-lo com `/memories`.

Suas configurações de recusa sobrevivem deliberadamente à exclusão, portanto, excluir seus dados não reativa silenciosamente a coleta sobre você.

Para qualquer coisa que esses comandos não possam alcançar, entre em contato conosco usando a Seção 9 e nós lidaremos com isso manualmente.

## 7) Segurança

- Chaves de API do provedor, tokens de portador e credenciais MCP são criptografados em repouso.
- Conexões de banco de dados usam TLS com verificação de certificado.
- O acesso ao banco de dados é limitado ao tempo de execução do bot e a operadores com acesso à infraestrutura.

Nenhum sistema é completamente seguro. Por favor, não dê ao TomoriBot informações altamente sensíveis ou regulamentadas.

## 8) Dados de Crianças

O TomoriBot não é direcionado a ninguém abaixo da idade mínima que o Discord exige em seu país, que é pelo menos 13 anos. Não coletamos intencionalmente dados de usuários abaixo dessa idade. Se você acredita que possuímos dados sobre alguém abaixo da idade mínima aplicável, entre em contato conosco usando a Seção 9 e nós os excluiremos.

## 9) Contato

Para dúvidas sobre privacidade ou solicitações além dos comandos acima, envie um e-mail para `bredrumb@gmail.com` ou nos contate no [servidor oficial do Discord de suporte do TomoriBot](https://discord.gg/bjCfHm9QsB). Por favor, use e-mail ou uma mensagem direta em vez de um problema público no GitHub para qualquer coisa que envolva seus dados pessoais.

## 10) Alterações

Podemos atualizar esta Política de Privacidade e a data de "Última atualização" acima será alterada quando o fizermos. Mudanças materiais são anunciadas por meio do Discord de suporte ou do repositório do projeto.

## 11) Usuários Internacionais e GDPR

- O serviço hospedado do TomoriBot está disponível globalmente, e os dados são armazenados na infraestrutura operada por nosso provedor de hospedagem.
- Se você estiver no Espaço Econômico Europeu, no Reino Unido ou na Suíça, você tem direitos de acordo com o GDPR para acessar, retificar, apagar, restringir e portar seus dados pessoais, e para se opor ao processamento.
- Os controles na Seção 6 cobrem acesso, portabilidade e apagamento diretamente. Para qualquer outra coisa, entre em contato conosco usando a Seção 9.
- Contamos com as seguintes bases legais: desempenho de um contrato para operar os recursos que você invoca; interesse legítimo para segurança, prevenção de abusos e estabilidade do serviço; e consentimento para recursos opcionais que você ativa, como memórias pessoais, memória de curto prazo e pesquisa na web. Você pode retirar esse consentimento desligando o recurso.
