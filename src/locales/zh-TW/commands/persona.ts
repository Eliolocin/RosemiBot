export default {
  persona: {
    description: `管理人格預設集`,
    "image-tags": {
      modal_title: `人格圖片標籤`,
      tags_input_label: `外觀標籤`,
      tags_input_description: `以半形逗號分隔的圖板風格標籤，用來描述這個人格的外觀。留空即可清除。`,
      tags_input_placeholder: `short white hair, red eyes, school uniform`,
      no_tags_title: `沒有提供標籤`,
      no_tags_description: `請至少提供一個外觀標籤。`,
      too_many_tags_title: `標籤太多`,
      too_many_tags_description: `每個人格最多可以設定 {max_tags} 個圖片標籤。`,
      tag_too_long_title: `標籤過長`,
      tag_too_long_description: `每個圖片標籤必須是 {max_length} 個字元以內。`,
      success_title: `外觀已更新`,
      success_description: `已更新 **{persona_name}** 的外觀標籤：
\`\`\`
{tag_list}
\`\`\``,
      cleared_title: `外觀已清除`,
      cleared_description: `已清除 **{persona_name}** 的外觀標籤。`,
    },
    sprites: {
      add: {
        sprite_name_label: `立繪名稱`,
        sprite_name_description: `這個立繪使用的標籤。沿用同一個標籤會取代對應的立繪。`,
        sprite_name_placeholder: `mad`,
        image_label: `立繪圖片`,
        image_description: `上傳 PNG、JPG 或 GIF，我會轉成 PNG。`,
        instructions_label: `使用說明`,
        instructions_description: `選填，說明這個立繪適合在什麼時候使用。`,
        instructions_placeholder: `生氣、不耐煩或明顯不開心時使用。`,
        identity_label: `儲存為身分`,
        identity_description: `在 Discord 顯示加上裝飾的「立繪（人格）」名稱，適合 alter 身分。關閉 = 一般。`,
      },
      edit: {
        image_description: `選填。上傳 PNG、JPG 或 GIF 來取代立繪圖片。`,
        identity_status_on: `身分`,
        identity_status_off: `一般立繪`,
      },
      import: {
        archive_label: `立繪壓縮檔`,
        archive_description: `上傳由 /persona sprites export 產生的 .zip 檔。`,
      },
    },
    attribute: {
      description: `管理人格屬性。`,
      add: {
        description: `為人格新增屬性。`,
      },
      remove: {
        description: `從人格移除屬性。`,
      },
    },
    prompt: {
      description: `管理人格提示詞指示。`,
      set: {
        description: `設定人格提示詞。`,
      },
      remove: {
        description: `移除人格提示詞。`,
      },
    },
    "sample-dialogue": {
      description: `新增一組使用者與 bot 的範例對話，作為我該怎麼回覆的參考。`,
      add: {
        description: `新增一組使用者與 bot 的範例對話，作為我該怎麼回覆的參考。`,
      },
      remove: {
        description: `從我的記憶移除一組使用者與 bot 的範例對話。`,
      },
    },
    name_conflict_title: `🔴 人格名稱衝突`,
    name_conflict_description: `這個伺服器已經有人格叫 **{name}**。同一個伺服器內的人格名稱必須唯一。`,
    export: {
      description: `將目前的人格匯出成可分享的 PNG 檔`,
      export_json_select_label: `匯出 JSON`,
      export_json_select_description: `選填：改為匯出可匯入的 JSON 檔（不含頭像圖片）`,
      persona_modal_title: `選擇要匯出的人格`,
      persona_select_label: `人格`,
      persona_select_description: `選擇要匯出的人格。`,
      persona_select_placeholder: `選擇一個人格...`,
      main_persona_description: `主要人格`,
      alter_persona_description: `alter 人格`,
      success_title: `🟢 人格匯出成功`,
      success_description: `目前的人格 **{nickname}** 已經匯出！把這個 PNG 檔分享給別人，就能傳播這套人格設定。`,
      success_description_json: `目前的人格 **{nickname}** 已經匯出成 JSON 檔。

**注意：** 這個 JSON 可以用 \`/persona import\` 重新匯入。它不包含頭像圖片，如果要連頭像一起分享，請用 PNG 匯出。`,
      json_importable_note: `這個 JSON 匯出檔可以用 /persona import 匯入。它不包含頭像圖片；如果要連頭像一起分享，請用 PNG 匯出。`,
      failed_title: `🔴 匯出失敗`,
      avatar_failed_title: `🔴 頭像下載失敗`,
      avatar_failed_description: `無法下載人格頭像。請稍後再試。`,
      embed_failed_title: `🔴 PNG 處理失敗`,
      embed_failed_description: `無法將中繼資料寫入 PNG 檔。請再試一次。`,
      error_no_server_data: `資料庫找不到這個伺服器。請先執行 /setup。`,
      error_no_preset_data: `找不到人格資料。請先執行 /setup。`,
      error_validation_failed: `匯出資料的結構驗證失敗`,
      error_export_failed: `人格資料匯出失敗`,
    },
    import: {
      description: `從 PNG、JSON 或 CHARX 檔匯入人格`,
      file_description: `包含人格資料的 PNG、JSON 或 CHARX 檔`,
      type_description: `匯入為主要人格或 alter 人格`,
      triggers_description: `選填的額外觸發詞，以逗號分隔（「,」或「、」）`,
      memories_description: `保留這個人格的使用者記憶與伺服器記憶？`,
      memories_choice_preserve: `是，保留使用者與伺服器記憶`,
      memories_choice_fork: `否，使用者與伺服器記憶重新開始`,
      type_choice_main: `主要人格（取代目前的人格）`,
      type_choice_alter: `alter 人格`,
      success_title: `🟢 人格匯入成功`,
      success_description: `已成功匯入人格 **{nickname}**！
屬性：{attribute_count}
範例對話：{dialogue_count}
觸發詞：{trigger_word_count}`,
      success_confirmation: `已成功匯入主要人格 **{nickname}**！詳細的匯入資訊已發布在頻道中。`,
      post_missing_permission: `人格已匯入，但我無法發布確認訊息。請讓管理員授予我此頻道的 {permission} 權限。`,
      nickname_update_success: `伺服器暱稱已更新。`,
      nickname_update_failed: `🟡 無法更新伺服器暱稱，可能是遇到 Discord 的頻率限制。請改為手動變更。`,
      avatar_update_success: `伺服器頭像已更新。`,
      avatar_update_skipped_no_image: `🟡 匯入的檔案沒有頭像圖片，因此保留目前的主要人格頭像。`,
      avatar_update_rate_limited: `🟡 因為 Discord 的頻率限制，伺服器頭像沒有更新。請改為手動變更。`,
      avatar_update_failed: `🟡 無法更新伺服器頭像，可能是遇到 Discord 的頻率限制。請改為手動變更。`,
      alter_success_title: `🟢 alter 人格匯入成功`,
      alter_success_description: `已成功匯入 alter 人格 **{nickname}**！
不重複的觸發詞：{trigger_count}
觸發詞：{triggers}

當訊息中出現這些觸發詞時，這個人格就會回覆。`,
      alter_success_confirmation: `已成功匯入 alter 人格 **{nickname}**，共有 {trigger_count} 個不重複的觸發詞！詳細的匯入資訊已發布在頻道中。`,
      alter_avatar_fallback_main: `🟡 這次匯入沒有包含頭像圖片，所以這個 alter 暫時使用 **{nickname}** 目前的主要人格頭像。你可以用 \`/config\` > 人格 > 一般來變更。`,
      alter_avatar_warning: `⚠️ 請不要刪除上方嵌入的頭像圖片，否則 alter 人格的頭像會遺失。`,
      alter_dm_not_allowed_title: `🔴 私訊不允許 alter 人格`,
      alter_dm_not_allowed_description: `alter 人格只能在伺服器匯入，不能在私訊匯入。請在伺服器執行這個指令。`,
      alter_no_triggers_warning: `⚠️ 這個人格沒有任何觸發詞。在你用 \`/config\` > 人格 > 一般新增觸發詞之前，它不會回覆任何訊息。`,
      alter_name_conflict_title: `🔴 人格名稱已存在`,
      alter_name_conflict_description: `這個伺服器已經有人格叫 **{name}**。每個人格的名稱都必須唯一。

請修改匯入檔改用其他名稱，或用 \`/persona remove\` 移除現有的人格。`,
      alter_limit_title: `🔴 已達人格上限`,
      alter_limit_description: `這個伺服器已經有 {current} 個人格，上限是 {max} 個。請先用 \`/persona remove\` 移除一個 alter，再匯入新的。`,
      failed_title: `🔴 匯入失敗`,
      failed_description: `人格匯入失敗。請檢查檔案後再試一次。`,
      sprite_snapshot_failed_description: `因為讀不到目前的人格立繪，匯入已取消。沒有變更任何人格資料。請再試一次。`,
      sprite_cleanup_failed_description: `人格已匯入，但先前的立繪資料列無法清除。這次匯入並不完整。請再試一次，或聯絡管理員。`,
      sprite_storage_cleanup_partial_description: `人格已匯入，但有 {failed_count} 張先前的立繪圖片無法從儲存空間刪除。`,
      invalid_file_type_title: `🔴 檔案類型無效`,
      invalid_file_type_description: `請上傳包含人格資料的有效 .png、.json 或 .charx 檔。`,
      file_too_large_title: `🔴 檔案太大`,
      file_too_large_description: `檔案太大。大小上限是 {max_size}MB。`,
      download_failed_title: `🔴 下載失敗`,
      download_failed_description: `無法下載附加檔案。請再試一次。`,
      invalid_charx_title: `🔴 角色卡壓縮檔無效`,
      invalid_charx_description: `這個 .charx 檔無法讀取為 Character Card V3 壓縮檔。請到提供這張卡的網站重新下載，或改為匯出成 .png 檔。`,
      card_conversion_failed_title: `🟡 偵測到角色卡，但轉換失敗`,
      card_conversion_failed_description: `已從 **{source}** 解碼出一張卡，但轉成 Tomori 格式失敗。解碼後的內容已附加在下方供檢查。請透過 \`/support discord\` 回報，並附上該檔案。`,
      charx_not_card_description: `這個 .charx 壓縮檔可以開啟，但裡面的卡不是角色卡。請確認這個檔案本身就是角色卡，而不是同一次下載中的其他壓縮檔。`,
      charx_too_large_description: `這個壓縮檔裡的角色卡太大，無法匯入。卡片大小上限是 {max_size}MB。`,
      charx_assets_too_large_description: `這張卡綁定的媒體檔案超過匯入能檢查的數量。請改用匯出時不含圖片、音訊或影片素材的卡片。`,
      charx_assets_ignored_description: `🟡 這張卡綁定的圖片、音訊與其他媒體都沒有匯入，只讀取了人格文字。你可以用 \`/server avatar\` 設定頭像，並在 \`/config\` > 人格 > 立繪新增立繪。`,
      invalid_png_title: `🔴 PNG 檔無效`,
      invalid_png_description: `上傳的檔案不是有效的 PNG 圖片。`,
      no_metadata_title: `🔴 找不到人格資料`,
      no_metadata_description: `這個檔案沒有支援的人格資料。請改用 \`/persona export\` 匯出的檔案，或支援的 SillyTavern 角色卡。`,
      invalid_file_title: `🔴 人格檔案無效`,
      invalid_file_description: `人格檔案的格式無效或不相容。`,
      no_permission_title: `🔴 權限不足`,
      no_permission_description: `匯入人格需要 **管理伺服器** 權限。`,
      error_download_timeout: `檔案下載逾時。請再試一次。`,
      error_invalid_attribute: `屬性內容無效：{details}`,
      error_attribute_flags_mismatch: `屬性可見性旗標的數量必須與屬性清單長度相符。`,
      error_invalid_dialogue_in: `範例對話輸入無效：{details}`,
      error_invalid_dialogue_out: `範例對話輸出無效：{details}`,
      error_invalid_trigger_word: `觸發詞無效：{details}`,
      error_dialogue_mismatch: `範例對話陣列長度不一致`,
      error_invalid_config: `人格資料中的設定欄位無效`,
      error_no_server_data: `資料庫找不到這個伺服器。請先執行 \`/setup\`。`,
      error_name_conflict: `這個伺服器已經有人格叫 **{name}**。請改用其他名稱。`,
      error_nsfw_persona: `這個人格被標記為 NSFW，所以 \`/persona import\` 無法載入。請改用 \`/nsfw persona import\`。`,
      error_import_failed: `人格資料匯入失敗`,
      error_not_json: `匯入的檔案必須包含有效的 JSON 資料`,
      error_incompatible_version: `預設集版本不相容。預期 {expected}，實際為 {actual}`,
      error_invalid_format: `人格檔案格式無效`,
      error_invalid_type: `人格類型無效：{type}。預期為 "preset"`,
      avatar_update_skipped_dm: `人格已成功匯入，但頭像與暱稱更新無法在私訊中進行`,
      refresh_reminder: `執行 \`/refresh\` 即可在這個對話套用新的人格`,
    },
    remove: {
      description: `從伺服器移除 alter 人格`,
      no_permission_title: `🔴 權限不足`,
      no_permission_description: `移除 alter 人格需要 **管理伺服器** 權限。`,
      modal_title: `移除 alter 人格`,
      select_label: `alter 人格`,
      select_placeholder: `選擇要移除的 alter 人格...`,
      no_alters_error_title: `🟡 沒有 alter 人格`,
      no_alters_error_description: `沒有可以移除的 alter 人格。請用 \`/persona import type:alter\` 匯入 alter 人格。`,
      success_title: `🟢 已移除 alter 人格`,
      success_description: `已成功移除 alter 人格 **{nickname}**。`,
    },
    default: {
      description: `套用預設的人格設定`,
      type_description: `套用到主要／預設人格，或建立為 alter 人格`,
      type_choice_default: `主要人格（取代目前的人格）`,
      type_choice_alter: `alter 人格`,
      no_permission_title: `🔴 權限不足`,
      no_permission_description: `套用人格預設集需要 **管理伺服器** 權限。`,
      modal_title: `套用預設人格`,
      select_label: `預設人格`,
      select_description: `選擇要套用的預設集。這會覆寫目前的屬性與對話。`,
      select_placeholder: `選擇一個預設集...`,
      no_presets_title: `沒有可用的預設集`,
      no_presets_description: `你的語言沒有可用的人格預設集。請透過 \`/support discord\` 回報。`,
      preset_not_found: `找不到選取的預設集。`,
      success_title: `預設集已套用`,
      success_details_description: `已成功將預設集 **{preset_name}** 套用到人格 **{nickname}**！
屬性：{attribute_count}
範例對話：{dialogue_count}
觸發詞（{trigger_word_count}）：{triggers}`,
      success_confirmation: `預設集已套用到 **{nickname}**。詳細資訊已發布在這個頻道。`,
      avatar_update_failed: `🟡️ 因為 Discord API 錯誤，伺服器頭像無法更新，但人格已成功套用。`,
      avatar_update_skipped_dm: `預設集已成功套用，但頭像更新無法在私訊中進行`,
    },
    import_now: {
      button: `立刻匯入`,
      imported: `已匯入`,
      already_imported_title: `🟡 已經匯入`,
      already_imported_description: `這個人格已經匯入過，或目前正在匯入中。`,
    },
    generate: {
      description: `AI 生成人格（需要相容的供應商）`,
      modal: {
        title: `生成 AI 人格`,
        character_name_label: `角色名稱`,
        character_name_description: `以逗號分隔的名稱（「,」或「、」）：全部都會成為觸發詞，第一個會成為顯示名稱。`,
        character_name_placeholder: `例如 Hatsune Miku、Miku、初音ミク`,
        character_info_label: `角色資訊與說話範例`,
        character_info_description: `描述這個角色以及說話方式`,
        character_info_placeholder: `性格、背景故事、說話風格、範例台詞等`,
        web_search_label: `要搜尋網路嗎？`,
        web_search_description: `搜尋角色資訊（適用於媒體作品中既有的角色）`,
        web_search_placeholder: `選擇是或否`,
        web_search_yes: `是，搜尋角色資訊`,
        web_search_no: `否，建立原創角色`,
        additional_inst_label: `補充指示`,
        additional_inst_placeholder: `選填：其他指示（例如「請讓這個角色的回覆短一點」）`,
        file_upload_label: `角色圖片／卡片（選填）`,
        file_upload_description: `上傳圖片、Tomori 預設集或 SillyTavern 角色卡 PNG，用來生成或轉換角色`,
      },
      field_character_name: `角色名稱`,
      field_character_info: `角色資訊與說話範例`,
      field_web_search: `要搜尋網路嗎？`,
      field_additional_inst: `補充指示`,
      wrong_provider_title: `🔴 供應商不相容`,
      wrong_provider_description: `生成預設集需要相容的供應商。你目前的供應商是 **{current_provider}**。請用 \`/config\` > 模型 > 切換模型切換到支援的供應商。`,
      no_api_key_title: `🔴 沒有 API 金鑰`,
      no_api_key_description: `沒有設定使用中的供應商。請用 \`/setup\`（第一次）或 \`/providers\` 註冊一個。`,
      model_incompatible_title: `模型不相容`,
      model_incompatible_description: `你目前的模型（**{model_name}**）不支援 **STRUCTURED OUTPUT**，而這是生成人格的必要條件。

**接下來可以這樣做：**
請用 \`/config\` > 模型 > 切換模型切換到支援結構化輸出的模型（例如具備「STRUCT」功能的模型）。`,
      image_vision_required_title: `🔴 需要圖片視覺功能`,
      image_vision_required_description: `你上傳了圖片，但你目前的模型（**{model_name}**）不支援 **IMAGE VISION**，也沒有設定視覺模型。

**接下來可以這樣做：**
1. 用 \`/config\` > 模型 > 切換模型設定專門的視覺模型，或
2. 用 \`/config\` > 模型 > 切換模型切換到支援視覺的模型，或
3. 移除圖片後重新生成`,
      web_search_tools_required_title: `🔴 無法使用網路搜尋`,
      web_search_tools_required_description: `你選擇了網路搜尋，但目前的模型（**{model_name}**）不支援 **TOOLS**。

**接下來可以這樣做：**
1. 用 \`/config\` > 模型 > 切換模型切換到支援工具的模型，或
2. 不要網路搜尋，重新生成一次（被問到時選「否」）`,
      api_key_decrypt_failed_title: `🔴 API 金鑰錯誤`,
      api_key_decrypt_failed_description: `無法解密使用中供應商的憑證。請用 \`/providers\` 重新設定。`,
      vision_credentials_unavailable_title: `🔴 視覺模型的憑證不可用`,
      vision_credentials_unavailable_description: `你的視覺模型（**{vision_model_name}**）在供應商 **{vision_provider}** 上執行，但無法用它的 API 金鑰描述圖片。請用 \`/providers\` 重新設定該供應商的憑證，或到 \`/config\` > 模型 檢查一下。`,
      invalid_image_title: `🔴 圖片無效`,
      invalid_image_description: `請上傳有效的圖片檔（PNG、JPG、JPEG 等）。`,
      error_file_too_large: `頭像圖片必須是 {max_size}MB 以內。`,
      error_download_timeout: `頭像下載逾時。請再試一次。`,
      error_download_failed: `頭像圖片下載失敗。`,
      processing_title: `正在生成人格...`,
      processing_description: `這可能需要 1 到 2 分鐘。請稍等，我正在生成這個角色...

結果可能不如預期。需要的話可以重新生成。`,
      captioning_title: `正在描述你的頭像...`,
      captioning_description: `你的主要模型無法辨識圖片，所以我會先請視覺模型（**{model_name}**）描述你上傳的頭像。接著主要模型會根據這段描述來生成人格。這可能需要 1-2 分鐘。`,
      generation_failed_title: `🔴 生成失敗`,
      generation_failed_description: `人格生成失敗：{error}

請換一組輸入再試一次，或檢查你的 API 金鑰。`,
      vision_caption_failed_title: `🔴 頭像描述失敗`,
      vision_caption_failed_description: `你的視覺模型（**{vision_model_name}**，{vision_provider}）無法描述上傳的頭像。

**後續步驟：**
1. 用 \`/providers\` 檢查該供應商的 API 金鑰，或
2. 移除圖片後重新生成，或
3. 在 \`/config\` > 模型 中換一個視覺模型`,
      validation_failed_title: `🔴 驗證失敗`,
      validation_failed_description: `生成的人格資料沒有通過驗證。請再試一次。`,
      image_processing_failed_title: `🔴 圖片處理失敗`,
      image_processing_failed_description: `無法處理上傳的圖片。請換一張圖片。`,
      avatar_fetch_failed_title: `🔴 頭像讀取失敗`,
      avatar_fetch_failed_description: `無法讀取伺服器頭像來匯出。請改為上傳一張圖片。`,
      metadata_embed_failed_title: `🔴 匯出失敗`,
      metadata_embed_failed_description: `無法將人格資料寫入圖片。請再試一次。`,
      success_title: `🟢 已成功生成 {character_name}！`,
      success_description: `我已經為 **{character_name}** 生成好人格了！
**屬性預覽：**
{attribute_preview}
**範例對話：**
{dialogue_preview}`,
      success_next_steps_title: `接下來`,
      success_next_steps_description: `1. 下載右側附加的 PNG 檔
2. 用這個 PNG 執行 \`/persona import\`
或按下「匯入」按鈕`,
      success_next_steps_description_dm: `1. 下載附加的 PNG 檔
2. 用這個 PNG 執行 \`/persona import\`
3. 執行 \`/refresh\` 套用我的新人格`,
      success_next_steps_footer: `之後你可以在 \`/config\` 中進一步自訂我。`,
      avatar_update_skipped_dm: `請注意，私訊中無法匯入頭像與暱稱更新。`,
    },
    create: {
      description: `手動建立簡單的人格預設集`,
      modal: {
        title: `建立新的人格`,
        character_name_label: `角色名稱`,
        character_name_description: `以逗號分隔的名稱（「,」或「、」）：全部都會成為觸發詞，第一個會成為顯示名稱。`,
        character_name_placeholder: `例如 Hatsune Miku、Miku、初音ミク`,
        character_desc_label: `角色描述`,
        character_desc_placeholder: `描述你的角色（性格、外觀、背景故事等）`,
        example_user_label: `使用者訊息範例`,
        example_user_description: `提示：之後可以用 /persona sample-dialogue add 新增更多`,
        example_user_placeholder: `嗨 {bot}！`,
        example_bot_label: `Bot 回覆範例`,
        example_bot_placeholder: `你好 {user}！過得還好嗎？`,
        file_upload_label: `角色圖片（選填）`,
        file_upload_description: `上傳一張圖片，用於匯出角色`,
      },
      field_character_name: `角色名稱`,
      field_character_desc: `角色描述`,
      field_example_user: `使用者訊息範例`,
      field_example_bot: `Bot 回覆範例`,
      invalid_image_title: `🔴 圖片無效`,
      invalid_image_description: `請上傳有效的圖片檔（PNG、JPG、JPEG 等）。`,
      error_file_too_large: `頭像圖片必須是 {max_size}MB 以內。`,
      error_download_timeout: `頭像下載逾時。請再試一次。`,
      error_download_failed: `頭像圖片下載失敗。`,
      desc_too_long_title: `描述過長`,
      desc_too_long_description: `角色描述太長（{current_length} 個字元）。長度上限是 {max_allowed} 個字元。`,
      example_user_too_long_title: `使用者訊息範例過長`,
      example_user_too_long_description: `使用者訊息範例太長（{current_length} 個字元）。長度上限是 {max_allowed} 個字元。`,
      example_bot_too_long_title: `Bot 回覆範例過長`,
      example_bot_too_long_description: `Bot 回覆範例太長（{current_length} 個字元）。長度上限是 {max_allowed} 個字元。`,
      validation_failed_title: `🔴 驗證失敗`,
      validation_failed_description: `預設集資料沒有通過驗證。請再試一次。`,
      image_processing_failed_title: `🔴 圖片處理失敗`,
      image_processing_failed_description: `無法處理上傳的圖片。請換一張圖片。`,
      avatar_fetch_failed_title: `🔴 頭像讀取失敗`,
      avatar_fetch_failed_description: `無法讀取伺服器頭像來匯出。請改為上傳一張圖片。`,
      metadata_embed_failed_title: `🔴 匯出失敗`,
      metadata_embed_failed_description: `無法將人格資料寫入圖片。請再試一次。`,
      success_title: `🟢 已成功建立 {character_name}！`,
      success_description: `**描述：**
{character_description}`,
      success_dialogue_title: `範例對話`,
      success_next_steps_title: `接下來`,
      success_next_steps_description: `1. 下載右側附加的 PNG 檔
2. 用這個 PNG 執行 \`/persona import\`
或按下「匯入」按鈕`,
      success_next_steps_footer: `之後你可以在 \`/config\` 中進一步自訂我。`,
      avatar_update_skipped_dm: `請注意，私訊中無法匯入頭像與暱稱更新。`,
    },
  },
};
