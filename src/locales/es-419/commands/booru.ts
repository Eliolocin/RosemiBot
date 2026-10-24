export default {
  booru: {
    description: `Encuentra arte anime existente`,
    search: {
      description: `Publica 4 imágenes aleatorias bien valoradas de Danbooru para una o dos etiquetas`,
      tag_description: `Un personaje, serie o etiqueta (aparecen sugerencias mientras escribes)`,
      second_tag_description: `Una segunda etiqueta opcional para filtrar la búsqueda`,
      rating_description: `Qué clasificación mostrar (por defecto: general y sensible)`,
      general_option: `General`,
      sensitive_option: `Sensible`,
      questionable_option: `Cuestionable (solo canales para mayores de edad)`,
      explicit_option: `Explícito (solo canales para mayores de edad)`,
      rating_restricted_title: `Esta clasificación requiere un canal para mayores de edad`,
      rating_restricted_description: `Los resultados cuestionables y explícitos solo se muestran en canales marcados para mayores de edad. Elige General o Sensible, o usa este comando en un canal para mayores de edad.`,
      no_results_title: `No se encontraron publicaciones`,
      no_results_description: `Danbooru no tiene publicaciones bien valoradas para {query}. Revisa la ortografía o prueba con una sola etiqueta.`,
      error_title: `Danbooru no respondió`,
      error_description: `Inténtalo de nuevo en un minuto.`,
    },
  },
};
