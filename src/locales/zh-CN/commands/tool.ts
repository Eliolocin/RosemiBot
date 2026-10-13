export default {
  tool: {
    description: `处理对话上下文、提示词与诊断的实用操作。`,
    estimate: {
      description: `估算用量与费用`,
      cost: {
        description: `估算付费 AI 提供方的 API 费用`,
        title: `API 费用估算`,
        embed_description: `以下是使用付费 AI 提供方时，Discord 频道里每次触发**非常粗略**的费用估算。费用按 **{provider}** 的示例价格计算（输入：{inputPrice}/百万词元，输出：{outputPrice}/百万词元）`,
        current_context_description: `仅**当前上下文**的费用估算。输入词元由提供方 API 按你当前的设置和最近的频道记录测算，使用 **{provider}** 的 **{model}** 模型。输出词元仍是估算值。所用价格：输入 {inputPrice}/百万，输出 {outputPrice}/百万。`,
        current_context_estimated_description: `仅**当前上下文**的费用估算。**{provider}**（模型 **{model}**）没有实时统计词元的 API，所以输入词元是**按字符数近似**的（约 4 个字符合 1 个词元），依据是你当前的设置和最近的频道记录。准确度会因语言而异，像日语这类信息密度更高的文字，实际词元数会比这个估算值更多。输出词元同样是估算值。所用价格：输入 {inputPrice}/百万，输出 {outputPrice}/百万。`,
        current_input_title: `实测输入词元（当前上下文）`,
        current_input_estimated_title: `估算输入词元（当前上下文）`,
        current_input_value: `**输入：** {inputTokens} 词元
**仅输入费用：** 每次触发约 {inputCost}`,
        current_output_typical_title: `输出估算：典型值`,
        current_output_persona_average_title: `输出估算：人格平均值`,
        current_output_band_value: `**输出估算：** {outputTokens} 词元
**输出估算费用：** 每次触发约 {outputCost}`,
        average_total_cost_title: `每次触发的平均总费用`,
        average_total_cost_value: `**总计估算：** {totalTokens} 词元
每次触发约 {costPerMessage}（每 100 次触发约 {costPer100}）`,
        current_footer: `只有在提供方支持实时统计时，输入词元数才是提供方实测的。输出词元数是估算值。「人格平均值」区间由这个人格的示例对话回复，以及它在这个频道里最近的对话轮次合并而来。两个来源都没有时，会退回典型估算值。`,
        current_estimated_footer: `这个提供方没有实时统计的 API，所以输入词元是按字符数近似的。请把它当成粗略数字，对日语或 JSON 密集的上下文尤其如此。输出词元数同样是估算值。「人格平均值」区间由这个人格的示例对话回复，以及它在这个频道里最近的对话轮次合并而来。两个来源都没有时，会退回典型估算值。`,
        no_cost_provider_description: `当前提供方没有费用`,
        unavailable_description: `当前提供方（**{provider}**）不支持实时费用估算。`,
        fallback_notice_title: `实时统计不可用`,
        fallback_notice_value: `你当前的设置无法使用提供方的实时词元统计，所以这里显示的是粗略的兜底估算值。`,
        minimum_scenario_title: `最低场景（轻度使用）`,
        minimum_scenario_value: `**上下文：** 1 位用户、0 条记忆、1 段人格文本，对话每条消息不到一句话
**词元：** 输入 {inputTokens} + 输出 {outputTokens}`,
        average_scenario_title: `平均场景（中度使用）`,
        average_scenario_value: `**上下文：** 3 位用户、每人 10 条记忆、约 16 段人格文本（含属性与示例对话），对话每条消息 1-2 句话
**词元：** 输入 {inputTokens} + 输出 {outputTokens}`,
        maximum_scenario_title: `最高场景（重度使用）`,
        maximum_scenario_value: `**上下文：** 5 位用户、每人 25 条记忆、约 31 段人格文本（含属性与示例对话），对话每条消息 2 段
**词元：** 输入 {inputTokens} + 输出 {outputTokens}`,
        breakdown_title: `什么会影响费用？`,
        breakdown_value: `**输入词元（发给 AI 的上下文）：**
- 人格段落（含属性与示例对话）
- 服务器记忆与个人记忆
- 已启用的工具（如果有）
- 用户状态与提醒
- 最近的对话记录（提供方支持时含图像、视频、贴纸、表情、嵌入卡片）
- 服务器表情（固定 10 个）

**输出词元（AI 的回复）：**
- 回复长度随问题复杂度变化
- 问题越详细 = 回复越长 = 费用越高

**降低费用的技巧：**
我内置了一些功能，可以减少服务器里滥用者或刷屏者带来的费用，此外还有几个额外建议：
- 少用一些人格段落（属性和示例对话）
- 让记忆保持简短
- 使用免费的 AI 提供方（Google Gemini 免费额度）
- 限制自动触发频道`,
        footer: `像 Google Gemini（免费额度）这样的免费提供方，以及部分 OpenRouter 模型是零费用的！NovelAI 订阅后可以不限次数使用。打开 \`/help\` 里的「设置」，再进入「第 1 步：获取 API 密钥」，可以了解更多。`,
      },
    },
    delete: {
      description: `删除对话轮次或频道里的其他内容。`,
      turn: {
        description: `从频道里删除人格最近的一轮回复。`,
        regenerate_description: `如果为 true，删除后重新触发人格。`,
        select_persona_description: `如果为 true，选择要删除哪个人格的轮次。`,
        no_permission_title: `权限不足`,
        no_permission_description: `这条指令需要管理服务器权限，或必须在指定的角色扮演频道里使用。`,
        already_running_title: `正在删除`,
        already_running_description: `这个频道已经有一次删除在进行中，请稍等。`,
        no_persona_found_title: `没有找到人格轮次`,
        no_persona_found_description: `在最近的记录里没有找到连续的人格消息块。`,
        deleting_title: `⏳ 正在删除轮次`,
        deleting_description: `正在删除 **{persona_name}** 的 {count} 条消息……`,
        success_title: `✅ 轮次已删除`,
        success_description: `已删除 **{persona_name}** 的 {count} 条消息。`,
        success_regenerate_description: `已删除 **{persona_name}** 的 {count} 条消息。正在重新触发……`,
        partial_title: `⚠️ 部分删除`,
        partial_description: `已删除 **{persona_name}** 的 {deleted_count}/{total_count} 条消息，有些消息没能删除。`,
        partial_no_manage_messages_description: `已删除 **{persona_name}** 的 {deleted_count}/{total_count} 条消息。因为我缺少**管理消息**权限，没能全部删除。`,
        bot_no_delete_title: `无法删除消息`,
        bot_no_delete_description: `我在这个频道里没有**管理消息**权限，也没能通过 webhook 兜底删除任何消息。请授予我**管理消息**权限，或确认我的 webhook 可用。`,
        bot_failed_delete_description: `我在尝试删除消息时遇到了意外错误。`,
      },
    },
    prompt: {
      description: `查看 TomoriBot 发给模型的提示词。`,
      snapshot: {
        description: `把某个人格实际的 LLM 提示词导出成文件，用于调试。`,
        persona_description: `要生成快照的人格。默认使用主人格。`,
        format_description: `快照文件的输出格式。`,
        fetch_tools_description: `如果为 true，会在快照末尾附上可用的工具／函数定义（仅 JSON）。`,
        text_option: `文本`,
        json_option: `JSON`,
        no_permission_title: `权限不足`,
        no_permission_description: `你需要**管理服务器**权限，或由服务器所有者通过 \`/moderation\` 为成员开启这项功能。`,
        persona_not_found_title: `未找到人格`,
        persona_not_found_description: `该人格已不在这个服务器上。请从列表里重新选择。`,
        dm_title: `提示词快照`,
        dm_description: `这是人格 **{persona_name}** 的提示词快照（格式：{format}）。`,
        dm_txt_headers_note: `TXT 文件里的 \`=== 标题 (/指令) ===\` 和 \`== 副标题 ==\` 标头是注释，用来说明每一段由哪条配置指令控制。它们**不是**实际发给 LLM 的提示词的一部分。「Untagged」表示这一段可能被自定义 st 预设集重排过，或者本身就是它的一部分`,
        dm_hint_try_json: `用 \`format: JSON\` 再运行一次可以拿到原始格式。`,
        dm_hint_try_text: `用 \`format: Text\` 再运行一次可以拿到更好读的格式。`,
        dm_tools_txt_note: `TXT 格式会省略工具定义，请改用 \`format: JSON\` 加 \`fetch_tools: true\` 重新运行以包含它们。`,
        dm_config_heading: `**采样／请求配置**（与提供方适配器在运行时发送的内容一致）：`,
        dm_truncated_note: `聊天记录超出了模型的上下文预算，因此最早的 {count} 轮对话已被忽略，就像实际生成回复时一样。`,
        dm_failed_title: `无法发送私信`,
        dm_failed_description: `我没能发送私信（DM）。你的快照已改为附在这里。开启「允许服务器成员发送私信」后，以后的快照就能通过私信发送。`,
        success_title: `快照已发送`,
        success_description: `提示词快照已发送到你的私信（DM）。`,
        no_personas_title: `没有找到人格`,
        no_personas_description: `这个服务器里没有找到人格。`,
        build_failed_title: `快照失败`,
        build_failed_description: `提示词快照生成失败，请重试。`,
        guild_only_title: `仅限服务器`,
        guild_only_description: `这条指令只能在服务器频道里使用。`,
        dm_tools_filtering_note: `明确工具模式生效时，JSON 快照里的工具定义会按最近一条可见的轮次过滤。事后生成的快照可能无法完全还原当时临时保留的工具上下文，但不会再像实际那一轮已经限定或抑制工具时那样，把整套工具都倒出来。`,
      },
    },

    visualize: {
      missing_permissions_title: `缺少权限`,
      missing_permissions_description: `我需要有查看这个频道、读取消息记录、发送消息和附加文件的权限，才能在这里生成场景图像。`,
      cooldown_active: `这个服务器的管理员设置了冷却。请等 **{seconds}** 秒，再在**画出当前场景**模式下使用 \`/generate image\`。这条冷却与消息触发和其他手动指令共用。`,
      channel_not_whitelisted: `这个服务器启用了白名单限制。**画出当前场景**模式下的 \`/generate image\` 只能在白名单频道里，由拥有白名单身份组的成员使用，而且只能用这个频道允许的人格。`,
      persona_access_blocked: `按你当前的白名单权限和个人聚焦设置，这个频道里没有可用于**画出当前场景**模式下 \`/generate image\` 的人格。`,
      no_backend_title: `没有可用的图像后端`,
      no_backend_description: `我现在找不到这个服务器能用的图像后端。请给 **{current_provider}** 配一个有效的图像模型，或者想用 NovelAI 渲染器的话，添加一个 NovelAI 可选密钥。`,
      planner_unavailable_title: `没有可用的规划模型`,
      planner_unavailable_description: `当前提供方里我找不到支持结构化输出的模型，所以现在没法规划场景图像。`,
      planner_failed_title: `场景规划失败`,
      planner_failed_description: `我没能把最近的频道上下文变成图像方案：{error}`,
      success_title: `场景图像已发布`,
      success_description: `我根据最近的频道上下文规划了画面，并把图像发到了这个频道。`,
      modal: {
        title: `场景图像生成`,
        prompt_label: `额外要求（可选）`,
        prompt_description: `写下你希望场景规划器遵守的修正、氛围或细节`,
        prompt_placeholder: `例如：突出雨景、柔和一点、把两个角色都清楚地画出来`,
        setting_label: `画面预设集`,
        setting_description: `为这张一次成型的场景图像选择构图／风格预设集`,
        setting_storybeat_label: `剧情片段`,
        setting_storybeat_description: `眼前场景的宽幅电影感构图`,
        setting_character_label: `角色特写`,
        setting_character_description: `围绕主角或说话者的更近构图`,
        setting_snapshot_label: `方形快照`,
        setting_snapshot_description: `适合当下时刻的均衡方形构图`,
        setting_vertical_label: `手机壁纸`,
        setting_vertical_description: `更高的纵向构图，剪影更突出`,
        backend_label: `图像后端`,
        backend_description: `选择由哪个渲染器生成场景图像`,
        backend_current_label: `当前提供方`,
        backend_current_description: `使用 {provider} 常规的图像生成流程和提示词风格`,
        backend_novelai_label: `NovelAI`,
        backend_novelai_description: `把场景转换成 NovelAI 风格的标签，并使用 NovelAI 图像工具`,
        persona_label: `发送人格`,
        persona_description: `选择由哪个人格发布生成的图像`,
      },
    },
  },
};
