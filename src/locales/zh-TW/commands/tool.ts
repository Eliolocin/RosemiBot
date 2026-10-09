export default {
  tool: {
    description: `對話脈絡、提示詞與診斷的實用工具。`,
    estimate: {
      description: `估算用量與費用`,
      cost: {
        description: `估算付費 AI 供應商的 API 費用`,
        title: `預估 API 費用`,
        embed_description: `以下是使用付費 AI 供應商時，在 Discord 頻道中每次觸發的**非常粗略**費用估算。費用是以範例供應商 **{provider}** 的價格估算（輸入：{inputPrice}/百萬 token，輸出：{outputPrice}/百萬 token）`,
        current_context_description: `這是你**目前脈絡**的預估費用。輸入 token 由供應商 API 依你目前的設定與最近的頻道紀錄，在 **{provider}** 的 **{model}** 模型上實測。輸出 token 仍為估算值。使用的價格：輸入 {inputPrice}/百萬，輸出 {outputPrice}/百萬。`,
        current_context_estimated_description: `這是你**目前脈絡**的預估費用。**{provider}**（模型 **{model}**）沒有即時 token 計算 API，因此輸入 token 是依你目前的設定與最近的頻道紀錄**以字元數推算**（約每 4 個字元 1 個 token）。準確度會因語言而異，日文等資訊密度較高的文字，實際 token 數會比這個估算更多。輸出 token 同樣是估算值。使用的價格：輸入 {inputPrice}/百萬，輸出 {outputPrice}/百萬。`,
        current_input_title: `實測輸入 token（目前脈絡）`,
        current_input_estimated_title: `預估輸入 token（目前脈絡）`,
        current_input_value: `**輸入：** {inputTokens} 個 token
**僅輸入費用：** 每次觸發約 {inputCost}`,
        current_output_typical_title: `預估輸出：一般情況`,
        current_output_persona_average_title: `預估輸出：人格平均`,
        current_output_band_value: `**輸出估算：** {outputTokens} 個 token
**輸出估算費用：** 每次觸發約 {outputCost}`,
        average_total_cost_title: `每次觸發的平均總費用`,
        average_total_cost_value: `**總計估算：** {totalTokens} 個 token
每次觸發約 {costPerMessage}（每 100 次觸發約 {costPer100}）`,
        current_footer: `只有支援即時計算的供應商，輸入 token 才會由供應商實測。輸出 token 都是估算值。「人格平均」區間會綜合這個人格的範例對話回覆，以及在這個頻道最近的發言。兩個來源都沒有的時候，會退回一般情況的估算。`,
        current_estimated_footer: `這個供應商沒有即時計算 API，因此輸入 token 是以字元數推算。請把這些數字當成粗略參考，尤其是日文或充滿 JSON 的脈絡。輸出 token 同樣是估算值。「人格平均」區間會綜合這個人格的範例對話回覆，以及在這個頻道最近的發言。兩個來源都沒有的時候，會退回一般情況的估算。`,
        no_cost_provider_description: `目前的供應商沒有費用資料`,
        unavailable_description: `目前的供應商（**{provider}**）無法使用即時費用估算。`,
        fallback_notice_title: `無法即時計算`,
        fallback_notice_value: `你目前的設定無法使用供應商的即時 token 計算，因此這個檢視只是粗略的備援估算。`,
        minimum_scenario_title: `最低情境（輕度使用）`,
        minimum_scenario_value: `**脈絡：** 1 位使用者、0 則記憶、1 段人格描述，每則訊息對話不到一句
**token：** 輸入 {inputTokens} + 輸出 {outputTokens}`,
        average_scenario_title: `平均情境（中度使用）`,
        average_scenario_value: `**脈絡：** 3 位使用者各 10 則記憶、約 16 段人格描述（含屬性與對話），每則訊息對話 1 到 2 句
**token：** 輸入 {inputTokens} + 輸出 {outputTokens}`,
        maximum_scenario_title: `最高情境（重度使用）`,
        maximum_scenario_value: `**脈絡：** 5 位使用者各 25 則記憶、約 31 段人格描述（含屬性與對話），每則訊息對話 2 段
**token：** 輸入 {inputTokens} + 輸出 {outputTokens}`,
        breakdown_title: `什麼會影響費用？`,
        breakdown_value: `**輸入 token（送給 AI 的脈絡）：**
- 人格段落（包含屬性與範例對話）
- 伺服器記憶與個人記憶
- 已啟用的工具（如果有）
- 使用者狀態與提醒
- 最近的對話紀錄（供應商支援時，包含圖片、影片、貼圖、表情符號與嵌入內容）
- 伺服器表情符號（固定 10 個）

**輸出 token（AI 的回覆）：**
- 回覆長度會隨問題複雜度而不同
- 問題越詳細 = 回覆越長 = 費用越高

**降低費用的訣竅：**
我內建了一些功能，可以減少伺服器裡濫用或洗頻造成的費用，這裡還有幾個額外的訣竅：
- 減少人格段落（屬性與對話）
- 讓記憶保持精簡
- 使用免費的 AI 供應商（Google Gemini 免費方案）
- 限制自動觸發頻道`,
        footer: `Google Gemini（免費方案）等免費供應商，以及部分 OpenRouter 模型都不收費！NovelAI 訂閱後可無限使用。打開 \`/help\` 的「設定」，看「步驟 1：取得 API 金鑰」以了解更多。`,
      },
    },
    delete: {
      description: `刪除對話輪或其他頻道內容。`,
      turn: {
        description: `從頻道刪除人格的最後一輪發言。`,
        regenerate_description: `若為是，刪除後重新觸發該人格。`,
        select_persona_description: `若為是，選擇要刪除哪個人格的發言。`,
        no_permission_title: `權限不足`,
        no_permission_description: `這個指令需要管理伺服器權限，或必須在指定的 RP 頻道使用。`,
        already_running_title: `正在刪除`,
        already_running_description: `這個頻道已經有刪除正在進行。請稍等。`,
        no_persona_found_title: `找不到人格發言`,
        no_persona_found_description: `在最近的紀錄中找不到連續的人格訊息區塊。`,
        deleting_title: `⏳ 正在刪除發言`,
        deleting_description: `正在刪除 **{persona_name}** 的 {count} 則訊息...`,
        success_title: `✅ 已刪除發言`,
        success_description: `已刪除 **{persona_name}** 的 {count} 則訊息。`,
        success_regenerate_description: `已刪除 **{persona_name}** 的 {count} 則訊息。正在重新觸發...`,
        partial_title: `⚠️ 部分刪除`,
        partial_description: `已刪除 **{persona_name}** 的 {deleted_count}/{total_count} 則訊息。有些訊息無法刪除。`,
        partial_no_manage_messages_description: `已刪除 **{persona_name}** 的 {deleted_count}/{total_count} 則訊息。我缺少 **管理訊息** 權限，所以無法全部刪除。`,
        bot_no_delete_title: `無法刪除訊息`,
        bot_no_delete_description: `我在這個頻道沒有 **管理訊息** 權限，也無法透過 webhook 備援刪除任何訊息。請授予我 **管理訊息** 權限，或確認我的 webhook 可以使用。`,
        bot_failed_delete_description: `嘗試刪除訊息時發生非預期的錯誤。`,
      },
    },
    prompt: {
      description: `檢視 TomoriBot 送給模型的提示詞。`,
      snapshot: {
        description: `將某個人格的完整 LLM 提示詞匯出成檔案，方便除錯。`,
        persona_description: `要擷取快照的人格。預設為主要人格。`,
        format_description: `快照檔的輸出格式。`,
        fetch_tools_description: `若為是，會把可用的工具／函式定義附加到快照中（僅限 JSON）。`,
        text_option: `文字`,
        json_option: `JSON`,
        no_permission_title: `權限不足`,
        no_permission_description: `你需要 **管理伺服器** 權限，或由伺服器擁有者透過 \`/moderation\` 開放給成員使用。`,
        persona_not_found_title: `找不到人格`,
        persona_not_found_description: `該人格已不存在於這個伺服器。請從清單中選擇。`,
        dm_title: `提示詞快照`,
        dm_description: `這是人格 **{persona_name}** 的提示詞快照（格式：{format}）。`,
        dm_txt_headers_note: `TXT 檔中的 \`=== 標題 (/指令) ===\` 與 \`== 副標題 ==\` 標頭是標註，用來顯示每個區段由哪個設定指令控制。它們**不是**實際送給 LLM 的提示詞內容。「未標註」代表該區段是由自訂 st-preset 重新排列，或屬於該預設集的一部分`,
        dm_hint_try_json: `用 \`format: JSON\` 再執行一次指令，即可取得原始格式。`,
        dm_hint_try_text: `用 \`format: Text\` 再執行一次指令，即可取得較容易閱讀的格式。`,
        dm_tools_txt_note: `TXT 格式會省略工具定義，請改用 \`format: JSON\` 搭配 \`fetch_tools: true\` 重新執行，即可包含它們。`,
        dm_config_heading: `**取樣／請求設定**（與供應商轉接器在執行時送出的內容一致）：`,
        dm_truncated_note: `對話紀錄超出模型的上限，因此最早的 {count} 輪對話已被略過，就如實際回覆時一樣。`,
        dm_failed_title: `無法傳送私訊`,
        dm_failed_description: `我無法傳送私訊給你。快照改為附加在這裡。請開放接收伺服器成員的私訊，之後就能在私訊收到快照。`,
        success_title: `快照已傳送`,
        success_description: `提示詞快照已傳送到你的私訊。`,
        no_personas_title: `找不到人格`,
        no_personas_description: `這個伺服器找不到任何人格。`,
        build_failed_title: `快照失敗`,
        build_failed_description: `無法建立提示詞快照。請再試一次。`,
        guild_only_title: `僅限伺服器`,
        guild_only_description: `這個指令只能在伺服器頻道使用。`,
        dm_tools_filtering_note: `當明確工具模式啟用時，JSON 快照中的工具定義只會保留最新可見對話輪所需的內容。事後產生的快照不一定能完整重建當下保留的暫時工具脈絡，但也不會在實際對話輪應該縮減或隱藏工具時，仍然把所有工具都倒出來。`,
      },
    },

    visualize: {
      missing_permissions_title: `權限不足`,
      missing_permissions_description: `我需要在這個頻道查看頻道、讀取訊息紀錄、傳送訊息與附加檔案的權限，才能在這裡生成場景圖片。`,
      cooldown_active: `這個伺服器的管理員設定了冷卻。請等待 **{seconds}** 秒後，再以 **畫出目前的場景** 模式使用 \`/generate image\`。這個冷卻與訊息觸發及其他手動指令共用。`,
      channel_not_whitelisted: `這個伺服器啟用了白名單限制。**畫出目前的場景** 模式的 \`/generate image\` 只能在白名單頻道、由具備白名單身分組的成員使用，而且只能用於這個頻道允許的人格。`,
      persona_access_blocked: `依你目前的白名單權限與個人聚光燈設定，這個頻道的 **畫出目前的場景** 模式沒有可用於 \`/generate image\` 的人格。`,
      no_backend_title: `沒有可用的圖片後端`,
      no_backend_description: `我目前找不到這個伺服器可用的圖片後端。請為 **{current_provider}** 設定有效的圖片模型，或如果你想改用 NovelAI 渲染器，請新增 NovelAI 選用金鑰。`,
      planner_unavailable_title: `沒有可用的規劃模型`,
      planner_unavailable_description: `我找不到目前供應商支援結構化輸出的模型，所以現在無法規劃場景圖片。`,
      planner_failed_title: `場景規劃失敗`,
      planner_failed_description: `我無法把最近的頻道脈絡轉成圖片規劃：{error}`,
      success_title: `場景圖片已發布`,
      success_description: `我依最近的頻道脈絡規劃了鏡頭，並在這個頻道發布圖片。`,
      modal: {
        title: `場景圖片設定`,
        prompt_label: `額外指示（選填）`,
        prompt_description: `加入任何你想讓場景規劃器遵守的修正、氣氛或細節`,
        prompt_placeholder: `例如：聚焦在雨上、柔和一點、讓兩個角色都清楚入鏡`,
        setting_label: `鏡頭預設集`,
        setting_description: `選擇這個即時場景圖片的取景與風格預設集`,
        setting_storybeat_label: `劇情片段`,
        setting_storybeat_description: `為當下場景取景的寬幅電影感構圖`,
        setting_character_label: `角色特寫`,
        setting_character_description: `以主要角色或發言者為中心的近距離構圖`,
        setting_snapshot_label: `方形快照`,
        setting_snapshot_description: `為當下時刻取得平衡的方形構圖`,
        setting_vertical_label: `手機桌布`,
        setting_vertical_description: `縱向長幅構圖，剪影更強烈`,
        backend_label: `圖片後端`,
        backend_description: `選擇由哪個渲染器生成場景圖片`,
        backend_current_label: `目前供應商`,
        backend_current_description: `使用 {provider} 一般的圖片生成流程與提示詞風格`,
        backend_novelai_label: `NovelAI`,
        backend_novelai_description: `把場景轉成 NovelAI 風格標籤，並使用 NovelAI 圖片工具`,
        persona_label: `發送人格`,
        persona_description: `選擇由哪個人格發布生成的圖片`,
      },
    },
  },
};
