---
title: "Puente de Matrix"
sidebar:
  order: 1
---

Conecte una sala Matrix a un canal Discord para que las personas puedan chatear en ambas plataformas. Los mensajes enviados desde Matrix aparecen en Discord como mensajes de webhook y TomoriBot responde directamente en la sala Matrix.

Para conocer la arquitectura de implementación y alojamiento del servicio de aplicaciones, consulte [Arquitectura de puente Matrix](/en/architecture/integrations/matrix/bridge/).

## Configuración

1. Invite a la cuenta del bot Matrix a una sala Matrix no cifrada.
2. Copia el ID de la habitación interna de esa sala (en la mayoría de los clientes: `Room Settings` > `Avanzado` > `Internal Room ID`, con el formato `!abc:matrix.org`).
3. Ejecuta `/matrix link` en el canal Discord que desea conectar y pegue la ID de la habitación.

Después de que el bot se une, publica una confirmación en Matrix, pero debes completar el enlace desde Discord usando `/matrix link`. Para desconectar un canal puenteado más adelante, ejecute `/matrix unlink`.

## Usarlo desde Matrix

- Charle normalmente una vez que la sala esté vinculada. Los mensajes de matriz se transmiten al canal Discord.
- TomoriBot responde en la sala Matrix.
- Los comandos de texto Matrix admitidos son `/kill` y `/refresh`.

## Limitaciones actuales

- No hay comandos de barra diagonal de Matrix (más allá de `/kill` y `/refresh`).
- Sin mensajes directos ni recordatorios de tiempo de reutilización basados en DM.
- Los avatares de Matrix no son visibles para las funciones de visión del robot.
- La fijación de mensajes no está disponible.
- Los emojis personalizados y los formatos complejos no se representan de manera confiable; incorpora la retransmisión como texto sin formato.
- Los recuerdos personales de los usuarios de Matrix recurren a los recuerdos atribuidos del servidor.

## Notas

- Si el bot no se une automáticamente, invite a la cuenta del bot Matrix manualmente y vuelva a ejecutar `/matrix link`.
- El cifrado Matrix no se puede desactivar después de la creación de la sala: una sala cifrada debe reemplazarse por una sala nueva sin cifrar.
- Para desvincular un canal, use `/matrix unlink`.
- Si un problema no aparece en la lista anterior, infórmelo en el servidor de soporte con `/support discord`.

En `/help`, elija `Plugins` y luego `Matrix` para ver el tutorial interactivo en Discord.
