export default {
  subscribe: {
    request: {
      title: `訂閱存取`,
      allowance_title: `配額不足`,
      scope: {
        personal: `你的訂閱`,
        server: `此伺服器的訂閱`,
      },
      capabilities: {
        text: `文字`,
        vision: `圖像分析`,
        image: `圖像生成`,
        video: `影片生成`,
        voice: `語音生成`,
        decision: `Decision`,
        embedding: `嵌入`,
      },
      renewal: `配額將於{period_end}續期。`,
      renewal_unknown: `請在{subscription}中查看下次續期時間。`,
      allowance_reason: `{scope}的剩餘配額不足以處理此請求。{renewal}`,
      capacity_reason: `由於TomoriBot訂閱服務的容量不足，{scope}無法完成此請求。`,
      fallback_failed: `設定的備用模型皆無法完成此請求。`,
      exhausted: `{scope}的剩餘配額不足以處理此請求。{renewal} {fallback}\n\n訂閱者可以透過{subscription}選擇更高的方案。等待期間，你也可以透過{providers}使用其他AI供應商。`,
      retry_at: `請於{retry_at}再試。`,
      retry_later: `請幾分鐘後再試。`,
      capacity: `由於TomoriBot的訂閱服務負載已滿，{scope}暫時無法使用。你的配額未受影響。{retry} {fallback}\n\n你也可以透過{providers}使用其他AI供應商。`,
      capacity_unavailable: `由於TomoriBot的訂閱服務容量耗盡，{scope}無法使用，且在服務恢復前重試無效。你的配額未受影響。{fallback}\n\n在此期間，你可以透過{providers}使用其他AI供應商。`,
      unsupported: `{scope}無法使用此{capability}模型。請選擇受支援的模型，或透過{providers}使用其他AI供應商。`,
    },
    tiers: {
      unknown: `訂閱`,
      mochi: `Mochi`,
      dango: `Dango`,
      taiyaki: `Taiyaki`,
    },
    description: `訂閱或連結你的Patreon會員資格以取得TomoriBot AI存取權限。`,
    sponsorship: {
      errors: {
        title: `贊助者支援無法使用`,
        billing_unavailable: `目前環境中不支援贊助者計費。`,
        unlinked: `你的Discord帳號尚未連結到符合資格的贊助者身分。`,
        inactive: `你的贊助者會員資格目前非處於有效狀態。`,
        inconsistent: `本地贊助者帳單資料不完整，贊助功能已暫停直到資料修復。`,
        unconfigured_tier: `你的贊助者方案未設定為支援伺服器贊助。`,
        exhausted: `你目前的贊助者配額在此週期內已用盡。`,
        missing_sponsorship: `此伺服器目前沒有有效的贊助者支援。`,
        model_not_allowed: `此模型不適用於訂閱存取。請在供應商設定中選擇其他模型。`,
        exhausted_generation: `此伺服器的訂閱配額已用完。配額將在{period_end}左右續期。贊助者可以透過/subscribe升級。等待期間你可以使用其他AI供應商：使用/providers管理伺服器供應商，或使用/personal providers管理個人供應商。`,
      },
    },
    callback: {
      success: {
        title: `Patreon連結完成`,
        message: `你的贊助者帳號已連結。返回Discord並在設定或訂閱面板中選擇「繼續」以查看更新後的狀態。`,
      },
      authorization_denied: {
        title: `Patreon連結已取消`,
        message: `Patreon未授權本次連結。如果你想重試，請返回Discord並在設定或訂閱面板中選擇「繼續」。`,
      },
      missing_code: {
        title: `Patreon連結失敗`,
        message: `Patreon回應中未包含授權碼。請返回Discord並重新嘗試/subscribe。`,
      },
      invalid_state: {
        title: `Patreon連結失敗`,
        message: `連結狀態無效。請返回Discord並重新發起/subscribe連結。`,
      },
      expired_state: {
        title: `Patreon連結已過期`,
        message: `此連結在完成前已過期。請返回Discord並重新發起/subscribe連結。`,
      },
      state_replay: {
        title: `Patreon連結已使用`,
        message: `此連結已被使用或已失效。請返回Discord並重新發起/subscribe連結。`,
      },
      invalid_payload: {
        title: `Patreon連結失敗`,
        message: `Patreon傳回的會員資料不完整。請返回Discord並稍後重試/subscribe。`,
      },
      unlinked_membership: {
        title: `沒有符合資格的Patreon會員資格`,
        message: `此Patreon帳號未連結到符合資格的會員資格。請返回Discord並在設定或訂閱面板中選擇「繼續」。`,
      },
      wrong_campaign: {
        title: `錯誤的Patreon創作者專案`,
        message: `此Patreon會員資格不屬於已設定的創作者專案。未授予贊助者存取權限。`,
      },
      inactive: {
        title: `未生效的Patreon會員資格`,
        message: `此Patreon會員資格目前非處於有效或享有權益狀態。未授予贊助者存取權限。`,
      },
      unconfigured_tier: {
        title: `未設定的Patreon方案`,
        message: `此Patreon方案未設定為支援贊助者存取。未授予贊助者存取權限。`,
      },
      patreon_unavailable: {
        title: `Patreon連結無法使用`,
        message: `無法連線至Patreon或收到無效回應。請返回Discord並稍後再試。`,
      },
      server_error: {
        title: `Patreon連結失敗`,
        message: `TomoriBot無法完成連結。請返回Discord並稍後再試。`,
      },
    },
  },
};
