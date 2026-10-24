export default {
  booru: {
    description: `既存のアニメイラストを検索`,
    search: {
      description: `1つまたは2つのタグでDanbooruの高評価画像をランダムに4枚投稿`,
      tag_description: `キャラクター、作品名、またはタグ（入力時にサジェスト表示）`,
      second_tag_description: `絞り込み用の追加タグ（任意）`,
      rating_description: `表示するレーティング（デフォルト：全年齢およびセンシティブ）`,
      general_option: `全年齢（General）`,
      sensitive_option: `センシティブ（Sensitive）`,
      questionable_option: `クエスチョナブル（年齢制限チャンネル限定）`,
      explicit_option: `明示的（年齢制限チャンネル限定）`,
      rating_restricted_title: `このレーティングには年齢制限チャンネルが必要です`,
      rating_restricted_description: `クエスチョナブルおよび明示的な結果は、年齢制限チャンネルでのみ表示されます。全年齢またはセンシティブを選択するか、年齢制限チャンネルで実行してください。`,
      no_results_title: `画像が見つかりませんでした`,
      no_results_description: `{query} に一致する高評価の投稿はありませんでした。スペルを確認するか、単一のタグでお試しください。`,
      error_title: `Danbooruが応答しませんでした`,
      error_description: `しばらくしてからもう一度お試しください。`,
    },
  },
};
