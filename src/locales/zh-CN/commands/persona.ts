export default {
  persona: {
    description: `管理人格预设集`,
    "image-tags": {
      modal_title: `人格图像标签`,
      tags_input_label: `外貌标签`,
      tags_input_description: `描述这个人格外貌的标签，用逗号分隔，写法与图库网站一致。留空即可清除。`,
      tags_input_placeholder: `白色短发, 红色眼睛, 校服`,
      no_tags_title: `没有提供标签`,
      no_tags_description: `请至少提供一个外貌标签。`,
      too_many_tags_title: `标签太多`,
      too_many_tags_description: `每个人格最多可以设置 {max_tags} 个图像标签。`,
      tag_too_long_title: `标签太长`,
      tag_too_long_description: `每个图像标签不能超过 {max_length} 个字符。`,
      success_title: `外貌已更新`,
      success_description: `已更新 **{persona_name}** 的外貌标签：
\`\`\`
{tag_list}
\`\`\``,
      cleared_title: `外貌已清除`,
      cleared_description: `已清除 **{persona_name}** 的外貌标签。`,
    },
    sprites: {
      add: {
        sprite_name_label: `立绘名称`,
        sprite_name_description: `这张立绘的标签。重复使用同一个标签会替换对应的立绘。`,
        sprite_name_placeholder: `生气`,
        image_label: `立绘图像`,
        image_description: `上传 PNG、JPG 或 GIF，我会把它转换成 PNG。`,
        instructions_label: `使用说明`,
        instructions_description: `可选，说明什么时候该用这张立绘。`,
        instructions_placeholder: `生气、烦躁或明显不高兴时使用。`,
        identity_label: `保存为身份`,
        identity_description: `在 Discord 上显示带装饰的「立绘（人格）」名称，适合副人格身份。关闭 = 普通。`,
      },
      edit: {
        image_description: `可选。上传 PNG、JPG 或 GIF 来替换立绘图像。`,
        identity_status_on: `身份`,
        identity_status_off: `普通立绘`,
      },
      import: {
        archive_label: `立绘压缩包`,
        archive_description: `上传由 /persona sprites export 生成的 .zip 文件。`,
      },
    },
    attribute: {
      description: `管理人员属性。`,
      add: {
        description: `为某个人格添加一条属性。`,
      },
      remove: {
        description: `从某个人格移除一条属性。`,
      },
    },
    prompt: {
      description: `管理人员提示词指令。`,
      set: {
        description: `设置一条人格提示词。`,
      },
      remove: {
        description: `移除一条人格提示词。`,
      },
    },
    "sample-dialogue": {
      description: `添加一组用户与 bot 的示例对话，作为我该如何回复的参考。`,
      add: {
        description: `添加一组用户与 bot 的示例对话，作为我该如何回复的参考。`,
      },
      remove: {
        description: `从我的记忆里移除一组用户与 bot 的示例对话。`,
      },
    },
    name_conflict_title: `🔴 人格名称冲突`,
    name_conflict_description: `这个服务器上已经有一个叫 **{name}** 的人格了。同一个服务器内人格名称不能重复。`,
    export: {
      description: `把当前人格导出成可分享的 PNG 文件`,
      export_json_select_label: `导出 JSON`,
      export_json_select_description: `可选：改而导出可导入的 JSON 文件（不含头像图片）`,
      persona_modal_title: `选择人格`,
      persona_select_label: `人格`,
      persona_select_description: `选择要导出哪个人格。`,
      persona_select_placeholder: `选择人格…`,
      main_persona_description: `主人格`,
      alter_persona_description: `副人格`,
      success_title: `🟢 人格导出成功`,
      success_description: `当前人格 **{nickname}** 已导出！把这张 PNG 文件分享给别人，就能传播这份人格配置。`,
      success_description_json: `当前人格 **{nickname}** 已导出为 JSON 文件。

**注意：** 这份 JSON 可以用 \`/persona import\` 重新导入，但不包含头像图片。想把头像一起分享，请用 PNG 导出。`,
      json_importable_note: `这份 JSON 导出可以用 /persona import 导入。它不包含头像图片；想把头像一起分享，请用 PNG 导出。`,
      failed_title: `🔴 导出失败`,
      avatar_failed_title: `🔴 头像下载失败`,
      avatar_failed_description: `人格头像下载失败，请稍后再试。`,
      embed_failed_title: `🔴 PNG 处理失败`,
      embed_failed_description: `无法把元数据写入 PNG 文件，请重试。`,
      error_no_server_data: `数据库里找不到这个服务器。请先运行 /setup。`,
      error_no_preset_data: `找不到人格数据。请先运行 /setup。`,
      error_validation_failed: `导出数据结构校验失败`,
      error_export_failed: `人格数据导出失败`,
    },
    import: {
      description: `从 PNG、JSON 或 CHARX 文件导入人格`,
      file_description: `包含人格数据的 PNG、JSON 或 CHARX 文件`,
      type_description: `导入为主人格或副人格`,
      triggers_description: `可选的额外触发词，用逗号分隔（"," 或 "、"）`,
      memories_description: `要保留这个人格的用户与服务器记忆吗？`,
      memories_choice_preserve: `保留，保留用户／服务器记忆`,
      memories_choice_fork: `不保留，用户／服务器记忆从头开始`,
      type_choice_main: `主人格（替换当前人格）`,
      type_choice_alter: `副人格`,
      success_title: `🟢 人格导入成功`,
      success_description: `已成功导入人格 **{nickname}**！
属性：{attribute_count}
示例对话：{dialogue_count}
触发词：{trigger_word_count}`,
      success_confirmation: `已成功导入主人格 **{nickname}**！详细的导入信息已发到频道里。`,
      post_missing_permission: `人格已导入，但我无法发布确认消息。请让管理员授予我此频道的 {permission} 权限。`,
      nickname_update_success: `服务器昵称已更新。`,
      nickname_update_failed: `🟡 服务器昵称没能更新，多半是碰到了 Discord 速率限制。请手动修改。`,
      avatar_update_success: `服务器头像已更新。`,
      avatar_update_skipped_no_image: `🟡 导入的文件里没有头像图片，所以保留主人格当前的头像。`,
      avatar_update_rate_limited: `🟡 服务器头像因为 Discord 速率限制没有更新。请手动修改。`,
      avatar_update_failed: `🟡 服务器头像没能更新，多半是碰到了 Discord 速率限制。请手动修改。`,
      alter_success_title: `🟢 副人格导入成功`,
      alter_success_description: `已成功导入副人格 **{nickname}**！
专属触发词：{trigger_count}
触发词：{triggers}

消息里出现这些触发词时，这个人格会回复。`,
      alter_success_confirmation: `已成功导入副人格 **{nickname}**，共有 {trigger_count} 个专属触发词！详细的导入信息已发到频道里。`,
      alter_avatar_fallback_main: `🟡 这次导入没有头像图片，所以这个副人格暂时使用 **{nickname}** 当前主人格的头像。你可以到 \`/config\` > 人格 > 常规 里更换。`,
      alter_avatar_warning: `⚠️ 请不要删除上面的头像图片嵌入，否则副人格头像会丢失。`,
      alter_dm_not_allowed_title: `🔴 私信里不能用副人格`,
      alter_dm_not_allowed_description: `副人格只能在服务器里导入，不能私信（DM）里导入。请在服务器里运行这条指令。`,
      alter_no_triggers_warning: `⚠️ 这个人格没有触发词。在你用 \`/config\` > 人格 > 常规 添加触发词之前，它不会回复任何消息。`,
      alter_name_conflict_title: `🔴 人格名称已存在`,
      alter_name_conflict_description: `这个服务器上已经有一个叫 **{name}** 的人格了。每个人格的名称都必须是唯一的。

请修改导入文件里的名称，或者用 \`/persona remove\` 移除已有的人格。`,
      alter_limit_title: `🔴 已达人格上限`,
      alter_limit_description: `这个服务器已经有 {current} 个人格了，最多允许 {max} 个。请先用 \`/persona remove\` 移除一个副人格再导入。`,
      failed_title: `🔴 导入失败`,
      failed_description: `人格导入失败。请检查文件后重试。`,
      sprite_snapshot_failed_description: `因为读不到当前人格的立绘，导入已取消。人格数据没有任何改动，请重试。`,
      sprite_cleanup_failed_description: `人格已经导入，但旧的立绘记录没能清除，这次导入不完整。请重试或联系管理员。`,
      sprite_storage_cleanup_partial_description: `人格已经导入，但有 {failed_count} 张旧立绘图片没能从存储里删除。`,
      invalid_file_type_title: `🔴 文件类型无效`,
      invalid_file_type_description: `请上传包含人格数据的 .png、.json 或 .charx 文件。`,
      file_too_large_title: `🔴 文件太大`,
      file_too_large_description: `文件太大了。最大文件大小为 {max_size}MB。`,
      download_failed_title: `🔴 下载失败`,
      download_failed_description: `附件下载失败，请重试。`,
      invalid_charx_title: `🔴 角色卡压缩包无效`,
      invalid_charx_description: `这个 .charx 文件无法作为 Character Card V3 压缩包读取。请到托管这张卡的网站重新下载，或改而把卡导出成 .png。`,
      card_conversion_failed_title: `🟡 检测到角色卡，但转换失败`,
      card_conversion_failed_description: `已从 **{source}** 解码出一张卡，但转换成 Tomori 格式失败了。解码出的内容已附在下面供检查。请通过 \`/support discord\` 反馈，并附上这个文件。`,
      charx_not_card_description: `这个 .charx 压缩包能打开，但里面的卡不是角色卡。请确认文件本身就是角色卡，而不是同一次下载里的另一个压缩包。`,
      charx_too_large_description: `这个压缩包里的卡太大，无法导入。卡的最大大小为 {max_size}MB。`,
      charx_assets_too_large_description: `这张卡打包的媒体文件多到导入时无法检查。请改用不含图片、音频或视频素材的卡。`,
      charx_assets_ignored_description: `🟡 这张卡打包的图片、声音和其他媒体没有导入，只读取了人格文本。你可以用 \`/server avatar\` 设置头像，再到 \`/config\` > 人格 > 立绘 里添加立绘。`,
      invalid_png_title: `🔴 PNG 文件无效`,
      invalid_png_description: `上传的文件不是有效的 PNG 图像。`,
      no_metadata_title: `🔴 没有找到人格数据`,
      no_metadata_description: `这个文件里没有受支持的人格数据。请使用由 \`/persona export\` 导出的文件，或受支持的 SillyTavern 角色卡。`,
      invalid_file_title: `🔴 人格文件无效`,
      invalid_file_description: `人格文件格式无效或不兼容。`,
      no_permission_title: `🔴 权限不足`,
      no_permission_description: `导入人格需要**管理服务器**权限。`,
      error_download_timeout: `文件下载超时，请重试。`,
      error_invalid_attribute: `属性内容无效：{details}`,
      error_attribute_flags_mismatch: `属性可见性标记的数量必须与属性列表长度一致。`,
      error_invalid_dialogue_in: `示例对话（用户消息）无效：{details}`,
      error_invalid_dialogue_out: `示例对话（人格回复）无效：{details}`,
      error_invalid_trigger_word: `触发词无效：{details}`,
      error_dialogue_mismatch: `示例对话数组长度不一致`,
      error_invalid_config: `人格数据里的配置字段无效`,
      error_no_server_data: `数据库里找不到这个服务器。请先运行 \`/setup\`。`,
      error_name_conflict: `这个服务器上已经有一个叫 **{name}** 的人格了。请换一个名称。`,
      error_nsfw_persona: `这个人格被标记为 NSFW，所以 \`/persona import\` 无法加载它。请改用 \`/nsfw persona import\`。`,
      error_import_failed: `人格数据导入失败`,
      error_not_json: `导入的文件必须包含有效的 JSON 数据`,
      error_incompatible_version: `预设集版本不兼容。应为 {expected}，实际为 {actual}`,
      error_invalid_format: `人格文件格式无效`,
      error_invalid_type: `人格类型无效：{type}。应为 "preset"`,
      avatar_update_skipped_dm: `人格已成功导入，只是私信（DM）里无法更新头像和昵称`,
      refresh_reminder: `运行 \`/refresh\` 让这次人格更新在这个聊天里生效`,
    },
    remove: {
      description: `从服务器移除一个副人格`,
      no_permission_title: `🔴 权限不足`,
      no_permission_description: `移除副人格需要**管理服务器**权限。`,
      modal_title: `移除副人格`,
      select_label: `副人格`,
      select_placeholder: `选择要移除的副人格…`,
      no_alters_error_title: `🟡 没有副人格`,
      no_alters_error_description: `没有可移除的副人格。请用 \`/persona import type:alter\` 导入副人格。`,
      success_title: `🟢 副人格已移除`,
      success_description: `已成功移除副人格 **{nickname}**。`,
    },
    default: {
      description: `应用一套人格预设集`,
      type_description: `应用到主人格／默认人格，或创建为副人格`,
      type_choice_default: `主人格（替换当前人格）`,
      type_choice_alter: `副人格`,
      no_permission_title: `🔴 权限不足`,
      no_permission_description: `应用人格预设集需要**管理服务器**权限。`,
      modal_title: `应用人格预设集`,
      select_label: `人格预设集`,
      select_description: `选择要应用的预设集。这会覆盖当前的属性和示例对话。`,
      select_placeholder: `选择预设集…`,
      no_presets_title: `没有可用的预设集`,
      no_presets_description: `你的语言还没有可用的人格预设集。请通过 \`/support discord\` 反馈。`,
      preset_not_found: `找不到所选的预设集。`,
      success_title: `预设集已应用`,
      success_details_description: `已成功把预设集 **{preset_name}** 应用到人格 **{nickname}**！
属性：{attribute_count}
示例对话：{dialogue_count}
触发词（{trigger_word_count}）：{triggers}`,
      success_confirmation: `预设集已应用到 **{nickname}**。详细信息已发到这个频道里。`,
      avatar_update_failed: `🟡️ 因为 Discord API 出错，服务器头像没能更新，但人格已成功应用。`,
      avatar_update_skipped_dm: `预设集已成功应用，只是私信（DM）里无法更新头像`,
    },
    import_now: {
      button: `立即导入`,
      imported: `已导入`,
      already_imported_title: `🟡 已经导入过`,
      already_imported_description: `这个人格已经导入过了，或者正有一次导入在进行中。`,
    },
    generate: {
      description: `用 AI 生成人格（需要兼容的提供方）`,
      modal: {
        title: `生成 AI 人格`,
        character_name_label: `角色名称`,
        character_name_description: `名称用逗号分隔（"," 或 "、"）：全部都会成为触发词，第一个作为显示名称。`,
        character_name_placeholder: `例如：初音未来, Miku, 初音ミク`,
        character_info_label: `角色信息与说话示例`,
        character_info_description: `描述这个角色以及她说话的方式`,
        character_info_placeholder: `性格、背景故事、说话风格、例句等`,
        web_search_label: `要搜索网络吗？`,
        web_search_description: `搜索角色的相关信息（适合已有的作品角色）`,
        web_search_placeholder: `选择「是」或「否」`,
        web_search_yes: `是，搜索角色信息`,
        web_search_no: `否，创作原创角色`,
        additional_inst_label: `附加指令`,
        additional_inst_placeholder: `可选：其他要求（例如「请让角色的回复短一些」）`,
        file_upload_label: `角色图片／角色卡（可选）`,
        file_upload_description: `上传图片、Tomori 预设集或 SillyTavern 角色卡 PNG，用来生成或改造角色`,
      },
      field_character_name: `角色名称`,
      field_character_info: `角色信息与说话示例`,
      field_web_search: `要搜索网络吗？`,
      field_additional_inst: `附加指令`,
      wrong_provider_title: `🔴 提供方不兼容`,
      wrong_provider_description: `生成预设集需要兼容的提供方。你当前的提供方是 **{current_provider}**。请到 \`/config\` > 模型 > 切换模型 换成受支持的提供方。`,
      no_api_key_title: `🔴 没有 API 密钥`,
      no_api_key_description: `还没有配置可用的提供方。请用 \`/setup\`（首次）或 \`/providers\` 注册一个。`,
      model_incompatible_title: `模型不兼容`,
      model_incompatible_description: `你当前的模型（**{model_name}**）不支持 **STRUCTURED OUTPUT**，而生成人格需要这项能力。

**接下来可以这样做：**
到 \`/config\` > 模型 > 切换模型，换成支持结构化输出的模型（例如带 "STRUCT" 能力的模型）。`,
      image_vision_required_title: `🔴 需要图像视觉能力`,
      image_vision_required_description: `你上传了图片，但你当前的模型（**{model_name}**）不支持 **IMAGE VISION**，而且没有配置视觉模型。

**接下来可以这样做：**
1. 到 \`/config\` > 模型 > 切换模型，指定一个专用的视觉模型，或者
2. 到 \`/config\` > 模型 > 切换模型，换成一个支持视觉的模型，或者
3. 去掉图片，重新生成`,
      web_search_tools_required_title: `🔴 网络搜索不可用`,
      web_search_tools_required_description: `你选择了网络搜索，但当前模型（**{model_name}**）不支持 **TOOLS**。

**接下来可以这样做：**
1. 到 \`/config\` > 模型 > 切换模型，换成支持工具的模型，或者
2. 去掉网络搜索重新生成（被问到时选「否」）`,
      api_key_decrypt_failed_title: `🔴 API 密钥错误`,
      api_key_decrypt_failed_description: `无法解密当前提供方的凭据。请用 \`/providers\` 重新配置。`,
      vision_credentials_unavailable_title: `🔴 视觉模型的凭据不可用`,
      vision_credentials_unavailable_description: `你的视觉模型（**{vision_model_name}**）运行在提供方 **{vision_provider}** 上，但无法用它的 API 密钥描述图片。请用 \`/providers\` 重新配置那个提供方的凭据，或到 \`/config\` > 模型 检查一下。`,
      invalid_image_title: `🔴 图像无效`,
      invalid_image_description: `请上传有效的图像文件（PNG、JPG、JPEG 等）。`,
      error_file_too_large: `头像图片不能超过 {max_size}MB。`,
      error_download_timeout: `头像下载超时，请重试。`,
      error_download_failed: `头像图片下载失败。`,
      processing_title: `正在生成人格……`,
      processing_description: `这可能需要 1-2 分钟。请稍等，我正在生成角色……

结果可能不符合预期，需要的话可以重新生成。`,
      captioning_title: `正在描述你的头像...`,
      captioning_description: `你的主模型无法识别图片，所以我会先请视觉模型（**{model_name}**）描述你上传的头像。然后主模型会根据这段描述来生成人格。这可能需要 1-2 分钟。`,
      generation_failed_title: `🔴 生成失败`,
      generation_failed_description: `人格生成失败：{error}

请换个输入重试，或检查你的 API 密钥。`,
      vision_caption_failed_title: `🔴 头像描述失败`,
      vision_caption_failed_description: `你的视觉模型（**{vision_model_name}**，{vision_provider}）无法描述上传的头像。

**后续步骤：**
1. 用 \`/providers\` 检查那个提供方的 API 密钥，或
2. 去掉图片后重新生成，或
3. 在 \`/config\` > 模型 中换一个视觉模型`,
      validation_failed_title: `🔴 校验失败`,
      validation_failed_description: `生成的人格数据没有通过校验，请重试。`,
      image_processing_failed_title: `🔴 图像处理失败`,
      image_processing_failed_description: `上传的图片处理失败。请换一张图片试试。`,
      avatar_fetch_failed_title: `🔴 头像获取失败`,
      avatar_fetch_failed_description: `获取服务器头像用于导出时失败。请改而上传一张图片。`,
      metadata_embed_failed_title: `🔴 导出失败`,
      metadata_embed_failed_description: `无法把人格数据写入图片，请重试。`,
      success_title: `🟢 {character_name} 生成成功！`,
      success_description: `我已经为 **{character_name}** 生成好人格了！
**属性预览：**
{attribute_preview}
**示例对话：**
{dialogue_preview}`,
      success_next_steps_title: `下一步`,
      success_next_steps_description: `1. 在右边下载附加的 PNG 文件
2. 用 \`/persona import\` 导入这个 PNG
或者按下「导入」按钮`,
      success_next_steps_description_dm: `1. 下载附加的 PNG 文件
2. 用 \`/persona import\` 导入这个 PNG
3. 运行 \`/refresh\` 让我用上新人格`,
      success_next_steps_footer: `之后你可以在 \`/config\` 中进一步自定义我。`,
      avatar_update_skipped_dm: `请注意，私信（DM）里无法导入头像和昵称的更新。`,
    },
    create: {
      description: `手动创建一个简单的人格预设集`,
      modal: {
        title: `创建新人格`,
        character_name_label: `角色名称`,
        character_name_description: `名称用逗号分隔（"," 或 "、"）：全部都会成为触发词，第一个作为显示名称。`,
        character_name_placeholder: `例如：初音未来, Miku, 初音ミク`,
        character_desc_label: `角色描述`,
        character_desc_placeholder: `描述你的角色（性格、外貌、背景故事等）`,
        example_user_label: `示例用户消息`,
        example_user_description: `提示：之后可以用 /persona sample-dialogue add 添加更多`,
        example_user_placeholder: `你好，{bot}！`,
        example_bot_label: `示例人格回复`,
        example_bot_placeholder: `你好，{user}！最近过得怎么样？`,
        file_upload_label: `角色图片（可选）`,
        file_upload_description: `上传一张图片用于角色导出`,
      },
      field_character_name: `角色名称`,
      field_character_desc: `角色描述`,
      field_example_user: `示例用户消息`,
      field_example_bot: `示例人格回复`,
      invalid_image_title: `🔴 图像无效`,
      invalid_image_description: `请上传有效的图像文件（PNG、JPG、JPEG 等）。`,
      error_file_too_large: `头像图片不能超过 {max_size}MB。`,
      error_download_timeout: `头像下载超时，请重试。`,
      error_download_failed: `头像图片下载失败。`,
      desc_too_long_title: `描述太长`,
      desc_too_long_description: `角色描述太长了（{current_length} 个字符），最多允许 {max_allowed} 个字符。`,
      example_user_too_long_title: `示例用户消息太长`,
      example_user_too_long_description: `示例用户消息太长了（{current_length} 个字符），最多允许 {max_allowed} 个字符。`,
      example_bot_too_long_title: `示例人格回复太长`,
      example_bot_too_long_description: `示例人格回复太长了（{current_length} 个字符），最多允许 {max_allowed} 个字符。`,
      validation_failed_title: `🔴 校验失败`,
      validation_failed_description: `预设集数据没有通过校验，请重试。`,
      image_processing_failed_title: `🔴 图像处理失败`,
      image_processing_failed_description: `上传的图片处理失败。请换一张图片试试。`,
      avatar_fetch_failed_title: `🔴 头像获取失败`,
      avatar_fetch_failed_description: `获取服务器头像用于导出时失败。请改而上传一张图片。`,
      metadata_embed_failed_title: `🔴 导出失败`,
      metadata_embed_failed_description: `无法把人格数据写入图片，请重试。`,
      success_title: `🟢 {character_name} 创建成功！`,
      success_description: `**描述：**
{character_description}`,
      success_dialogue_title: `示例对话`,
      success_next_steps_title: `下一步`,
      success_next_steps_description: `1. 在右边下载附加的 PNG 文件
2. 用 \`/persona import\` 导入这个 PNG
或者按下「导入」按钮`,
      success_next_steps_footer: `之后你可以在 \`/config\` 中进一步自定义我。`,
      avatar_update_skipped_dm: `请注意，私信（DM）里无法导入头像和昵称的更新。`,
    },
  },
};
