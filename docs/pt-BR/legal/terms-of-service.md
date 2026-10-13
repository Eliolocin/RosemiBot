---
title: Termos de Serviço
description: Os termos que regem o uso da instância oficial hospedada do TomoriBot.
aiGenerated: false
---

*Esta é uma tradução de conveniência. A versão em inglês prevalece.*

Última atualização: 2026-09-12

Ao configurar ou interagir com o TomoriBot, você aceita estes Termos e os Termos de Serviço e as Diretrizes da Comunidade do Discord. Estes Termos se aplicam à instância oficial hospedada do TomoriBot no Discord. Se você executar sua própria cópia a partir do repositório de código aberto do TomoriBot, você não estará vinculado a estes Termos; em vez disso, seu uso será regido pela licença AGPLv3 no `LICENSE`, e somente você controlará o manuseio de dados em seu ambiente de hospedagem própria.

## 1) Definição de Termos
Para maior clareza, estes termos são usados ao longo deste documento:
- **Servidor**: Uma guilda/comunidade do Discord onde o TomoriBot está configurado.
- **Memórias**: Fatos ou informações ensinadas ao TomoriBot por meio de comandos, ou autoaprendidas por meio da ferramenta de função `remember_this_fact`.
- **Persona/Predefinição**: Perfis de personalidade e comportamentais configuráveis que mudam como o TomoriBot responde.
- **Provedor**: Serviços de pesquisa ou IA de terceiros (por exemplo, Google, NovelAI, OpenRouter, Brave Search) que você configura o TomoriBot para usar.
- **Instância Hospedada**: O serviço oficial do TomoriBot mantido como um bot público para o Discord, em oposição a cópias de hospedagem própria.
- **Chave de API**: Credenciais de autenticação que você fornece para conectar o TomoriBot aos Provedores escolhidos.
- **Gatilho**: Um evento que faz com que o TomoriBot gere uma resposta em um canal de texto do Discord usando seu provedor configurado, como: mencionar o bot, responder às suas mensagens, usar comandos de barra (slash commands) que exigem processamento de IA/pesquisa ou enviar mensagens em canais onde a resposta automática (auto-reply) está ativada. Gatilhos consomem créditos/tokens de API da sua conta do provedor.
- **Gerenciador do Servidor**: Um membro com permissão para configurar o TomoriBot para um Servidor, como o membro que executa `/setup`.

## 2) Escopo do Serviço
- O TomoriBot é um chatbot com tecnologia de IA que responde a interações no Discord usando Provedores externos que você configura.
- Podemos alterar, suspender ou encerrar recursos do TomoriBot a qualquer momento por motivos de manutenção, segurança ou legais.

## 3) Quem Aceita o Quê
- Um Gerenciador do Servidor aceita estes Termos para o Servidor ao concluir o `/setup`, e confirma ali que leu a Política de Privacidade e que disponibilizará essas informações aos membros do Servidor.
- Um Gerenciador do Servidor não pode aceitar estes Termos em nome de outro membro, e não garante a idade ou conduta de nenhum outro membro. Cada membro aceita estes Termos para si mesmo ao interagir com o TomoriBot.
- Os membros podem ler os documentos atuais a qualquer momento com `/legal terms-of-service` e `/legal privacy-policy`.
- Os Gerenciadores do Servidor são responsáveis por informar aos seus membros que o TomoriBot está instalado e como ele processa mensagens, e por usar os controles de canal e cargo disponíveis para limitar onde o TomoriBot lê mensagens.

## 4) Suas Responsabilidades
- Não use o TomoriBot para conteúdo ilegal, prejudicial ou não permitido pela plataforma, assédio ou tentativas de acesso não autorizado.
- Você deve ter a idade mínima que o Discord exige no seu país, que é de pelo menos 13 anos, para usar o TomoriBot. Ao usar o serviço, você declara que atende a esse requisito de idade.
- Você permanece responsável pelo conteúdo que fornece (mensagens, memórias, dados de persona, envios). Certifique-se de que possui os direitos de compartilhá-lo e evite dados sensíveis que você não deseja que sejam processados por seus Provedores configurados.
- Respeite os limites de taxa (rate limits) e evite spam ou abuso que degrade o serviço.

## 5) Conteúdo com Restrição de Idade
- Recursos que produzem conteúdo adulto vêm desativados por padrão e devem ser ativados deliberadamente por um Gerenciador do Servidor.
- Um Gerenciador do Servidor que os ativa confirma que tem 18 anos ou mais e que o conteúdo será restrito aos canais que o Discord marca como com restrição de idade, que são acessíveis apenas para adultos.
- Conteúdo que é proibido pelas Diretrizes da Comunidade do Discord ou por lei permanece proibido independentemente de qualquer configuração, marcação de canal ou confirmação de idade.
- Podemos desativar esses recursos para um Servidor, ou remover o acesso inteiramente, onde parecer que eles estão alcançando menores ou produzindo conteúdo proibido.

## 6) Provedores e Modelos de Terceiros
- Você pode conectar o TomoriBot a Provedores externos (por exemplo, Anthropic, Google Gemini, OpenAI/OpenRouter, NovelAI, Brave Search). Seus termos, políticas de privacidade, filtros de segurança e faturamento se aplicam a qualquer conteúdo que você enviar por meio deles.
- A aceitação destes Termos abrange apenas o TomoriBot. Não é a aceitação dos termos de nenhum Provedor e não o isenta deles. Revise os termos do Provedor escolhido antes de configurá-lo com o TomoriBot.
- O TomoriBot não é afiliado, endossado ou patrocinado pelo Discord ou por nenhum desses Provedores. Somos um serviço independente que se integra às APIs deles.
- Não podemos controlar o comportamento, a retenção ou as políticas de segurança desses Provedores.
- O conteúdo gerado por IA pode ser impreciso, tendencioso ou inapropriado, apesar dos filtros de segurança. O TomoriBot não verifica nem endossa as saídas de IA.

