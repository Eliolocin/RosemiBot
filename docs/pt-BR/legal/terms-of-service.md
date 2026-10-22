---
title: Termos de Serviço
description: Os termos que regem o uso da instância oficial hospedada do TomoriBot.
aiGenerated: false
---

*Esta é uma tradução de conveniência. A versão em inglês prevalece.*

Última atualização: 2026-10-22

Ao configurar ou interagir com o TomoriBot, você aceita estes Termos e os Termos de Serviço e as Diretrizes da Comunidade do Discord. Estes Termos se aplicam à instância oficial hospedada do TomoriBot no Discord. Se você executar sua própria cópia a partir do repositório de código aberto do TomoriBot, você não estará vinculado a estes Termos; em vez disso, seu uso será regido pela licença AGPLv3 no `LICENSE`, e somente você controlará o manuseio de dados em seu ambiente de hospedagem própria.

## 1) Definição de termos
Estes termos são usados neste documento:
- **Servidor**: uma comunidade do Discord onde o TomoriBot está configurado
- **Memórias**: fatos ou informações ensinados ao TomoriBot por comandos, ou aprendidos por ela com a ferramenta de função `remember_this_fact`
- **Persona/Predefinição**: perfis configuráveis de personalidade e comportamento que mudam como o TomoriBot responde
- **Provedor**: serviços de IA ou pesquisa de terceiros (por exemplo, Google, NovelAI, OpenRouter, Brave Search) usados para processar solicitações pelo TomoriBot
- **Instância hospedada**: o serviço oficial do TomoriBot mantido como bot público para o Discord, em oposição a cópias de hospedagem própria
- **Chave de API**: credenciais que conectam o TomoriBot a um Provedor, fornecidas por você ou gerenciadas pelo serviço hospedado para acesso por assinatura
- **Assinatura**: benefícios pagos de associação que fornecem uma franquia de uso de IA pela instância hospedada
- **Patrocínio**: autorização de um membro para um Servidor compartilhar sua franquia de assinatura
- **Gatilho**: um evento que faz o TomoriBot gerar uma resposta usando um Provedor configurado, como mencionar o bot, responder às suas mensagens, usar comandos de barra que precisam de IA/pesquisa ou enviar mensagens em canais com resposta automática ativada. Gatilhos consomem uso financiado pela chave pessoal de API, chave de API do Servidor ou franquia de assinatura selecionada.
- **Gerenciador do Servidor**: membro com permissão para configurar o TomoriBot em um Servidor, como quem executa `/setup`

## 2) Escopo do serviço
- O TomoriBot é um chatbot de IA que responde a interações do Discord usando Provedores externos. O acesso pode usar chaves de API fornecidas por você ou uma franquia de assinatura gerenciada pelo serviço hospedado.
- Podemos alterar, suspender ou encerrar recursos do TomoriBot a qualquer momento por manutenção, segurança ou motivos legais.

## 3) Quem aceita o quê
- Um Gerenciador do Servidor aceita estes Termos para o Servidor ao concluir `/setup`, confirmando que leu a Política de Privacidade e disponibilizará essas informações aos membros.
- Um Gerenciador do Servidor não pode aceitar estes Termos em nome de outro membro, nem garante sua idade ou conduta. Cada membro aceita estes Termos por si ao interagir com o TomoriBot.
- Os membros podem ler os documentos atuais a qualquer momento com `/legal terms-of-service` e `/legal privacy-policy`.
- Estes Termos se aplicam ao uso pessoal, uso em Servidores e solicitações patrocinadas, incluindo as de membros sem conta no Patreon ou assinatura própria.
- Gerenciadores devem informar os membros sobre o TomoriBot, o processamento de mensagens e as restrições de idade e uso aplicáveis. São responsáveis por usar controles razoáveis de canais e cargos para gerenciar o acesso e onde o TomoriBot lê mensagens, e por responder a denúncias de uso inelegível ou proibido.

