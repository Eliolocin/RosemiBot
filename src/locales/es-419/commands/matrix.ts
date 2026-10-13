export default {
  matrix: {
    description: `Vincula canales de Discord a salas de Matrix para retransmisión bidireccional.`,
    link: {
      description: `Vincula un canal de Discord a una sala de Matrix para retransmisión bidireccional`,
      channel_description: `El canal de Discord a vincular`,
      room_description: `El ID de la sala de Matrix a vincular (por ejemplo, !abc:matrix.org)`,
      success_title: `Sala de Matrix vinculada`,
      success_description: `<#{channel_id}> ahora está conectado a \`{room_id}\`. Los mensajes que yo envíe aparecerán en la sala de Matrix, y los mensajes de Matrix aparecerán aquí.

Abre {help_matrix}, luego Integraciones > Matrix, para conocer los pasos de configuración, las notas de comandos exclusivos de Matrix y la lista de limitaciones actual.`,
      invalid_room_title: `ID de sala no válido`,
      invalid_room_description: `El ID de la sala de Matrix debe comenzar con \`!\` y contener un \`:\` (por ejemplo, \`!abc:matrix.org\`). Verifica el ID de la sala e intenta de nuevo.`,
      join_failed_description: `<#{channel_id}> se vinculó a \`{room_id}\`, pero no pude unirme a la sala de Matrix automáticamente. Invita a \`{bot_user_id}\` a la sala manualmente. Si necesitas los pasos de configuración y la lista de limitaciones, abre {help_matrix} y ve a Integraciones > Matrix.`,
      encrypted_room_title: `No se puede vincular una sala cifrada`,
      encrypted_room_description: `\`{room_id}\` tiene el cifrado de extremo a extremo habilitado. El cifrado de Matrix no se puede desactivar una vez configurado, así que esta sala no se puede usar para la conexión. Crea una nueva sala de Matrix **sin** cifrado e invita a \`{bot_user_id}\` en su lugar.`,
      encryption_unknown_title: `No se pudo verificar el cifrado de la sala`,
      encryption_unknown_description: `No pude confirmar que \`{room_id}\` no esté cifrada, así que no la vinculé. Solo retransmito salas que puedo verificar, ya que los mensajes se envían como texto sin formato.

Invita a \`{bot_user_id}\` a la sala, espera a que se una y vuelve a ejecutar este comando. Si el bot ya está en la sala, es posible que el homeserver no esté disponible; vuelve a intentarlo en unos minutos.`,
      matrix_not_configured_title: `El puente de Matrix no está disponible`,
      matrix_not_configured_description: `El puente de Matrix no está configurado en esta instancia del bot. Contacta al propietario del bot para habilitarlo.`,
    },
    unlink: {
      description: `Elimina el vínculo del puente de Matrix de un canal de Discord`,
      channel_description: `El canal de Discord a desvincular de su sala de Matrix`,
      success_title: `Sala de Matrix desvinculada`,
      success_description: `<#{channel_id}> ya no está conectado a ninguna sala de Matrix.`,
      not_linked_title: `No está vinculado`,
      not_linked_description: `<#{channel_id}> no tiene ninguna sala de Matrix vinculada.`,
    },
  },
};
