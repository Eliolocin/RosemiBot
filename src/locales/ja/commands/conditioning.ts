export default {
  conditioning: {
    description: `ご褒美・おしおきの条件付け記憶を管理します。`,
    shared: {
      reason_line: `理由: \`\`{reason}\`\``,
      reward_footer: `❤️ {bot}はこれを覚えておきます。管理は /conditioning remove を使用してください。`,
      punish_footer: `💀 {bot}はこれを覚えておきます。管理は /conditioning remove を使用してください。`,
      persona_access_blocked_title: `利用できるペルソナがありません`,
      persona_access_blocked_description: `現在のホワイトリスト権限と個人スポットライト設定では、このチャンネルでこの操作に使えるペルソナがありません。`,
      marker_reward: `❤️`,
      marker_punish: `💀`,
      option_reason_description: `合計 {count} 回 • 理由: 「{reason}」`,
      option_reason_description_single: `理由: 「{reason}」`,
      option_label: `{type_marker} {persona_name} • {action}`,
    },
    manage: {
      description: `このサーバー内の全ペルソナに注入対象の条件付け履歴を管理します。`,
    },
    remove: {
      description: `このサーバー内の全ペルソナにわたる条件付けエントリを削除します。`,
      empty_title: `条件付け記憶がありません`,
      empty_description: `このサーバーには管理できる永続的な条件付けエントリがありません。`,
      page_select_prompt: `{total}件の条件付けエントリが見つかりました。削除するバッチを選択してください：`,
      page_select_prompt_capped: `{total}件の条件付けエントリが見つかりました。直近の{shown}件を
以下に表示しています。残りを表示するには、いくつか削除してください。`,
    },
    panel: {
      remove_modal_title: `条件付けを削除`,
      remove_checkbox_label: `条件付けエントリ`,
      remove_checkbox_label_continued: `条件付けエントリ（続き）`,
      remove_checkbox_description: `削除したい条件付けエントリのチェックを外してください。`,
      stale_heading: `パネルが古くなっています`,
      stale_detail: `条件付けエントリが変更されたため、パネルを更新しました。`,
      no_changes_heading: `変更はありません`,
      no_changes_detail: `条件付けエントリのチェックは外されませんでした。`,
      success_heading: `条件付けを削除しました`,
      success_detail: `{count}件の条件付けエントリを削除しました。`,
      write_failed_heading: `更新に失敗しました`,
      write_failed_detail: `変更を保存できませんでした。もう一度お試しください。`,
    },
  },
};
