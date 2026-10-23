// locales/en-US/commands/subscribe.ts

export default {
  subscribe: {
    conversion_nudge: "Subscribe to TomoriBot using `/subscribe` for more reliable service.",
    request: {
      title: `Subscription Access`,
      allowance_title: `Not Enough Allowance`,
      minimum_balance_title: `Model Balance Requirement`,
      minimum_balance: `This model requires at least $\{minimum_balance} of allowance remaining before it can generate an image or video. This is a provider requirement, not the generation price. Choose another model in {config} to use your remaining allowance. {fallback}`,
      minimum_balance_reason: `This model requires at least $\{minimum_balance} of allowance remaining for image or video generation. Choose another model in {config} to use your remaining allowance.`,
      scope: {
        personal: `Your subscription`,
        server: `This server's subscription`,
      },
      capabilities: {
        text: `text`,
        vision: `image analysis`,
        image: `image generation`,
        video: `video generation`,
        voice: `voice generation`,
        decision: `Decision`,
        embedding: `embedding`,
      },
      renewal: `The allowance renews {period_end}.`,
      renewal_unknown: `Check {subscription} for the next renewal.`,
      allowance_reason: `{scope} does not have enough allowance remaining for this request. {renewal}`,
      capacity_reason: `{scope} could not complete this request because TomoriBot's subscription service is at capacity.`,
      fallback_failed: `No configured fallback could complete this request.`,
      exhausted: `{scope} does not have enough allowance remaining for this request. {renewal} {fallback}\n\nThe subscriber can choose a higher tier through {subscription}. You can also use another AI provider through {providers} while waiting.`,
      retry_at: `Try again {retry_at}.`,
      retry_later: `Try again in a few minutes.`,
      capacity: `{scope} is temporarily unavailable because TomoriBot's subscription service is at capacity. Your allowance is unaffected. {retry} {fallback}\n\nYou can also use another AI provider through {providers}.`,
      capacity_unavailable: `{scope} is unavailable because TomoriBot's subscription service is out of capacity, and retrying will not help until it is restored. Your allowance is unaffected. {fallback}\n\nYou can use another AI provider through {providers} in the meantime.`,
      unsupported: `{scope} cannot use this {capability} model. Choose a supported model or another AI provider through {providers}.`,
    },
    tiers: {
      unknown: `Subscription`,
      mochi: `Mochi ($7/month)`,
      dango: `Dango ($12/month)`,
      taiyaki: `Taiyaki ($20/month)`,
    },
    description: `Subscribe or link your Patreon membership for TomoriBot AI access.`,
    sponsorship: {
      errors: {
        title: `Supporter Sponsorship Unavailable`,
        billing_unavailable: `Supporter billing is not available in this environment.`,
        unlinked: `Your Discord account is not linked to an eligible supporter identity yet.`,
        inactive: `Your supporter membership is not active right now.`,
        inconsistent: `Your supporter billing data is incomplete locally, so sponsorship is closed until the data is repaired.`,
        unconfigured_tier: `Your supporter tier is not configured for server sponsorship.`,
        exhausted: `Your current supporter allowance is exhausted for this period.`,
        missing_sponsorship: `This server does not have an active supporter sponsorship right now.`,
        model_not_allowed: `This model is unavailable for subscription access. Choose another model in your provider settings.`,
        exhausted_generation: `This server's subscription allowance is used up. It renews around {period_end}. The sponsor can upgrade through /subscribe. You can use another AI provider while waiting: manage server providers with /providers or personal providers with /personal providers.`,
      },
    },
    callback: {
      success: {
        title: `Patreon link complete`,
        message: `Your Patreon membership was linked. Return to Discord and choose Verify Membership in your setup or subscription panel.`,
      },
      authorization_denied: {
        title: `Patreon link cancelled`,
        message: `Patreon did not authorize the link. Return to Discord and choose Link Patreon Membership in your setup or subscription panel to try again.`,
      },
      missing_code: {
        title: `Patreon link failed`,
        message: `The Patreon response did not include an authorization code. Return to Discord and try /subscribe again.`,
      },
      invalid_state: {
        title: `Patreon link failed`,
        message: `The link state was invalid. Return to Discord and start a fresh /subscribe link.`,
      },
      expired_state: {
        title: `Patreon link expired`,
        message: `This link expired before it was completed. Return to Discord and start a fresh /subscribe link.`,
      },
      state_replay: {
        title: `Patreon link already used`,
        message: `This link was already used or is no longer valid. Return to Discord and start a fresh /subscribe link.`,
      },
      invalid_payload: {
        title: `Patreon link failed`,
        message: `Patreon returned incomplete membership data. Return to Discord and try /subscribe again later.`,
      },
      unlinked_membership: {
        title: `No eligible Patreon membership`,
        message: `This Patreon account does not have an eligible membership. Choose a membership on Patreon, then return to Discord and choose Verify Membership.`,
      },
      wrong_campaign: {
        title: `Wrong Patreon campaign`,
        message: `This Patreon membership is not for the configured creator campaign. No supporter access was granted.`,
      },
      inactive: {
        title: `Inactive Patreon membership`,
        message: `This Patreon membership is not currently active or entitled. No supporter access was granted.`,
      },
      unconfigured_tier: {
        title: `Patreon tier not configured`,
        message: `This Patreon tier is not configured for supporter access. No supporter access was granted.`,
      },
      patreon_unavailable: {
        title: `Patreon link unavailable`,
        message: `Patreon could not be reached or returned an invalid response. Return to Discord and try again later.`,
      },
      server_error: {
        title: `Patreon link failed`,
        message: `TomoriBot could not finish the link. Return to Discord and try again later.`,
      },
    },
  },
};
