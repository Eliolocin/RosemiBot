---
title: "Compatibilidad con PluralKit"
head:
  - tag: title
    content: "TomoriBot | Compatibilidad con PluralKit para sistemas plurales en Discord"
description: "TomoriBot funciona con mensajes mediados por proxy de PluralKit. Cada miembro del sistema es tratado como una persona propia con sus propias memorias personales, mientras que la configuración permanece en la cuenta anfitriona."
sidebar:
  order: 3
---

TomoriBot comprende los mensajes mediados por proxy de [PluralKit](https://pluralkit.me/). Con la compatibilidad activada, responde al mensaje de webhook del proxy en lugar del mensaje original que PluralKit elimina, y trata a cada miembro del sistema como una persona con su propio nombre, identidad y memorias personales, en lugar de agrupar a todos bajo la cuenta compartida de Discord. Esta página describe el aspecto de la función orientado al usuario. Para ver los detalles internos, consulta la [arquitectura del adaptador de PluralKit](/en/architecture/integrations/pluralkit/). El modelo de seguridad compartido se explica en [Compatibilidad con proxy de mensajes](/es-419/features/integrations/message-proxy-support/).

## Activación

Ejecuta `/personal message-proxy service:pluralkit`. Es una opción personal por cuenta, por lo que el personal del servidor no necesita configurar nada y te acompaña entre servidores. Los miembros de tu sistema no se registran de forma individual; la selección reside en la cuenta de Discord que envía los mensajes. Usa `/personal message-proxy service:none` para desactivarlo.

Si no utilizas PluralKit, déjalo desactivado. Cada mensaje que envíes pagaría una pequeña demora sin ningún beneficio (consulta a continuación).

## Qué cambia cuando está activado

- **Responde al mensaje correcto.** Sin esto, PluralKit elimina tu mensaje original a mitad de la generación y Tomori termina respondiendo a un fantasma. Con esto, espera brevemente, detecta el proxy y responde a la republicación del webhook, incluidas las *respuestas* mediadas por proxy a sus mensajes, que normalmente pierden su vinculación en el proceso.
- **Los mensajes de seguimiento funcionan a mitad de la respuesta.** Enviar otro mensaje mediado por proxy mientras Tomori aún está respondiendo al mismo miembro la interrumpe, y responde al mensaje más reciente de ese miembro. Un miembro diferente en la misma cuenta espera su turno, al igual que un miembro en otra cuenta.
- **Una breve pausa en tus mensajes.** Tomori espera unos **2 segundos** (quienes usen autoalojamiento pueden ajustar `MESSAGE_PROXY_WAIT_MS`) para comprobar si PluralKit elimina y vuelve a publicar tu mensaje. Los mensajes mediados por proxy suelen resolverse más rápido; los mensajes sin proxy simplemente llegan con ese pequeño retraso. Esta es la concesión que aceptas al activarlo, y la respuesta de confirmación del comando lo detalla.
- **Cada miembro es su propia persona.** Tomori reconoce el nombre del miembro, al sistema al que pertenece y la cuenta de Discord que lo aloja como tres hechos separados. Salir al frente como un miembro diferente significa hablar con ella como ese miembro, no como "la cuenta".
- **Las memorias personales son por miembro.** Un dato que Tomori aprende sobre un miembro se guarda para *ese miembro*. No se convierte en una memoria de todo el servidor, no se vincula a la cuenta anfitriona y no se filtra a los compañeros del sistema.
- **Los encuentros y reencuentros también son por miembro.** Lleva un registro individual de cuándo escuchó por última vez a cada miembro, de modo que un miembro con el que no ha hablado en un tiempo recibe un saludo cuando regresa, incluso si otra persona ha estado escribiendo desde la misma cuenta durante toda la semana. Un miembro que nunca ha conocido es un primer encuentro, y un miembro que ha estado presente hoy es simplemente parte de la conversación.
- **Importación única de biografía.** La primera vez que Tomori ve a un miembro, la descripción pública de PluralKit de ese miembro (si la tiene) puede guardarse como memoria personal inicial para que pueda respetar pronombres, límites y preferencias desde la primera conversación. Esta es una captura única. Si se edita la biografía en PluralKit más adelante, nunca se actualizará. Para cambiar lo que recuerda, solo díselo en el chat ("olvida eso", "en realidad, ...").
- **Importación única de pronombres.** Si los pronombres de un miembro son públicos en PluralKit, completan el ajuste de pronombres de ese miembro la primera vez que lo ve hablar, para que pueda usarlos desde la primera respuesta. A partir de entonces, ese ajuste queda entre tú y ella, por lo que un cambio posterior en PluralKit no lo sobrescribe, y `/personal config identity:` es donde lo corriges. Un miembro que mantenga sus pronombres privados, o no tenga ninguno configurado, simplemente comienza con el campo vacío.
- **La descripción de tu sistema, leída mientras tus miembros hablan.** Si tu sistema tiene una descripción pública, Tomori la conserva y la lee siempre que alguno de tus miembros esté en la conversación, de modo que los límites de todo el sistema se apliquen a todos ustedes sin repetirlos por miembro. Esta *sí* sigue las ediciones: cámbiala o bórrala en PluralKit y ella la actualizará la próxima vez que hable uno de tus miembros. Se muestra una vez para todo el sistema, no vinculada a ningún miembro individual, y una descripción privada o vacía simplemente se omite en lugar de sustituirse por un texto de relleno.

## Detalles de identidad que vale la pena conocer

- Los miembros se reconocen por los **ID internos estables** de PluralKit, nunca por el nombre. Renombrar a un miembro o cambiar su nombre visible no supone ningún problema: Tomori sigue sabiendo que es la misma persona y adopta estéticamente el nuevo nombre.
- La identidad proviene del mensaje mismo, no de quién esté "actualmente al frente": Tomori nunca sondea a quienes están al frente. Un miembro pasa a formar parte de la conversación en el momento en que envía un mensaje mediado por proxy, y Tomori no tiene forma de saber que existe hasta que haya usado el proxy al menos una vez mientras estabas registrado.
- **Nombrar a un miembro lo introduce en el contexto**, exactamente igual que nombrar a un participante humano: si alguien pregunta "¿qué pensaba Mirri?", Tomori carga las memorias de Mirri aunque Mirri no haya hablado recientemente. Esto se limita a miembros de sistemas cuya cuenta anfitriona está en el servidor, y un nombre ambiguo (dos personas o miembros que responden a él) se ignora en lugar de adivinarlo.
- Nombrar al **sistema** no acumula las memorias de sus miembros. Solo se cargan los miembros realmente presentes o nombrados, por lo que la conversación de un miembro al frente nunca expone datos sobre miembros que no forman parte de ella.
- Los datos privados del sistema permanecen privados. Tomori solo ve lo que PluralKit expone públicamente sobre el miembro y el sistema de un mensaje; no tiene acceso a campos protegidos por ACL de miembros. Si el nombre de tu sistema está oculto, recurre a la etiqueta de tu sistema o simplemente a "un sistema plural".

## La configuración permanece en la cuenta anfitriona

Tu cuenta de Discord sigue siendo lo que *controla* todo: nivel de privacidad, listas de bloqueo, enfriamientos, cuotas, claves de API y ajustes de `/personal` a nivel de cuenta se comparten entre tus miembros y se vinculan a la cuenta anfitriona. Establecer tu privacidad al máximo o estar en la lista de bloqueo de un servidor protege a **todos** tus miembros a la vez. Solo la identidad conversacional, las preferencias de perfil, la apariencia y las memorias se configuran por miembro.

## Limitaciones actuales

- `/personal memories identity:` edita las memorias globales y de persona de un miembro guardado. Usa `/personal config identity:` para editar el perfil, el apodo y la apariencia de ese miembro.
- La importación de biografía ocurre exactamente una vez por miembro en toda su historia. Las modificaciones posteriores de la biografía en PluralKit nunca se propagan. Díselo en el chat en su lugar.
- Tomori no puede mencionar con `@` a los miembros (los webhooks no son mencionables); se dirige a los miembros por su nombre.
- Si la API de PluralKit no puede verificar un mensaje republicado, TomoriBot lo ignora. Si PluralKit ya eliminó el mensaje original, TomoriBot no responderá a ese turno. No se crea ninguna identidad de miembro.

Si una limitación no aparece en la lista anterior, asume que debería funcionar y reporta cualquier fallo en el servidor de soporte (`/support discord`).
