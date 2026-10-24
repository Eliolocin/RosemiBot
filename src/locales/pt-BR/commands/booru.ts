export default {
  booru: {
    description: `Encontrar arte de anime existente`,
    search: {
      description: `Enviar 4 imagens aleatórias bem avaliadas do Danbooru para uma ou duas tags`,
      tag_description: `Um personagem, série ou tag (sugestões aparecem enquanto você digita)`,
      second_tag_description: `Uma segunda tag opcional para filtrar a busca`,
      rating_description: `Qual classificação exibir (padrão: livre e sensível)`,
      general_option: `Livre (General)`,
      sensitive_option: `Sensível (Sensitive)`,
      questionable_option: `Questionável (apenas canais com restrição de idade)`,
      explicit_option: `Explícito (apenas canais com restrição de idade)`,
      rating_restricted_title: `Esta classificação requer um canal com restrição de idade`,
      rating_restricted_description: `Resultados questionáveis e explícitos só aparecem em canais com restrição de idade. Escolha Livre ou Sensível, ou use este comando em um canal com restrição de idade.`,
      no_results_title: `Nenhuma postagem encontrada`,
      no_results_description: `O Danbooru não encontrou postagens bem avaliadas para {query}. Verifique a ortografia ou tente usar apenas uma tag.`,
      error_title: `O Danbooru não respondeu`,
      error_description: `Tente novamente em um minuto.`,
    },
  },
};
