export default {
  nsfw: {
    description: `年龄限制的指令与设置。`,
    persona: {
      description: `年龄限制的人格指令。`,
      default: {
        description: `应用一套 NSFW 人格预设集`,
      },
      import: {
        description: `从 PNG、JSON 或 CHARX 文件导入人格，包括 NSFW 人格`,
      },
    },
    jailbreaks: {
      description: `管理这个服务器上我的提示词使用的可选越狱行为。`,
      modal_title: `管理越狱策略`,
      checkbox_label: `已启用的越狱策略`,
      checkbox_description: `勾选的策略保持启用。未勾选的策略会被停用。`,
      injection_option: `提示词注入（确认年满 18 岁）`,
      unicode_spaces_option: `Unicode 空格替换`,
      sanitize_option: `敏感词处理`,
      no_changes_title: `没有做任何更改`,
      no_changes_description: `越狱策略勾选列表保持不变。`,
      success_title: `越狱策略已更新`,
      success_description: `已更新你的越狱策略设置。目前启用了 **{enabled_count}** 个选项。`,
    },
  },
};
