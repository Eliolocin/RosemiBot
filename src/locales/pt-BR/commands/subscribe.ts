export default {
  subscribe: {
    conversion_nudge: "Assine o TomoriBot usando `/subscribe` para um serviço mais confiável.",
    request: {
      title: `Acesso por Assinatura`,
      allowance_title: `Cota insuficiente`,
      scope: {
        personal: `Sua assinatura`,
        server: `A assinatura deste servidor`,
      },
      capabilities: {
        text: `texto`,
        vision: `análise de imagens`,
        image: `geração de imagens`,
        video: `geração de vídeo`,
        voice: `geração de voz`,
        decision: `Decision`,
        embedding: `embedding`,
      },
      renewal: `A cota é renovada em {period_end}.`,
      renewal_unknown: `Verifique {subscription} para a próxima renovação.`,
      allowance_reason: `{scope} não tem cota restante suficiente para esta solicitação. {renewal}`,
      capacity_reason: `{scope} não conseguiu concluir esta solicitação porque o serviço de assinatura do TomoriBot está sem capacidade disponível.`,
      fallback_failed: `Nenhum modelo reserva configurado conseguiu concluir esta solicitação.`,
      exhausted: `{scope} não tem cota restante suficiente para esta solicitação. {renewal} {fallback}\n\nQuem assina pode escolher um plano superior em {subscription}. Você também pode usar outro provedor de IA em {providers} enquanto aguarda.`,
      retry_at: `Tente novamente em {retry_at}.`,
      retry_later: `Tente novamente em alguns minutos.`,
      capacity: `{scope} está temporariamente indisponível porque o serviço de assinatura do TomoriBot atingiu a capacidade máxima. Sua cota não foi afetada. {retry} {fallback}\n\nVocê também pode usar outro provedor de IA em {providers}.`,
      capacity_unavailable: `{scope} está indisponível porque o serviço de assinatura do TomoriBot está sem capacidade, e tentar de novo não adiantará até que seja restaurado. Sua cota não foi afetada. {fallback}\n\nVocê pode usar outro provedor de IA em {providers} enquanto isso.`,
      unsupported: `{scope} não pode usar este modelo de {capability}. Escolha um modelo suportado ou outro provedor de IA em {providers}.`,
    },
    tiers: {
      unknown: `Assinatura`,
      mochi: `Mochi ($7/mês)`,
      dango: `Dango ($12/mês)`,
      taiyaki: `Taiyaki ($20/mês)`,
    },
    description: `Assine ou vincule sua assinatura do Patreon para acesso à IA do TomoriBot.`,
    sponsorship: {
      errors: {
        title: `Patrocínio de Apoiador Indisponível`,
        billing_unavailable: `O faturamento de apoiador não está disponível neste ambiente.`,
        unlinked: `Sua conta do Discord ainda não está vinculada a uma identidade de apoiador elegível.`,
        inactive: `Sua assinatura de apoiador não está ativa no momento.`,
        inconsistent: `Seus dados de faturamento de apoiador estão incompletos localmente, portanto o patrocínio está suspenso até que os dados sejam corrigidos.`,
        unconfigured_tier: `Seu nível de apoiador não está configurado para patrocinar servidores.`,
        exhausted: `Sua cota atual de apoiador foi esgotada para este período.`,
        missing_sponsorship: `Este servidor não possui um patrocínio de apoiador ativo no momento.`,
        model_not_allowed: `Este modelo não está disponível para acesso por assinatura. Escolha outro modelo nas configurações do provedor.`,
        exhausted_generation: `A cota de assinatura deste servidor foi esgotada. Ela será renovada por volta de {period_end}. O patrocinador pode fazer upgrade pelo /subscribe. Você pode usar outro provedor de IA enquanto aguarda: gerencie provedores do servidor com /providers ou provedores pessoais com /personal providers.`,
      },
    },
    callback: {
      success: {
        title: `Vinculação do Patreon concluída`,
        message: `Sua assinatura do Patreon foi vinculada. Retorne ao Discord e selecione Verificar Assinatura no painel de configuração ou assinatura.`,
      },
      authorization_denied: {
        title: `Vinculação do Patreon cancelada`,
        message: `O Patreon não autorizou a vinculação. Retorne ao Discord e selecione Vincular Assinatura do Patreon no painel de configuração ou assinatura para tentar novamente.`,
      },
      missing_code: {
        title: `Falha na vinculação do Patreon`,
        message: `A resposta do Patreon não incluiu um código de autorização. Retorne ao Discord e tente /subscribe novamente.`,
      },
      invalid_state: {
        title: `Falha na vinculação do Patreon`,
        message: `O estado da vinculação era inválido. Retorne ao Discord e inicie uma nova vinculação por /subscribe.`,
      },
      expired_state: {
        title: `Link do Patreon expirado`,
        message: `Este link expirou antes de ser concluído. Retorne ao Discord e inicie uma nova vinculação por /subscribe.`,
      },
      state_replay: {
        title: `Link do Patreon já utilizado`,
        message: `Este link já foi utilizado ou não é mais válido. Retorne ao Discord e inicie uma nova vinculação por /subscribe.`,
      },
      invalid_payload: {
        title: `Falha na vinculação do Patreon`,
        message: `O Patreon retornou dados de assinatura incompletos. Retorne ao Discord e tente /subscribe novamente mais tarde.`,
      },
      unlinked_membership: {
        title: `Nenhuma assinatura elegível do Patreon`,
        message: `Esta conta do Patreon não possui uma assinatura elegível. Escolha uma assinatura no Patreon, depois retorne ao Discord e selecione Verificar Assinatura.`,
      },
      wrong_campaign: {
        title: `Campanha do Patreon incorreta`,
        message: `Esta assinatura do Patreon não pertence à campanha do criador configurada. Nenhum acesso de apoiador foi concedido.`,
      },
      inactive: {
        title: `Assinatura do Patreon inativa`,
        message: `Esta assinatura do Patreon não está ativa ou com direito a acesso no momento. Nenhum acesso de apoiador foi concedido.`,
      },
      unconfigured_tier: {
        title: `Nível do Patreon não configurado`,
        message: `Este nível do Patreon não está configurado para acesso de apoiador. Nenhum acesso de apoiador foi concedido.`,
      },
      patreon_unavailable: {
        title: `Vinculação do Patreon indisponível`,
        message: `Não foi possível alcançar o Patreon ou ele retornou uma resposta inválida. Retorne ao Discord e tente novamente mais tarde.`,
      },
      server_error: {
        title: `Falha na vinculação do Patreon`,
        message: `O TomoriBot não conseguiu concluir a vinculação. Retorne ao Discord e tente novamente mais tarde.`,
      },
    },
  },
};
