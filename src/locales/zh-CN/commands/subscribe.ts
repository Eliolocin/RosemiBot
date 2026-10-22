export default {
  subscribe: {
    request: {
      title: `订阅访问`,
      allowance_title: `配额不足`,
      scope: {
        personal: `你的订阅`,
        server: `此服务器的订阅`,
      },
      capabilities: {
        text: `文本`,
        vision: `图像分析`,
        image: `图像生成`,
        video: `视频生成`,
        voice: `语音生成`,
        decision: `Decision`,
        embedding: `嵌入`,
      },
      renewal: `配额将在{period_end}更新。`,
      renewal_unknown: `请在{subscription}中查看下一次续期时间。`,
      allowance_reason: `{scope}的剩余配额不足以处理此请求。{renewal}`,
      capacity_reason: `由于TomoriBot订阅服务的容量不足，{scope}无法完成此请求。`,
      fallback_failed: `配置的备用模型均无法完成此请求。`,
      exhausted: `{scope}的剩余配额不足以处理此请求。{renewal} {fallback}\n\n订阅者可以通过{subscription}选择更高档位。等待期间，你也可以通过{providers}使用其他AI提供方。`,
      retry_at: `请在{retry_at}重试。`,
      retry_later: `请几分钟后重试。`,
      capacity: `由于TomoriBot的订阅服务负载已满，{scope}暂时不可用。你的配额未受影响。{retry} {fallback}\n\n你也可以通过{providers}使用其他AI提供方。`,
      capacity_unavailable: `由于TomoriBot的订阅服务容量耗尽，{scope}不可用，且在服务恢复前重试无效。你的配额未受影响。{fallback}\n\n在此期间，你可以通过{providers}使用其他AI提供方。`,
      unsupported: `{scope}无法使用此{capability}模型。请选择受支持的模型，或通过{providers}使用其他AI提供方。`,
    },
    tiers: {
      unknown: `订阅`,
      mochi: `Mochi`,
      dango: `Dango`,
      taiyaki: `Taiyaki`,
    },
    description: `订阅或关联你的Patreon会员资格以获取TomoriBot AI访问权限。`,
    sponsorship: {
      errors: {
        title: `赞助者支持不可用`,
        billing_unavailable: `当前环境中不支持赞助者结算。`,
        unlinked: `你的Discord账号尚未关联到符合资格的赞助者身份。`,
        inactive: `你的赞助者会员资格当前未处于有效状态。`,
        inconsistent: `本地赞助者账单数据不完整，赞助功能已暂停直至数据修复。`,
        unconfigured_tier: `你的赞助者等级未配置为支持服务器赞助。`,
        exhausted: `你当前的赞助者配额在此周期内已耗尽。`,
        missing_sponsorship: `此服务器当前没有有效的赞助者支持。`,
        model_not_allowed: `此模型不适用于订阅访问。请在提供方设置中选择其他模型。`,
        exhausted_generation: `此服务器的订阅配额已用完。配额将在{period_end}左右续期。赞助者可以通过/subscribe升级。等待期间你可以使用其他AI提供方：使用/providers管理服务器提供方，或使用/personal providers管理个人提供方。`,
      },
    },
    callback: {
      success: {
        title: `Patreon关联完成`,
        message: `你的赞助者账号已关联。返回Discord并在设置或订阅面板中选择「继续」以查看更新后的状态。`,
      },
      authorization_denied: {
        title: `Patreon关联已取消`,
        message: `Patreon未授权本次关联。如果你想重试，请返回Discord并在设置或订阅面板中选择「继续」。`,
      },
      missing_code: {
        title: `Patreon关联失败`,
        message: `Patreon响应中未包含授权码。请返回Discord并重新尝试/subscribe。`,
      },
      invalid_state: {
        title: `Patreon关联失败`,
        message: `关联状态无效。请返回Discord并重新发起/subscribe关联。`,
      },
      expired_state: {
        title: `Patreon关联已过期`,
        message: `此关联在完成前已过期。请返回Discord并重新发起/subscribe关联。`,
      },
      state_replay: {
        title: `Patreon关联已使用`,
        message: `此链接已被使用或不再有效。请返回Discord并重新发起/subscribe关联。`,
      },
      invalid_payload: {
        title: `Patreon关联失败`,
        message: `Patreon返回的会员数据不完整。请返回Discord并稍后重试/subscribe。`,
      },
      unlinked_membership: {
        title: `没有符合资格的Patreon会员资格`,
        message: `此Patreon账号未关联到符合资格的会员资格。请返回Discord并在设置或订阅面板中选择「继续」。`,
      },
      wrong_campaign: {
        title: `错误的Patreon创作者项目`,
        message: `此Patreon会员资格不属于已配置的创作者项目。未授予赞助者访问权限。`,
      },
      inactive: {
        title: `未生效的Patreon会员资格`,
        message: `此Patreon会员资格当前未处于有效或应享有权益状态。未授予赞助者访问权限。`,
      },
      unconfigured_tier: {
        title: `未配置的Patreon等级`,
        message: `此Patreon等级未配置为支持赞助者访问。未授予赞助者访问权限。`,
      },
      patreon_unavailable: {
        title: `Patreon关联不可用`,
        message: `无法连接到Patreon或收到了无效响应。请返回Discord并稍后重试。`,
      },
      server_error: {
        title: `Patreon关联失败`,
        message: `TomoriBot无法完成关联。请返回Discord并稍后重试。`,
      },
    },
  },
};
