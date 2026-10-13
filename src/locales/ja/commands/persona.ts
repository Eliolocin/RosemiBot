export default {
  persona: {
    description: `人格プリセットを管理する`,
    "image-tags": {
      modal_title: `ペルソナ画像タグ`,
      tags_input_label: `身体的外見タグ`,
      tags_input_description: `このペルソナの身体的外見を表す画像掲示板スタイルのカンマ区切りタグです。空欄でクリアします。`,
      tags_input_placeholder: `short white hair, red eyes, school uniform`,
      no_tags_title: `タグが未入力です`,
      no_tags_description: `少なくとも1つの身体的外見タグを入力してください。`,
      too_many_tags_title: `タグが多すぎます`,
      too_many_tags_description: `1ペルソナあたり最大{max_tags}個まで画像タグを設定できます。`,
      tag_too_long_title: `タグが長すぎます`,
      tag_too_long_description: `各画像タグは{max_length}文字以下にしてください。`,
      success_title: `身体的外見を更新しました`,
      success_description: `**{persona_name}** の身体的外見タグを更新しました:
\`\`\`
{tag_list}
\`\`\``,
      cleared_title: `身体的外見をクリアしました`,
      cleared_description: `**{persona_name}** の身体的外見タグをクリアしました。`,
    },
    sprites: {
      add: {
        sprite_name_label: `スプライト名`,
        sprite_name_description: `スプライトのラベルです。同じラベルを使用すると対応するスプライトが置き換えられます。`,
        sprite_name_placeholder: `mad`,
        image_label: `スプライト画像`,
        image_description: `PNG、JPG、GIFをアップロードしてください。PNGに変換されます。`,
        instructions_label: `使用指示`,
        instructions_description: `このスプライトを使う場面の任意の説明です。`,
        instructions_placeholder: `怒っている、いらだっている、不満そうな時に使う。`,
        identity_label: `アイデンティティとして保存`,
        identity_description: `Discordに装飾された「スプライト（ペルソナ）」名を表示します。オルタに便利です。オフで通常。`,
      },
      edit: {
        image_description: `任意。PNG、JPG、GIFをアップロードすると画像を置き換えます。`,
        identity_status_on: `アイデンティティ`,
        identity_status_off: `通常のスプライト`,
      },
      import: {
        archive_label: `スプライトアーカイブ`,
        archive_description: `/persona sprites export で作成した.zipをアップロードしてください。`,
      },
    },
    attribute: {
      description: `ペルソナの属性を管理します。`,
      add: {
        description: `ペルソナに属性を追加します。`,
      },
      remove: {
        description: `ペルソナから属性を削除します。`,
      },
    },
    prompt: {
      description: `ペルソナのプロンプト指示を管理します。`,
      set: {
        description: `ペルソナプロンプトを設定します。`,
      },
      remove: {
        description: `ペルソナプロンプトを削除します。`,
      },
    },
    "sample-dialogue": {
      description: `私がどのように応答すべきかの例として、ユーザー/ボットの対話ペアを追加します。`,
      add: {
        description: `私がどのように応答すべきかの例として、ユーザー/ボットの対話ペアを追加します。`,
      },
      remove: {
        description: `私の記憶からサンプルユーザー/ボットの対話ペアを削除します。`,
      },
    },
    name_conflict_title: `🔴 ペルソナ名の競合`,
    name_conflict_description: `**{name}** という名前のペルソナは既にこのサーバーに存在します。ペルソナ名はサーバー内で一意である必要があります。`,
    export: {
      description: `現在の人格を共有可能なPNGファイルとしてエクスポートする`,
      export_json_select_label: `JSONをエクスポート`,
      export_json_select_description: `任意：インポート可能なJSONファイルとしてエクスポート（アバター画像なし）`,
      persona_modal_title: `ペルソナを選択`,
      persona_select_label: `ペルソナ`,
      persona_select_description: `エクスポートするペルソナを選択してください。`,
      persona_select_placeholder: `ペルソナを選択...`,
      main_persona_description: `メインペルソナ`,
      alter_persona_description: `オルタペルソナ`,
      success_title: `🟢 ペルソナのエクスポートに成功しました`,
      success_description: `ペルソナ **{nickname}** がエクスポートされました！このPNGファイルを他の人と共有して、人格設定を広めましょう。`,
      success_description_json: `ペルソナ **{nickname}** がJSONファイルとしてエクスポートされました。

**注意:** このJSONは \`/persona import\` で再インポートできます。アバター画像は含まれないため、アバターも共有したい場合はPNGエクスポートをご利用ください。`,
      json_importable_note: `このJSONエクスポートは /persona import でインポートできます。アバター画像は含まれないため、アバターも共有したい場合はPNGエクスポートをご利用ください。`,
      failed_title: `🔴 エクスポートに失敗しました`,
      avatar_failed_title: `🔴 アバターのダウンロードに失敗しました`,
      avatar_failed_description: `ペルソナアバターのダウンロードに失敗しました。後でもう一度お試しください。`,
      embed_failed_title: `🔴 PNG処理に失敗しました`,
      embed_failed_description: `PNGファイルへのメタデータの埋め込みに失敗しました。もう一度お試しください。`,
      error_no_server_data: `データベースにサーバーが見つかりません。まず \`/setup\` を実行してください。`,
      error_no_preset_data: `ペルソナデータが見つかりません。まず /setup を実行してください。`,
      error_validation_failed: `エクスポートデータ構造の検証に失敗しました`,
      error_export_failed: `ペルソナデータのエクスポートに失敗しました`,
    },
    import: {
      description: `PNG、JSON、またはCHARXファイルからペルソナをインポートする`,
      file_description: `ペルソナデータを含むPNG、JSON、またはCHARXファイル`,
      type_description: `メインペルソナまたはオルタペルソナとしてインポート`,
      triggers_description: `任意の追加トリガー（カンマ区切り: "," または "、"）`,
      memories_description: `このペルソナの記憶（ユーザー・サーバー）を引き継ぎますか？`,
      memories_choice_preserve: `はい（ユーザー/サーバー記憶を引き継ぐ）`,
      memories_choice_fork: `いいえ（ユーザー/サーバー記憶を新しく開始する）`,
      type_choice_main: `メインペルソナ（現在の人格を置き換え）`,
      type_choice_alter: `オルタペルソナ`,
      success_title: `🟢 ペルソナのインポートに成功しました`,
      success_description: `ペルソナ **{nickname}** が正常にインポートされました！
属性: {attribute_count}
サンプル対話: {dialogue_count}
トリガーワード: {trigger_word_count}`,
      success_confirmation: `メインペルソナ **{nickname}** が正常にインポートされました！詳細なインポート情報がチャンネルに投稿されました。`,
      post_missing_permission: `ペルソナはインポートされましたが、確認メッセージを投稿できませんでした。管理者にこのチャンネルの {permission} 権限を付与してもらってください。`,
      nickname_update_success: `サーバーニックネームが更新されました。`,
      nickname_update_failed: `🟡 サーバーニックネームを更新できませんでした。Discordのレート制限が原因である可能性があります。手動で変更してください。`,
      avatar_update_success: `サーバーアバターが更新されました。`,
      avatar_update_skipped_no_image: `🟡 インポートしたファイルにはアバター画像が含まれていなかったため、現在のメインペルソナのアバターをそのまま維持しました。`,
      avatar_update_rate_limited: `🟡 Discordのレート制限によりサーバーアバターは更新されませんでした。手動で変更してください。`,
      avatar_update_failed: `🟡 サーバーアバターを更新できませんでした。Discordのレート制限が原因である可能性があります。手動で変更してください。`,
      alter_success_title: `🟢 オルタペルソナのインポートに成功しました`,
      alter_success_description: `オルタペルソナ **{nickname}** が正常にインポートされました！
固有トリガーワード: {trigger_count}
トリガー: {triggers}

これらのトリガーがメッセージに含まれると、このペルソナが応答します。`,
      alter_success_confirmation: `オルタペルソナ **{nickname}** が {trigger_count} 個の固有トリガーワードで正常にインポートされました！詳細なインポート情報がチャンネルに投稿されました。`,
      alter_avatar_fallback_main: `🟡 このインポートにはアバター画像が含まれていなかったため、このオルタはフォールバックとして **{nickname}** の現在のメインペルソナアバターを使用します。変更したい場合は \`/config\` > ペルソナ > アイデンティティと性格 を使用できます。`,
      alter_avatar_warning: `⚠️ 上記のアバター画像埋め込みを削除しないでください。削除するとオルタペルソナのアバターが失われます。`,
      alter_dm_not_allowed_title: `🔴 DMではオルタペルソナは許可されていません`,
      alter_dm_not_allowed_description: `オルタペルソナはサーバーでのみインポートできます。ダイレクトメッセージではインポートできません。サーバーでこのコマンドを実行してください。`,
      alter_no_triggers_warning: `⚠️ このペルソナにはトリガーワードがありません。\`/config\` > ペルソナ > アイデンティティと性格を使用してトリガーを追加するまで、メッセージに応答しません。`,
      alter_name_conflict_title: `🔴 ペルソナ名が既に存在します`,
      alter_name_conflict_description: `**{name}** という名前のペルソナは既にこのサーバーに存在します。各ペルソナには固有の名前が必要です。

インポートファイルを編集して別の名前を使用するか、\`/persona remove\`を使用して既存のペルソナを削除してください。`,
      alter_limit_title: `🔴 ペルソナ上限に達しました`,
      alter_limit_description: `このサーバーには既に {current} 個のペルソナがあります。上限は {max} 個です。\`/persona remove\` でオルタを削除してからインポートしてください。`,
      failed_title: `🔴 インポートに失敗しました`,
      failed_description: `ペルソナのインポートに失敗しました。ファイルを確認してもう一度お試しください。`,
      sprite_snapshot_failed_description: `現在のペルソナスプライトを読み込めないため、インポートを中止しました。ペルソナデータは変更されていません。もう一度お試しください。`,
      sprite_cleanup_failed_description: `ペルソナはインポートされましたが、以前のスプライト行を削除できませんでした。インポートは完了していません。管理者に連絡してください。`,
      sprite_storage_cleanup_partial_description: `ペルソナはインポートされましたが、以前のスプライト画像 {failed_count} 個をストレージから削除できませんでした。`,
      invalid_file_type_title: `🔴 無効なファイル形式`,
      invalid_file_type_description: `ペルソナデータを含む有効な.png、.json、または.charxファイルをアップロードしてください。`,
      file_too_large_title: `🔴 ファイルが大きすぎます`,
      file_too_large_description: `ファイルが大きすぎます。最大ファイルサイズは{max_size}MBです。`,
      download_failed_title: `🔴 ダウンロードに失敗しました`,
      download_failed_description: `添付ファイルのダウンロードに失敗しました。もう一度お試しください。`,
      invalid_charx_title: `🔴 無効なキャラクターカードアーカイブ`,
      invalid_charx_description: `この.charxファイルはCharacter Card V3アーカイブとして読み取れませんでした。配布元のサイトからカードを再ダウンロードするか、.png形式でエクスポートしたカードを使用してください。`,
      card_conversion_failed_title: `🟡 キャラクターカードを検出しましたが変換に失敗しました`,
      card_conversion_failed_description: `**{source}**からカードをデコードしましたが、Tomori形式への変換に失敗しました。デコードされた内容を検査用に添付しています。\`/support discord\`から、添付ファイルを付けて報告してください。`,
      charx_not_card_description: `この.charxアーカイブは開けましたが、中のカードはキャラクターカードではありません。同じダウンロードに含まれる別のアーカイブではなく、キャラクターカード本体であることを確認してください。`,
      charx_too_large_description: `このアーカイブ内のカードはインポートするには大きすぎます。カードの最大サイズは{max_size}MBです。`,
      charx_assets_too_large_description: `このカードはインポートで確認できる量を超えるメディアを同梱しています。画像、音声、動画のアセットを含めずにエクスポートしたカードをお試しください。`,
      charx_assets_ignored_description: `🟡 このカードに同梱されていた画像、音声、その他のメディアはインポートされませんでした。読み込まれたのはペルソナのテキストのみです。アバターは\`/server avatar\`で設定でき、スプライトは\`/config\` > ペルソナ > スプライトで追加できます。`,
      invalid_png_title: `🔴 無効なPNGファイル`,
      invalid_png_description: `アップロードされたファイルは有効なPNG画像ではありません。`,
      no_metadata_title: `🔴 ペルソナデータが見つかりません`,
      no_metadata_description: `このファイルには対応しているペルソナデータが含まれていません。\`/persona export\`でエクスポートしたファイル、または対応しているSillyTavernキャラクターカードを使用してください。`,
      invalid_file_title: `🔴 無効なペルソナファイル`,
      invalid_file_description: `ペルソナファイル形式が無効または互換性がありません。`,
      no_permission_title: `🔴 権限がありません`,
      no_permission_description: `ペルソナをインポートするには**サーバー管理**権限が必要です。`,
      error_download_timeout: `ファイルのダウンロードがタイムアウトしました。もう一度お試しください。`,
      error_invalid_attribute: `無効な属性内容: {details}`,
      error_attribute_flags_mismatch: `属性の公開設定フラグ数は属性リストの件数と一致する必要があります。`,
      error_invalid_dialogue_in: `無効なサンプル対話(入力): {details}`,
      error_invalid_dialogue_out: `無効なサンプル対話(出力): {details}`,
      error_invalid_trigger_word: `無効なトリガーワード: {details}`,
      error_dialogue_mismatch: `サンプル対話配列の長さが一致しません`,
      error_invalid_config: `ペルソナデータに無効な設定フィールドがあります`,
      error_no_server_data: `データベースにサーバーが見つかりません。まず \`/setup\` を実行してください。`,
      error_name_conflict: `**{name}** という名前のペルソナは既にこのサーバーに存在します。別の名前を使用してください。`,
      error_nsfw_persona: `このペルソナはNSFWに指定されているため、\`/persona import\`では読み込めません。代わりに\`/nsfw persona import\`を使ってください。`,
      error_import_failed: `ペルソナデータのインポートに失敗しました`,
      error_not_json: `インポートしたファイルには有効なJSONデータが含まれている必要があります`,
      error_incompatible_version: `互換性のないペルソナバージョン。期待: {expected}、実際: {actual}`,
      error_invalid_format: `無効なペルソナファイル形式`,
      error_invalid_type: `無効なペルソナタイプ: {type}。"preset"が期待されます`,
      avatar_update_skipped_dm: `ペルソナは正常にインポートされましたが、アバターとニックネームの更新はダイレクトメッセージでは利用できません。`,
      refresh_reminder: `この会話で人格の更新を適用するには\`/refresh\`を実行してください`,
    },
    remove: {
      description: `サーバーからオルタペルソナを削除する`,
      no_permission_title: `🔴 権限がありません`,
      no_permission_description: `オルタペルソナを削除するには**サーバー管理**権限が必要です。`,
      modal_title: `オルタペルソナの削除`,
      select_label: `オルタペルソナ`,
      select_placeholder: `削除するオルタペルソナを選択...`,
      no_alters_error_title: `🟡 オルタペルソナがありません`,
      no_alters_error_description: `削除するオルタペルソナがありません。\`/persona import type:alter\`を使用してオルタペルソナをインポートしてください。`,
      success_title: `🟢 オルタペルソナを削除しました`,
      success_description: `オルタペルソナ **{nickname}** が正常に削除されました。`,
    },
    default: {
      description: `人格設定のペルソナを適用します`,
      type_description: `適用先タイプ（デフォルトまたはオルタ）`,
      type_choice_default: `メインペルソナ（現在の人格を置き換え）`,
      type_choice_alter: `オルタペルソナ`,
      no_permission_title: `🔴 権限がありません`,
      no_permission_description: `人格プリセットを適用するには**サーバー管理**権限が必要です。`,
      modal_title: `人格プリセットの適用`,
      select_label: `人格プリセット`,
      select_description: `適用するプリセットを選択してください。これにより、現在の属性と対話が上書きされます。`,
      select_placeholder: `プリセットを選択...`,
      no_presets_title: `利用可能なプリセットがありません`,
      no_presets_description: `お使いの言語で利用できる人格プリセットがありません。\`/support discord\`で報告してください。`,
      preset_not_found: `選択されたプリセットが見つかりませんでした。`,
      success_title: `プリセットが適用されました`,
      success_details_description: `プリセット **{preset_name}** をペルソナ **{nickname}** に適用しました！
属性: {attribute_count}
サンプル対話: {dialogue_count}
トリガーワード ({trigger_word_count}): {triggers}`,
      success_confirmation: `ペルソナ **{nickname}** にプリセットを適用しました。詳細情報をこのチャンネルに投稿しました。`,
      avatar_update_failed: `🟡️ Discord APIエラーによりサーバーアバターを更新できませんでしたが、ペルソナは正常に適用されました。`,
      avatar_update_skipped_dm: `プリセットは正常に適用されましたが、アバター更新はダイレクトメッセージでは利用できません`,
    },
    import_now: {
      button: `今すぐインポート`,
      imported: `インポート済み`,
      already_imported_title: `🟡 インポート済み`,
      already_imported_description: `このペルソナはすでにインポートされたか、現在インポート処理中です。`,
    },
    generate: {
      description: `AIによる人格生成（対応プロバイダーが必要）`,
      modal: {
        title: `AI人格生成`,
        character_name_label: `キャラクター名`,
        character_name_description: `名前をカンマ（"," または "、"）区切りで入力してください。すべてトリガーワードとして追加され、先頭の名前が表示名になります。`,
        character_name_placeholder: `例: 初音ミク, ミク, Hatsune Miku`,
        character_info_label: `キャラクター情報と話し方の例`,
        character_info_description: `キャラクターとその話し方を説明してください`,
        character_info_placeholder: `性格、背景、話し方、例示のフレーズなど`,
        web_search_label: `ウェブ検索を使用しますか？`,
        web_search_description: `キャラクター情報を検索(既存メディアのキャラクター用)`,
        web_search_placeholder: `はいまたはいいえを選択`,
        web_search_yes: `はい、キャラクター情報を検索します`,
        web_search_no: `いいえ、オリジナルキャラクターを作成します`,
        additional_inst_label: `追加の指示`,
        additional_inst_placeholder: `任意：その他の指示（例：「キャラクターの返答は短くしてください」）`,
        file_upload_label: `キャラクター画像 / カード (任意)`,
        file_upload_description: `画像、Tomoriプリセット、またはSillyTavernカードPNGをアップロードして生成・変換`,
      },
      field_character_name: `キャラクター名`,
      field_character_info: `キャラクター情報と話し方の例`,
      field_web_search: `ウェブ検索を使用しますか？`,
      field_additional_inst: `追加の指示`,
      wrong_provider_title: `🔴 互換性のないプロバイダー`,
      wrong_provider_description: `ペルソナ生成には対応プロバイダーが必要です。現在のプロバイダーは **{current_provider}** です。\`/config\` > モデル > モデルの切り替えで対応プロバイダーに切り替えてください。`,
      no_api_key_title: `🔴 APIキーがありません`,
      no_api_key_description: `有効なプロバイダーが設定されていません。\`/setup\`（初回）または\`/providers\`で登録してください。`,
      model_incompatible_title: `互換性のないモデル`,
      model_incompatible_description: `現在のモデル（**{model_name}**）は、ペルソナ生成に必要な**構造化出力**をサポートしていません。

**次のステップ:**
\`/config\` > モデル > モデルの切り替えを使用して、構造化出力をサポートするモデル（例：「STRUCT」機能を持つモデル）に切り替えてください。`,
      image_vision_required_title: `🔴 画像ビジョンが必要`,
      image_vision_required_description: `画像がアップロードされましたが、現在のモデル（**{model_name}**）は**画像ビジョン**をサポートしておらず、ビジョンモデルも設定されていません。

**次のステップ:**
1. \`/config\` > モデル > モデルの切り替えを使用して専用ビジョンモデルを設定する、または
2. \`/config\` > モデル > モデルの切り替えを使用してビジョン対応モデルに切り替える、または
3. 画像を削除して画像なしで再生成する`,
      web_search_tools_required_title: `🔴 ウェブ検索を利用できません`,
      web_search_tools_required_description: `ウェブ検索が選択されましたが、現在のモデル（**{model_name}**）は**ツール**に対応していません。

**次のステップ:**
1. \`/config\` > モデル > モデルの切り替えを使用してツール対応モデルに切り替える、または
2. ウェブ検索なしで再生成する（質問されたら「いいえ」を選択）`,
      api_key_decrypt_failed_title: `🔴 APIキーエラー`,
      api_key_decrypt_failed_description: `有効なプロバイダー認証情報の復号化に失敗しました。\`/providers\`で再設定してください。`,
      vision_credentials_unavailable_title: `🔴 ビジョンモデルの認証情報を利用できません`,
      vision_credentials_unavailable_description: `ビジョンモデル（**{vision_model_name}**）はプロバイダー **{vision_provider}** で動作していますが、保存されたAPIキーを画像の説明に使用できませんでした。\`/providers\`でそのプロバイダーの認証情報を再設定するか、\`/config\` > モデルを確認してください。`,
      invalid_image_title: `🔴 無効な画像`,
      invalid_image_description: `有効な画像ファイル(PNG、JPG、JPEGなど)をアップロードしてください。`,
      error_file_too_large: `アバター画像は{max_size}MB以下である必要があります。`,
      error_download_timeout: `アバターのダウンロードがタイムアウトしました。もう一度お試しください。`,
      error_download_failed: `アバター画像のダウンロードに失敗しました。`,
      processing_title: `人格を生成しています...`,
      processing_description: `これには1～2分かかる場合があります。キャラクターを生成していますので、お待ちください...

これは予期しない結果が生成される場合があります。必要に応じて再生成できます。`,
      captioning_title: `画像を確認しています...`,
      captioning_description: `プライマリモデルは画像を認識できないため、まずビジョンモデル（**{model_name}**）にアップロードされた画像を説明してもらいます。その説明をもとにプライマリモデルが人格を生成します。1〜2分ほどかかる場合があります。`,
      generation_failed_title: `🔴 生成に失敗しました`,
      generation_failed_description: `人格の生成に失敗しました：{error}

異なる入力で再度お試しいただくか、APIキーを確認してください。`,
      vision_caption_failed_title: `🔴 画像の説明に失敗しました`,
      vision_caption_failed_description: `ビジョンモデル（**{vision_model_name}**、{vision_provider}）がアップロードされた画像を説明できませんでした。

**次の手順:**
1. \`/providers\` でそのプロバイダーのAPIキーを確認する、または
2. 画像を外して再生成する、または
3. \`/config\` > モデルで別のビジョンモデルを設定する`,
      validation_failed_title: `🔴 検証に失敗しました`,
      validation_failed_description: `生成された人格データの検証に失敗しました。もう一度お試しください。`,
      image_processing_failed_title: `🔴 画像処理に失敗しました`,
      image_processing_failed_description: `アップロードされた画像の処理に失敗しました。別の画像をお試しください。`,
      avatar_fetch_failed_title: `🔴 アバターの取得に失敗しました`,
      avatar_fetch_failed_description: `エクスポート用のサーバーアバターの取得に失敗しました。代わりに画像をアップロードしてみてください。`,
      metadata_embed_failed_title: `🔴 エクスポートに失敗しました`,
      metadata_embed_failed_description: `画像に人格データを埋め込むことができませんでした。もう一度お試しください。`,
      success_title: `🟢 {character_name} の生成に成功しました！`,
      success_description: `**{character_name}** の人格を生成しました！
**属性プレビュー:**
{attribute_preview}
**サンプル対話:**
{dialogue_preview}`,
      success_next_steps_title: `次のステップ`,
      success_next_steps_description: `1. 右側の添付PNGファイルをダウンロード
2. PNGファイルと共に\`/persona import\`を使用
3. \`/refresh\`を実行して新しい人格を適用
または「今すぐインポート」ボタンを押す`,
      success_next_steps_description_dm: `1. 添付されたPNGファイルをダウンロード
2. PNGファイルと共に\`/persona import\`を使用
3. \`/refresh\`を実行して新しい人格を適用`,
      success_next_steps_footer: `あとで\`/config\`でさらにカスタマイズできます。`,
      avatar_update_skipped_dm: `アバターとニックネームの更新はダイレクトメッセージでインポートできませんのでご注意ください。`,
    },
    create: {
      description: `シンプルな人格プリセットを手動で作成`,
      modal: {
        title: `ペルソナ作成`,
        character_name_label: `キャラクター名`,
        character_name_description: `名前をカンマ（"," または "、"）区切りで入力してください。すべてトリガーワードとして追加され、先頭の名前が表示名になります。`,
        character_name_placeholder: `例: 初音ミク, ミク, Hatsune Miku`,
        character_desc_label: `キャラクター説明`,
        character_desc_placeholder: `キャラクターを説明してください（性格、外見、背景など）`,
        example_user_label: `ユーザーメッセージの例`,
        example_user_description: `ヒント: インポート後に /persona sample-dialogue add で例を追加できます`,
        example_user_placeholder: `こんにちは、{bot}！`,
        example_bot_label: `ボット返信の例`,
        example_bot_placeholder: `こんにちは、{user}！お元気ですか？`,
        file_upload_label: `キャラクター画像 (任意)`,
        file_upload_description: `キャラクターエクスポート用の画像をアップロード`,
      },
      field_character_name: `キャラクター名`,
      field_character_desc: `キャラクター説明`,
      field_example_user: `ユーザーメッセージの例`,
      field_example_bot: `ボット返信の例`,
      invalid_image_title: `🔴 無効な画像`,
      invalid_image_description: `有効な画像ファイル(PNG、JPG、JPEGなど)をアップロードしてください。`,
      error_file_too_large: `アバター画像は{max_size}MB以下である必要があります。`,
      error_download_timeout: `アバターのダウンロードがタイムアウトしました。もう一度お試しください。`,
      error_download_failed: `アバター画像のダウンロードに失敗しました。`,
      desc_too_long_title: `説明が長すぎます`,
      desc_too_long_description: `キャラクターの説明が長すぎます（{current_length} 文字）。最大許容長は {max_allowed} 文字です。`,
      example_user_too_long_title: `ユーザーメッセージの例が長すぎます`,
      example_user_too_long_description: `ユーザーメッセージの例が長すぎます（{current_length} 文字）。最大許容長は {max_allowed} 文字です。`,
      example_bot_too_long_title: `ボット返信の例が長すぎます`,
      example_bot_too_long_description: `ボット返信の例が長すぎます（{current_length} 文字）。最大許容長は {max_allowed} 文字です。`,
      validation_failed_title: `🔴 検証に失敗しました`,
      validation_failed_description: `ペルソナデータの検証に失敗しました。もう一度お試しください。`,
      image_processing_failed_title: `🔴 画像処理に失敗しました`,
      image_processing_failed_description: `アップロードされた画像の処理に失敗しました。別の画像をお試しください。`,
      avatar_fetch_failed_title: `🔴 アバターの取得に失敗しました`,
      avatar_fetch_failed_description: `エクスポート用のサーバーアバターの取得に失敗しました。代わりに画像をアップロードしてみてください。`,
      metadata_embed_failed_title: `🔴 エクスポートに失敗しました`,
      metadata_embed_failed_description: `画像に人格データを埋め込むことができませんでした。もう一度お試しください。`,
      success_title: `🟢 {character_name} の作成に成功しました！`,
      success_description: `**説明:**
{character_description}`,
      success_dialogue_title: `サンプル対話`,
      success_next_steps_title: `次のステップ`,
      success_next_steps_description: `1. 右側の添付PNGファイルをダウンロード
2. PNGファイルと共に\`/persona import\`を使用
3. \`/refresh\`を実行して新しい人格を適用
または「今すぐインポート」ボタンを押す`,
      success_next_steps_footer: `あとで\`/config\`でさらにカスタマイズできます。`,
      avatar_update_skipped_dm: `アバターとニックネームの更新はダイレクトメッセージでは利用できませんのでご注意ください。`,
    },
  },
};
