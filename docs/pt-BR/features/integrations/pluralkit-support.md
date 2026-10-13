---
title: "Suporte ao PluralKit"
head:
  - tag: title
    content: "TomoriBot | Suporte ao PluralKit para sistemas plurais no Discord"
description: "A TomoriBot funciona com mensagens com proxy do PluralKit. Cada membro do sistema é tratado como uma pessoa própria com suas próprias memórias pessoais, enquanto as configurações permanecem na conta hospedeira."
sidebar:
  order: 3
---

A TomoriBot entende mensagens com proxy do [PluralKit](https://pluralkit.me/). Com o suporte ativado, ela responde à mensagem de webhook de proxy em vez da original que o PluralKit exclui, e trata cada membro do sistema como uma pessoa com seu próprio nome, identidade e memórias pessoais, em vez de agrupar todos sob a conta compartilhada do Discord. Esta página aborda o lado do usuário do recurso. Para detalhes internos, consulte a [arquitetura do adaptador PluralKit](/en/architecture/integrations/pluralkit/). O modelo de segurança compartilhado é abordado em [Suporte a Proxy de Mensagens](/pt-BR/features/integrations/message-proxy-support/).

## Como ativar

Execute `/personal message-proxy service:pluralkit`. É uma escolha pessoal por conta, portanto a moderação do servidor não precisa configurar nada e a preferência acompanha você entre servidores. Membros do seu sistema não precisam aderir individualmente; a seleção fica na conta do Discord que envia as mensagens. Use `/personal message-proxy service:none` para desativá-la.

Se você não usa o PluralKit, deixe esta opção desativada. Cada mensagem enviada teria um pequeno atraso sem nenhum benefício (veja abaixo).

## O que muda quando está ativado

- **Ela responde à mensagem correta.** Sem isso, o PluralKit exclui sua mensagem original no meio da geração e a Tomori acaba respondendo a uma mensagem fantasma. Com isso, ela espera brevemente, percebe o proxy e responde à republicação por webhook, incluindo *respostas* de proxy às mensagens dela, que normalmente perdem o vínculo de resposta no processo.
- **Continuações funcionam durante a resposta.** Enviar outra mensagem com proxy enquanto a Tomori ainda está respondendo ao mesmo membro interrompe a geração, e ela responde à mensagem mais recente daquele membro. Um membro diferente na mesma conta aguarda sua vez, assim como um membro em outra conta.
- **Uma breve pausa em suas mensagens.** A Tomori espera cerca de **2 segundos** (quem usa hospedagem própria pode ajustar `MESSAGE_PROXY_WAIT_MS`) para ver se o PluralKit exclui e republica sua mensagem. Mensagens com proxy geralmente são resolvidas mais rápido do que isso; mensagens sem proxy simplesmente chegam com esse pequeno atraso. Essa é a compensação aceita ao ativar o recurso, e a resposta de confirmação do comando deixa isso explícito.
- **Cada membro é sua própria pessoa.** A Tomori reconhece o nome do membro, a qual sistema ele pertence e qual conta do Discord o hospeda como três fatos separados. Assumir o controle como um membro diferente significa falar com ela como aquele membro, e não como "a conta".
- **Memórias pessoais são por membro.** Um fato que a Tomori aprende sobre um membro é armazenado para *aquele membro*. Não se torna uma memória do servidor inteiro, não se vincula à conta hospedeira e não vaza para colegas de sistema.
- **Conhecer e reencontrar também são por membro.** Ela acompanha quando ouviu cada membro pela última vez de forma individual, de modo que um membro com quem ela não fala há algum tempo é cumprimentado ao voltar, mesmo que outra pessoa tenha postado da mesma conta a semana toda. Um membro que ela nunca viu é um primeiro encontro, e um membro que esteve por aqui hoje é apenas parte da conversa.
- **Importação única de biografia.** Na primeira vez que a Tomori vir um membro, a descrição pública daquele membro no PluralKit (se houver) poderá ser salva como uma memória pessoal inicial para que ela possa respeitar pronomes, limites e preferências desde a primeira conversa. Este é um instantâneo único. Editar a biografia no PluralKit mais tarde nunca a atualiza. Para alterar o que ela lembra, basta dizer a ela no chat ("esqueça isso", "na verdade, ...").
- **Importação única de pronomes.** Se os pronomes de um membro forem públicos no PluralKit, eles preenchem a configuração de pronomes daquele membro na primeira vez que ela o vir falar, para que ela os utilize desde a primeira resposta. A partir de então, essa configuração é algo exclusivo entre você e ela, portanto uma alteração posterior no PluralKit não a substitui, e `/personal config identity:` é onde você a corrige. Um membro que mantém os pronomes privados, ou não tem nenhum definido, simplesmente começa com o campo vazio.
- **A descrição do seu sistema, lida enquanto seus membros conversam.** Se o seu sistema tiver uma descrição pública, a Tomori a mantém e a lê sempre que qualquer um dos seus membros estiver na conversa, para que limites gerais se apliquem a todos sem precisar repeti-los por membro. Esta *sim* acompanha edições: altere ou limpe no PluralKit e ela assimilará a mudança na próxima vez que um dos seus membros falar. Ela é exibida uma vez para todo o sistema, sem vinculação a nenhum membro individual, e uma descrição privada ou vazia é simplesmente omitida, em vez de substituída por um texto de preenchimento.

## Detalhes de identidade que vale a pena saber

- Os membros são reconhecidos pelos **IDs internos estáveis** do PluralKit, nunca pelo nome. Renomear um membro ou alterar o nome de exibição não causa problemas: a Tomori ainda sabe que se trata da mesma pessoa e atualiza o novo nome visualmente.
- A identidade vem da própria mensagem, e não de quem está "atualmente no controle": a Tomori nunca sonda quem está no controle. Um membro se torna parte da conversa no momento em que envia uma mensagem com proxy, e a Tomori não tem como saber que um membro existe até que ele tenha usado o proxy pelo menos uma vez enquanto você estava com o recurso ativado.
- **Chamar um membro pelo nome o traz para o contexto**, exatamente como acontece ao chamar um participante humano: se alguém perguntar "o que o Mirri achou?", a Tomori carrega as memórias do Mirri, mesmo que ele não tenha falado recentemente. Isso se limita a membros de sistemas cuja conta hospedeira esteja no servidor, e um nome ambíguo (duas pessoas ou membros atendendo por ele) é ignorado em vez de adivinhado.
- Mencionar o **sistema** não reúne as memórias de todos os membros. Apenas os membros realmente presentes ou nomeados são carregados, de forma que a conversa de um membro no controle nunca exponha fatos sobre membros que não fazem parte dela.
- Dados privados do sistema continuam privados. A Tomori vê apenas o que o PluralKit expõe publicamente sobre o membro e o sistema de uma mensagem; ela não tem acesso a campos protegidos por ACL de membros. Se o nome do seu sistema estiver oculto, ela recorrerá à tag do seu sistema ou simplesmente a "um sistema plural".

## As configurações permanecem na conta hospedeira

Sua conta do Discord continua sendo o que *controla* tudo: nível de privacidade, listas de bloqueio, tempos de recarga, cotas, chaves de API e configurações de nível de conta em `/personal` são compartilhados entre os membros e vinculados à conta hospedeira. Definir sua privacidade como máxima ou estar na lista de bloqueio de um servidor protege **todos** os seus membros de uma só vez. Apenas a identidade conversacional, preferências de perfil, aparência e memórias podem ser definidas por membro.

## Limitações atuais

- `/personal memories identity:` edita as memórias globais e de persona de um membro armazenado. Use `/personal config identity:` para editar o perfil, apelido e aparência daquele membro.
- A importação da biografia acontece exatamente uma vez por membro, para sempre. Edições posteriores da biografia no PluralKit nunca se propagam. Em vez disso, informe-a no chat.
- Membros não podem ser mencionados com `@` pela Tomori (webhooks não são mencionáveis); ela se dirige aos membros pelo nome.
- Se a API do PluralKit não conseguir verificar uma republicação, a TomoriBot a ignora. Se o PluralKit já tiver excluído a mensagem original, a TomoriBot não responderá àquela mensagem. Nenhuma identidade de membro será criada.

Se uma limitação não estiver listada acima, presuma que ela deva funcionar e relate bugs no servidor de suporte (`/support discord`).
