export default {
  server: {
    timezone: {
      value_description: `UTCオフセット（時間、デフォルト: 0）。例: 8、-5、0、9`,
    },
    stm: {
      parameters: {
        supersede_option: `置き換え（カテゴリで生のやり取りを置換）`,
        crude_summary_option: `生＋要約（両方を併記）`,
      },
      "prompt-edit": {
        tool_description_label: `ツール説明`,
        tool_description_description: `STMツールがモデルに提示する説明文。`,
        update_nudge_label: `メモリの促し`,
        update_nudge_description: `モデルにSTMツールの使用を促すためにコンテキストへ挿入されるプロンプト。`,
      },
      "categories-edit": {
        slot_1_label: `カテゴリ 1`,
        slot_2_label: `カテゴリ 2`,
        slot_3_label: `カテゴリ 3`,
        slot_4_label: `カテゴリ 4`,
        slot_5_label: `カテゴリ 5`,
        slot_instructions: `1つの枠につき「ラベル: 説明」形式で入力（例：「目標: パーティの現在の目的」）。空欄は無視され、すべて空欄にすると既定の要約に戻ります。`,
        slot_placeholder: `ラベル: 説明`,
      },
    },
    "crosschannel-blocklist": {
      channel_label_forum: `{channel_name} [フォーラム]`,
      channel_label_media: `{channel_name} [メディア]`,
    },
    cooldown: {
      triggers: {
        cooldown_type_description: `クールダウン適用方法（デフォルト: オフ、ユーザーごと等）。`,
        cooldown_length_description: `クールダウン時間（秒、1-86400、デフォルト: 5）。`,
        type: {
          choice_off: `オフ`,
          choice_per_user: `ユーザーごと`,
          choice_per_channel: `チャンネルごと`,
          choice_server_wide: `サーバー全体`,
          choice_strict_server_wide: `厳密サーバー全体`,
        },
      },
    },
    "member-permissions": {
      servermemories_option: `サーバーの記憶`,
      attributelist_option: `属性リスト`,
      sampledialogues_option: `サンプル対話`,
      promptsnapshot_option: `プロンプトスナップショット`,
      servermemories_desc: `サーバー記憶の追加・削除`,
      attributelist_desc: `性格属性の追加・削除`,
      sampledialogues_desc: `サンプル対話の追加・削除`,
      promptsnapshot_desc: `/context および /tool prompt snapshot からプロンプト全文を閲覧`,
      select_placeholder: `メンバーに許可することを選択...`,
      select_embed_title: `メンバー教育権限`,
      select_embed_description: `管理者以外のメンバーが**教えられる**ことを選択してください。チェックあり = 許可。`,
    },
    alwaysreply: {
      description: `メインペルソナの常時応答モードを切り替えます。`,
    },
    deliberatetriggermode: {
      description: `このサーバーの明示的トリガーモード（DTM）を切り替えます。`,
    },
    deliberatetoolmode: {
      description: `このサーバーの明示的ツールモードを切り替えます。`,
    },
    "deliberate-tool-mode": {
      description: `このサーバーの明示的ツールモードを切り替えます。`,
    },
  },
};