## 7) Chaves de API e Faturamento
- Se você fornecer chaves de API para provedores de IA/pesquisa, você autoriza o TomoriBot a armazená-las e usá-las para atender às suas solicitações. Todas as chaves fornecidas são criptografadas em repouso.
- Você só deve fornecer chaves de API que esteja legalmente autorizado a usar. Isso significa chaves obtidas diretamente do provedor sob sua própria conta ou chaves explicitamente autorizadas para seu uso pelo titular da conta. O seguinte é estritamente proibido:
  - Chaves de API roubadas, vazadas ou comprometidas
  - Chaves compradas de terceiros não autorizados ou mercados clandestinos
  - Chaves compartilhadas em violação aos termos de serviço do provedor
- Você assume toda a responsabilidade legal pela legitimidade das chaves de API que fornece.
- Usaremos suas chaves de API apenas para processar suas interações explícitas com o TomoriBot. Não agrupamos chaves de API (pool), não usamos suas chaves para processar solicitações de outros usuários, nem as usamos para testes, desenvolvimento, análises ou qualquer outra finalidade que não seja atender às solicitações diretas suas e dos membros do seu servidor ao TomoriBot.
- Você é responsável por todos os custos do lado do provedor e pelo uso da conta causados por cada gatilho do TomoriBot associado à sua chave de API. Monitore os painéis de controle da sua chave de API para uso e faturamento. O comando `/tool estimate cost` fornece uma estimativa aproximada dos custos por gatilho.
- Recomendamos o uso de chaves de API com o mínimo de permissões necessárias e limites de taxa e de gastos do lado do provedor, quando disponíveis.

## 8) Manuseio de Dados
- Os dados coletados, os períodos de retenção e as finalidades de uso estão descritos na [Política de Privacidade](/pt-BR/legal/privacy-policy/).
- Você pode exportar ou apagar seus dados com os comandos listados naquele documento. `/personal nuke` apaga seus dados pessoais em todos os Servidores; `/nuke` apaga os dados de um Servidor e é restrito a Gerenciadores do Servidor.
- O conteúdo pertencente a um Servidor, como memórias do Servidor e documentos enviados, sobrevive a uma exclusão pessoal com sua autoria removida. Peça a um Gerenciador do Servidor para remover entradas específicas com `/memories`.
- Alguns registros operacionais podem persistir por seu período de retenção declarado ou por mais tempo quando exigido por lei ou por segurança.

## 9) Disponibilidade, Suporte e Alterações
- A disponibilidade do serviço não é garantida. Interrupções, manutenção ou limites de taxa podem interromper as respostas.
- Podemos atualizar estes Termos a qualquer momento. Alterações materiais serão anunciadas com pelo menos 30 dias de antecedência no servidor de suporte do Discord ou no repositório do projeto, e serão refletidas pela atualização da data da "Última atualização". Continuar a usar o bot após as alterações significa que você aceita os Termos revisados.

## 10) Rescisão
- Podemos suspender ou remover o acesso por violações destes Termos, requisitos legais ou preocupações de segurança.
- Você pode remover o TomoriBot a qualquer momento. Considere executar `/nuke` antes da remoção, pois os dados de um Servidor são de outra forma mantidos para que a configuração sobreviva a um novo convite.

## 11) Isenções de Responsabilidade e Limitação de Responsabilidade
- O serviço é fornecido "COMO ESTÁ" (AS IS) e "COMO DISPONÍVEL" (AS AVAILABLE) sem garantias de qualquer tipo. Nós nos isentamos de garantias implícitas de comercialização, adequação a uma finalidade específica, não violação e disponibilidade ininterrupta.
- Nós criptografamos as credenciais em repouso, usamos TLS com verificação de certificado para conexões de banco de dados e restringimos o acesso ao banco de dados ao tempo de execução do bot e aos operadores com acesso à infraestrutura. Nenhum sistema é completamente seguro e não podemos garantir proteção contra todas as ameaças, violações ou acessos não autorizados.
- Até a extensão máxima permitida por lei, não somos responsáveis por:
  - Danos indiretos, incidentais, consequenciais ou punitivos
  - Ações de provedores ou usuários de terceiros
  - Acesso não autorizado, roubo, corrupção ou perda de quaisquer dados armazenados pelo TomoriBot (incluindo chaves de API, memórias, personas e configurações)
  - Quaisquer danos, exceto em casos de negligência grave ou má conduta intencional de nossa parte
- Nossa responsabilidade total é limitada ao maior valor entre (a) valores que você nos pagou pelo serviço (geralmente $0 USD; doações voluntárias não são pagamento por serviço) ou (b) $10 USD no total para todas as reivindicações.
- Ao usar o serviço hospedado do TomoriBot, você aceita esses riscos. Se você não se sentir confortável com eles, considere a hospedagem própria do TomoriBot a partir do repositório de código aberto, onde você mantém controle total sobre o armazenamento de dados, criptografia e práticas de segurança.
- Nada nestes Termos limita os direitos que não podem ser limitados sob a lei aplicável a você.

## 12) Relatos e Contato
- Para dúvidas, relatos de abuso, relatos de segurança ou um relato de que o TomoriBot mantém dados sobre alguém abaixo da idade mínima aplicável, envie um e-mail para `bredrumb@gmail.com` ou contate-nos no [servidor oficial de suporte do TomoriBot no Discord](https://discord.gg/bjCfHm9QsB).
- Use e-mail ou uma mensagem direta em vez de uma issue pública no GitHub para qualquer coisa que envolva dados pessoais ou uma vulnerabilidade de segurança.
