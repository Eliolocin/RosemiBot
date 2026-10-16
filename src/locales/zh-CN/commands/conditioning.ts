export default {
  conditioning: {
    description: `管理持久化的奖励与惩罚偏好记忆。`,
    shared: {
      reason_line: `原因：\`\`{reason}\`\``,
      reward_footer: `❤️ {bot} 会记住这件事。用 /conditioning 管理。`,
      punish_footer: `💀 {bot} 会记住这件事。用 /conditioning 管理。`,
      persona_access_blocked_title: `没有可用的人格`,
      persona_access_blocked_description: `按你当前的白名单权限和个人聚焦设置，这个频道里没有可用于这次互动的人格。`,
      marker_reward: `❤️`,
      marker_punish: `💀`,
      option_reason_description: `共 {count} 次 • 原因：「{reason}」`,
      option_reason_description_single: `原因：「{reason}」`,
      option_label: `{type_marker} {persona_name} • {action}`,
    },
    manage: {
      description: `管理这个服务器里所有人格记录下来的奖励与惩罚历史。`,
    },
    remove: {
      description: `移除这个服务器里每个人格记录的奖励与惩罚条目。`,
      empty_title: `没有奖励与惩罚记忆`,
      empty_description: `这个服务器里没有可管理的持久化奖励与惩罚条目。`,
      page_select_prompt: `找到 {total} 条奖励与惩罚条目。选择要移除的一批：`,
      page_select_prompt_capped: `找到 {total} 条奖励与惩罚条目。下面显示的是
最近 {shown} 条；移除一部分就能看到后面的。`,
    },
    panel: {
      remove_modal_title: `移除奖励与惩罚`,
      remove_checkbox_label: `奖励与惩罚条目`,
      remove_checkbox_label_continued: `奖励与惩罚条目（续）`,
      remove_checkbox_description: `取消勾选你想移除的奖励与惩罚条目。`,
      stale_heading: `面板已过期`,
      stale_detail: `奖励与惩罚条目已变更。面板已刷新。`,
      no_changes_heading: `没有更改`,
      no_changes_detail: `没有取消勾选任何奖励与惩罚条目。`,
      success_heading: `奖励与惩罚已移除`,
      success_detail: `已移除 {count} 条奖励与惩罚条目。`,
      write_failed_heading: `更新失败`,
      write_failed_detail: `更改无法保存。请重试。`,
    },
  },
};