## 4) Suas responsabilidades
- Não use o TomoriBot para conteúdo ilegal, prejudicial ou proibido pela plataforma, assédio ou tentativas de acesso não autorizado.
- Não use o TomoriBot para criar ou solicitar conteúdo sexual envolvendo menores ou representações sexuais de pessoas reais. Esta restrição vale para todos os Provedores e fontes de financiamento.
- Você deve cumprir a idade mínima do Discord em seu país, de pelo menos 13 anos. Ao usar o serviço, você declara cumprir esse requisito.
- Você permanece responsável pelo conteúdo fornecido (mensagens, memórias, dados de personas e arquivos). Garanta que tem direito de compartilhá-lo e evite dados sensíveis que não queira processados pelos Provedores configurados.
- Envie apenas amostras de voz que tenha permissão para usar e clonar. Não use vozes clonadas ou personificação para enganar, assediar ou fraudar pessoas.
- Respeite limites de requisições e evite spam ou abuso que prejudiquem o serviço.

## 5) Conteúdo com Restrição de Idade
- Recursos que produzem conteúdo adulto vêm desativados por padrão e devem ser ativados deliberadamente por um Gerenciador do Servidor.
- Um Gerenciador do Servidor que os ativa confirma que tem 18 anos ou mais e que o conteúdo será restrito aos canais que o Discord marca como com restrição de idade, que são acessíveis apenas para adultos.
- Conteúdo que é proibido pelas Diretrizes da Comunidade do Discord ou por lei permanece proibido independentemente de qualquer configuração, marcação de canal ou confirmação de idade.
- Podemos desativar esses recursos para um Servidor, ou remover o acesso inteiramente, onde parecer que eles estão alcançando menores ou produzindo conteúdo proibido.

## 6) Provedores e modelos de terceiros
- Você pode usar Provedores externos pelo TomoriBot (por exemplo, Anthropic, Google Gemini, OpenAI, OpenRouter, NovelAI, Brave Search). Seus termos, políticas de privacidade, filtros de segurança e termos de modelo aplicáveis regem o conteúdo processado por eles.
- Todos devem cumprir os termos, requisitos de idade e restrições de uso de cada Provedor e modelo utilizado, seja com chaves pessoais, do Servidor ou patrocínio.
- O TomoriBot não tem afiliação, endosso ou patrocínio do Discord ou desses Provedores. Somos um serviço independente que integra suas APIs.
- Não controlamos o comportamento nem as políticas de retenção ou segurança desses Provedores.
- Conteúdo gerado por IA pode ser impreciso, tendencioso ou inadequado apesar dos filtros. O TomoriBot não verifica nem endossa as respostas da IA.

## 7) Chaves de API e cobrança

### 7.1) Chaves fornecidas por você

- Se você fornecer chaves de API para provedores de IA/pesquisa, autoriza o TomoriBot a armazená-las e usá-las para atender suas solicitações. Todas são criptografadas em repouso.
- Forneça apenas chaves de API que tenha autorização legal para usar: obtidas diretamente do provedor pela sua conta ou explicitamente autorizadas pelo titular da conta. São estritamente proibidas:
  - Chaves de API roubadas, vazadas ou comprometidas
  - Chaves compradas de terceiros não autorizados ou mercados ilegais
  - Chaves compartilhadas em violação aos termos do provedor
- Você assume toda a responsabilidade legal pela legitimidade das chaves fornecidas.
- Usamos suas chaves nos recursos configurados para você ou seu Servidor. Provedores pessoais podem financiar suas solicitações entre Servidores, incluindo respostas automáticas; chaves de Servidor podem financiar solicitações dos membros desse Servidor. Não usamos suas chaves para usuários sem relação, desenvolvimento ou análise.
- Você é responsável por todos os custos e uso da conta no provedor causados por cada Gatilho do TomoriBot associado à sua chave. Monitore os painéis de uso e cobrança. `/tool estimate cost` fornece uma estimativa aproximada do custo por gatilho.
- Recomendamos chaves com permissões mínimas necessárias e limites de requisições e gastos no provedor, quando disponíveis.

### 7.2) Franquias de assinatura e patrocínio

