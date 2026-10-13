---
title: "Compatibilidad con proxy de mensajes"
description: "Elige un servicio de proxy de mensajes de Discord compatible y permite que TomoriBot siga de forma segura sus republicaciones verificadas por webhook."
sidebar:
  order: 3
---

La compatibilidad con proxy de mensajes permite a TomoriBot seguir los mensajes que un bot externo de Discord elimina y vuelve a publicar a través de un webhook.

## Elegir un servicio

Ejecuta `/personal message-proxy service:pluralkit` o `/personal message-proxy service:pluralbuddy`. Elige `service:none` (mostrado como Desactivado) para inhabilitar el procesamiento de proxy. Este es un ajuste personal en la cuenta de Discord que envía los mensajes originales y sigue a esa cuenta en todos los servidores.

Después de que TomoriBot vea el primer mensaje verificado de un alter, usa `/personal config identity:` para editar su perfil y `/personal memories identity:` para editar sus memorias. El autocompletado incluye identidades guardadas de ambos servicios incluso cuando el procesamiento de proxy está desactivado. La interfaz de cuenta, la privacidad y la configuración de modelos permanecen en la cuenta anfitriona. El apodo establecido en TomoriBot se conserva hasta que se elimine; de lo contrario, el nombre visible del servicio se actualiza en los mensajes verificados. Consulta [Compatibilidad con PluralKit](/es-419/features/integrations/pluralkit-support/) para ver detalles sobre miembros y biografías.

## Qué significa la comprobación de seguridad

Tomori nunca asigna una identidad de webhook a partir de su nombre o avatar. El servicio seleccionado debe verificar el ID de republicación, la cuenta anfitriona y un ID de alter estable. PluralKit también identifica el mensaje original exacto, por lo que TomoriBot puede transferir su decisión de activación y su objetivo de respuesta. PluralBuddy no proporciona ese ID original. TomoriBot utiliza un mensaje reciente del mismo anfitrión y canal como coincidencia de mejor esfuerzo. Si la republicación llega después del tiempo de espera original o si varios mensajes originales se superponen, podría ignorarse o provocar una segunda respuesta. Una verificación fallida o en conflicto nunca crea una identidad.

Esta es la razón por la que Tupperbox no se ofrece actualmente como opción. Su documentación pública describe el uso de proxies, pero no una API pública y acreditada de atestación de mensajes que TomoriBot pueda usar con seguridad.

## Breve demora en los mensajes

Cuando se selecciona un servicio, Tomori espera brevemente antes de procesar cada mensaje ordinario de servidor proveniente de tu cuenta. Esto le da tiempo al servicio para eliminarlo y volverlo a publicar. Los mensajes no mediados por proxy continúan tras la espera. Las republicaciones de PluralKit heredan la decisión de activación y el objetivo de respuesta originales. PluralBuddy utiliza el contenido de la republicación verificada y una coincidencia de mejor esfuerzo con un mensaje reciente.

Quienes utilicen autoalojamiento pueden ajustar este mecanismo con `MESSAGE_PROXY_WAIT_MS`. La configuración de transporte del servicio se mantiene independiente, como el tiempo de espera de la API de PluralKit y el token opcional. Las consultas de mensajes de PluralBuddy requieren credenciales de aplicación OAuth en `PLURALBUDDY_CLIENT_ID` y `PLURALBUDDY_CLIENT_SECRET`. Los usuarios individuales no necesitan proporcionar tokens. El adaptador actual solo consulta `pluralbuddy.app`; no se admiten instancias autoalojadas de PluralBuddy.
