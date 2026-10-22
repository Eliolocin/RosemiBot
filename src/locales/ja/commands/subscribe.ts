// locales/ja/commands/subscribe.ts

export default {
  subscribe: {
    conversion_nudge:
      "より安定したサービスを利用するには、`/subscribe`でTomoriBotのサブスクリプションを契約してください。",
    request: {
      title: `サブスクリプションの利用`,
      allowance_title: `利用枠が不足しています`,
      scope: {
        personal: `あなたのサブスクリプション`,
        server: `このサーバーのサブスクリプション`,
      },
      capabilities: {
        text: `テキスト生成`,
        vision: `画像解析`,
        image: `画像生成`,
        video: `動画生成`,
        voice: `音声生成`,
        decision: `Decision`,
        embedding: `埋め込み生成`,
      },
      renewal: `利用枠は{period_end}に更新されます。`,
      renewal_unknown: `次の更新日は{subscription}で確認できます。`,
      allowance_reason: `{scope}の残りの利用枠では、このリクエストを処理できません。{renewal}`,
      capacity_reason: `TomoriBotのサブスクリプションサービスの容量が不足しているため、{scope}ではこのリクエストを処理できませんでした。`,
      fallback_failed: `設定済みの代替モデルでは、このリクエストを完了できませんでした。`,
      exhausted: `{scope}の残りの利用枠では、このリクエストを処理できません。{renewal}{fallback}\n\n契約者は{subscription}から上位プランを選べます。更新を待つ間、{providers}から別のAIプロバイダーを利用することもできます。`,
      retry_at: `{retry_at}に再度お試しください。`,
      retry_later: `数分後に再度お試しください。`,
      capacity: `TomoriBotのサブスクリプションサービスが混み合っているため、{scope}は一時的に利用できません。利用枠は消費されていません。{retry}{fallback}\n\n{providers}から別のAIプロバイダーを利用することもできます。`,
      capacity_unavailable: `TomoriBotのサブスクリプションサービスの容量が不足しているため、{scope}は利用できません。容量が回復するまで再試行しても成功しません。利用枠は消費されていません。{fallback}\n\nその間は{providers}から別のAIプロバイダーを利用できます。`,
      unsupported: `{scope}では、この{capability}モデルを利用できません。{providers}から対応モデルまたは別のAIプロバイダーを選んでください。`,
    },
    tiers: {
      unknown: `サブスクリプション`,
      mochi: `もち`,
      dango: `だんご`,
      taiyaki: `たい焼き`,
    },
    description: `TomoriBotのAI利用のためにPatreonメンバーシップを契約または連携します。`,
    sponsorship: {
      errors: {
        title: `サポータースポンサーを利用できません`,
        billing_unavailable: `この環境ではサポーター請求を利用できません。`,
        unlinked: `あなたのDiscordアカウントは、対象サポーターIDにまだリンクされていません。`,
        inactive: `現在、サポーターメンバーシップはアクティブではありません。`,
        inconsistent: `ローカルのサポーター請求データが不完全なため、データが修復されるまでスポンサーは停止されます。`,
        unconfigured_tier: `あなたのサポーターティアはサーバースポンサー用に設定されていません。`,
        exhausted: `現在のサポーター利用枠はこの期間ですでに使い切られています。`,
        missing_sponsorship: `このサーバーには現在アクティブなサポータースポンサーがありません。`,
        model_not_allowed: `このモデルはサブスクリプションでは利用できません。プロバイダー設定で別のモデルを選んでください。`,
        exhausted_generation: `このサーバーのサポーター利用枠は、今期分を使い切りました。{period_end} 頃に枠が更新されると、サポーター提供のチャットが再開します。スポンサーは /subscribe で状況確認や更新ができます。サーバー管理者は /provider で別のプロバイダーに切り替えできます。`,
      },
    },
    callback: {
      success: {
        title: `Patreonリンクが完了しました`,
        message: `サポーターアカウントをリンクしました。Discordに戻り、セットアップまたはサブスクリプションパネルで「続行」を選択すると最新状態を確認できます。`,
      },
      authorization_denied: {
        title: `Patreonリンクをキャンセルしました`,
        message: `Patreonでリンクが承認されませんでした。再試行する場合はDiscordに戻り、セットアップまたはサブスクリプションパネルで「続行」を選択してください。`,
      },
      missing_code: {
        title: `Patreonリンクに失敗しました`,
        message: `Patreonの応答に認可コードが含まれていませんでした。Discordに戻って /subscribe をもう一度試してください。`,
      },
      invalid_state: {
        title: `Patreonリンクに失敗しました`,
        message: `リンク状態が無効でした。Discordに戻って新しい /subscribe リンクを開始してください。`,
      },
      expired_state: {
        title: `Patreonリンクの期限が切れました`,
        message: `完了前にこのリンクの期限が切れました。Discordに戻って新しい /subscribe リンクを開始してください。`,
      },
      state_replay: {
        title: `Patreonリンクは使用済みです`,
        message: `このリンクはすでに使用されたか、無効になっています。Discordに戻って新しい /subscribe リンクを開始してください。`,
      },
      invalid_payload: {
        title: `Patreonリンクに失敗しました`,
        message: `Patreonから不完全なメンバーシップデータが返されました。後でDiscordに戻って /subscribe をもう一度試してください。`,
      },
      unlinked_membership: {
        title: `対象のPatreonメンバーシップがありません`,
        message: `このPatreonアカウントには対象メンバーシップがリンクされていません。Discordに戻り、セットアップまたはサブスクリプションパネルで「続行」を選択してください。`,
      },
      wrong_campaign: {
        title: `Patreonキャンペーンが違います`,
        message: `このPatreonメンバーシップは設定済みのクリエイターキャンペーンのものではありません。サポーターアクセスは付与されませんでした。`,
      },
      inactive: {
        title: `Patreonメンバーシップが非アクティブです`,
        message: `このPatreonメンバーシップは現在アクティブではないか、対象ティアの権利がありません。サポーターアクセスは付与されませんでした。`,
      },
      unconfigured_tier: {
        title: `Patreonティアが未設定です`,
        message: `このPatreonティアはサポーターアクセス用に設定されていません。サポーターアクセスは付与されませんでした。`,
      },
      patreon_unavailable: {
        title: `Patreonリンクを利用できません`,
        message: `Patreonに接続できないか、無効な応答が返されました。後でもう一度試してください。`,
      },
      server_error: {
        title: `Patreonリンクに失敗しました`,
        message: `TomoriBotはリンクを完了できませんでした。後でもう一度試してください。`,
      },
    },
  },
};
