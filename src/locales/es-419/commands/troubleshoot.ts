export default {
  troubleshoot: {
    description: "Obtén ayuda con algo que hizo TomoriBot.",
    chat: {
      description: "Crea un archivo privado sobre un problema reciente en el chat.",
      message_description: "Enlace opcional a tu mensaje o a la respuesta de TomoriBot en este canal.",
      minutes_description: "Hace cuántos minutos ocurrió el problema aproximadamente (1-60).",
      invalid_request_title: "🔴 Solicitud no válida",
      choose_one: "Usa solo un enlace de mensaje o los minutos transcurridos.",
      invalid_minutes: "Elige un número de minutos del 1 al 60.",
      invalid_link: "Usa un enlace a un mensaje de Discord de este canal.",
      no_recent_chat_title: "🟡 Sin detalles de chat recientes",
      no_recent_chat:
        "No pude encontrar detalles de chat recientes para ninguno de tus mensajes aquí. Inténtalo justo después de que ocurra el problema o usa el enlace a un mensaje de la última hora.",
      dm_title: "Archivo de solución de problemas del chat",
      dm_description:
        "Aquí tienes tu archivo de solución de problemas del chat. Contiene marcas de tiempo y recuentos de eventos, sin texto del chat ni IDs directos de usuarios o mensajes, así que puedes compartirlo al pedir ayuda.",
      success_title: "🟢 Archivo de solución de problemas listo",
      dm_sent: "Te envié el archivo de solución de problemas por MD.",
      dm_fallback: "No pude enviarte un MD, así que adjunté el archivo de solución de problemas aquí de forma privada.",
    },
  },
};