O TomoriBot usa o OpenRouter para processar solicitações financiadas por assinaturas. Todos que usam essa franquia, incluindo membros de Servidores patrocinados, devem ter pelo menos 18 anos e cumprir os [termos do OpenRouter](https://openrouter.ai/terms) e os [termos dos modelos aplicáveis](https://openrouter.ai/docs/guides/routing/provider-selection#terms-of-service).

- Assinaturas financiam os recursos compatíveis do bot hospedado por uma única franquia compartilhada entre seu uso pessoal e todos os Servidores patrocinados por você. As descrições dos níveis informam preço e franquia; as chaves hospedadas não são fornecidas para uso externo.
- O uso financiado pela assinatura para quando a franquia acaba e é reposto após uma renovação paga confirmada. A franquia não utilizada não acumula. Trocar modelos ou atualizar a associação não a repõe.
- Upgrades pagos confirmados acrescentam apenas a diferença acima da maior franquia já concedida naquele período, sem zerar gastos nem mudar as datas. Downgrades reduzem a franquia na próxima renovação paga.
- Cancelar a renovação mantém o acesso até a data de cobertura paga confirmada. Falha de pagamento, reembolso, perda de elegibilidade ou violação destes Termos podem encerrá-lo antes.
- Preços dos provedores e uso real determinam o consumo; quantidades de respostas ou gerações são estimativas. Solicitações que falham ou são canceladas ainda podem gerar custos e reduzir sua franquia.
- Gerencie pagamentos e cancele renovações pelo Patreon, conforme [seus termos](https://www.patreon.com/policy/legal). Analisamos [pedidos de reembolso enviados pelo Patreon](https://support.patreon.com/hc/en-us/articles/360021113811-How-to-request-a-refund); o Patreon ou a loja de aplicativos da compra também podem analisar solicitações conforme suas políticas. Para questões sobre benefícios do TomoriBot, contate-nos pela Seção 12.

## 8) Tratamento de dados
- A [Política de Privacidade](/legal/privacy-policy/) descreve dados coletados, retenção e finalidades.
- Você pode exportar ou apagar dados pessoais e do Servidor pelos comandos listados nela. Registros de assinatura têm controles separados e podem exigir contato com o suporte. `/personal nuke` e `/nuke` não cancelam uma associação do Patreon.
- Conteúdo do Servidor, como memórias e documentos enviados, permanece após a exclusão pessoal, sem a associação de autoria. Peça a um Gerenciador para remover entradas específicas com `/memories`, ou contate-nos pela Seção 12 se não conseguir resolver uma questão sobre seus dados pessoais com ele.
- Alguns registros operacionais podem permanecer pelo prazo informado, ou por mais tempo quando exigido por lei ou por segurança.

## 9) Disponibilidade, suporte e alterações
- A disponibilidade não é garantida. Falhas, manutenção ou limites de requisições podem interromper respostas.
- Podemos atualizar estes Termos conforme o serviço se desenvolve ou por necessidades legais, de segurança ou operacionais. Anunciaremos alterações relevantes pelo Discord de suporte ou repositório do projeto e daremos aviso prévio razoável quando prejudicarem usuários existentes. Alterações legais ou de segurança urgentes podem valer imediatamente. Se afetarem benefícios pagos, notificaremos os membros afetados antes da aplicação e explicaremos como cancelar a renovação. Qualquer prazo de aviso maior exigido por lei será respeitado.

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
- Nossa responsabilidade total é limitada ao maior valor entre (a) valores que você nos pagou pelo serviço, incluindo benefícios de assinatura, ou (b) $10 USD no total para todas as reivindicações.
- Ao usar o serviço hospedado do TomoriBot, você aceita esses riscos. Se você não se sentir confortável com eles, considere a hospedagem própria do TomoriBot a partir do repositório de código aberto, onde você mantém controle total sobre o armazenamento de dados, criptografia e práticas de segurança.
- Nada nestes Termos limita os direitos que não podem ser limitados sob a lei aplicável a você.

## 12) Relatos e Contato
- Para dúvidas, relatos de abuso, relatos de segurança ou um relato de que o TomoriBot mantém dados sobre alguém abaixo da idade mínima aplicável, envie um e-mail para `bredrumb@gmail.com` ou contate-nos no [servidor oficial de suporte do TomoriBot no Discord](https://discord.gg/bjCfHm9QsB).
- Use e-mail ou uma mensagem direta em vez de uma issue pública no GitHub para qualquer coisa que envolva dados pessoais ou uma vulnerabilidade de segurança.
