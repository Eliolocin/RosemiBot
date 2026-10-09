export default {
  nsfw: {
    description: `年齢制限付きのコマンドと設定です。`,
    persona: {
      description: `年齢制限付きのペルソナコマンドです。`,
      default: {
        description: `NSFWの人格設定プリセットを適用します`,
      },
      import: {
        description: `NSFWペルソナを含め、PNG、JSON、またはCHARXファイルからペルソナをインポートする`,
      },
    },
    jailbreaks: {
      description: `このサーバーでの任意のjailbreak機能を管理します。`,
      modal_title: `Jailbreak設定を管理`,
      checkbox_label: `有効なJailbreak設定`,
      checkbox_description: `チェックした設定は有効のままです。外した設定は無効になります。`,
      injection_option: `プロンプト注入（18+同意の確認）`,
      unicode_spaces_option: `Unicodeスペース置換`,
      sanitize_option: `センシティブ語句のサニタイズ`,
      no_changes_title: `変更はありません`,
      no_changes_description: `Jailbreak設定は変更されませんでした。`,
      success_title: `Jailbreak設定を更新しました`,
      success_description: `Jailbreak設定を更新しました。現在 **{enabled_count}** 件の設定が有効です。`,
    },
  },
};
