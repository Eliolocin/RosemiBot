export default {
  help: {
    description: `セットアップ、機能、プロバイダー、メモリ、動作、ツール、メディア、連携のガイドを表示します。`,
    dashboard: {
      categories: {
        setup: `セットアップ`,
        features: `機能`,
        moderation: `モデレーション`,
        plugins: `プラグイン`,
      },
      pages: {
        custom_endpoints: `カスタムエンドポイント`,
      },
      page_reference: `\`/help\`内の **{page}** ページ`,
      page_select_placeholder: `ページを選択`,
      subsection_select_placeholder: `トピックを選択`,
      provider_select_placeholder: `プロバイダーを選択`,
      optional_provider_select_placeholder: `オプションサービス`,
      previous_button: `← 前へ`,
      next_button: `次へ →`,
      docs_link_label: `ウェブ版を読む`,
      support_link_label: `技術サポートを受ける`,
      sections: {
        getting_started: `はじめに`,
        getting_started_description: `キー、トリガー、ペルソナと次に試すべきこと`,
        personal_profile: `個人プロフィール`,
        personal_profile_description: `ニックネーム、個人の記憶、自分専用のプロバイダー`,
        custom_endpoints: `カスタムエンドポイント（高度）`,
        custom_endpoints_description: `自分で運用・信頼するエンドポイントを登録します`,
        multiple_personas: `複数のペルソナ`,
        multiple_personas_description: `複数のアイデンティティを保持し、キャラクターカードをインポート`,
        media_generation: `メディア生成`,
        media_generation_description: `画像、動画、音声メッセージを作成します`,
        tons_of_tweakability: `豊富なカスタマイズ性`,
        tons_of_tweakability_description: `動作、サーバー、個人の設定がある場所`,
        memory: `メモリ`,
        memory_description: `私が記憶している内容と、その保持期間`,
        scheduled_tasks: `スケジュールタスク`,
        scheduled_tasks_description: `リマインダーや自動的に再開するタスク`,
        server_moderation: `サーバーモデレーション`,
        server_moderation_description: `ここでの利用許可と、許可される場所`,
        quotas: `クォータ`,
        quotas_description: `このサーバーで許可される生成量の上限`,
        age_restricted_commands: `年齢制限コマンド`,
        age_restricted_commands_description: `成人向け機能と、私がフィルタリングしない内容`,
        user_byok: `ユーザーBYOK（高度）`,
        user_byok_description: `全メンバーに自身のキーを用意させます`,
        sillytavern_presets: `SillyTavern プリセット`,
        sillytavern_presets_description: `インポートしたプリセットからプロンプトを構築します`,
        mcp_servers: `MCP サーバー`,
        mcp_servers_description: `私が実際に使用できる外部ツールを接続します`,
        matrix: `Matrix`,
        matrix_description: `MatrixルームとDiscordチャンネルをブリッジします`,
      },
      subsections: {
        get_api_key: `APIキーの取得`,
        get_api_key_description: `取得場所と、安全な保管方法`,
        change_trigger_behavior: `トリガー動作の変更`,
        change_trigger_behavior_description: `私が応答を許可されるタイミングと場所`,
        create_first_persona: `最初のペルソナの作成`,
        create_first_persona_description: `私を編集、新規作成、またはインポートします`,
        explore_features: `機能を探索する！`,
        explore_features_description: `話せるようになった私にできることの簡単な紹介`,
        nickname_pronouns: `ニックネームと代名詞`,
        nickname_pronouns_description: `すべてのサーバーでの、あなたの呼び方`,
        personal_memories: `個人の記憶`,
        personal_memories_description: `あなたについて具体的に記憶していること`,
        personal_providers: `個人用プロバイダー（高度）`,
        personal_providers_description: `自身のキーとモデルで応答します`,
        text_models: `テキストモデル`,
        text_models_description: `チャットエンドポイントとそのモデルを登録します`,
        comfyui: `ComfyUI（動画と画像用）`,
        comfyui_description: `ワークフローをアップロードしてそこから生成します`,
        text_to_speech: `音声合成（音声用）`,
        text_to_speech_description: `各ペルソナに本当の声を割り当てます`,
        image_generation: `画像生成`,
        image_generation_description: `プロンプトや現在のシーンを描画します`,
        video_generation: `動画生成`,
        video_generation_description: `短いクリップを、任意の最初のフレームから作成します`,
        speech_generation: `音声生成`,
        speech_generation_description: `テキストを音声メッセージに変換します`,
        art_search: `イラスト検索`,
        art_search_description: `Danbooruから既存のアニメイラストを投稿します`,
        behavior_tuning: `動作の調整`,
        behavior_tuning_description: `モデル、ヒューマナイザー、指示、ツールについて`,
        server_wide_settings: `サーバー全体の設定`,
        server_wide_settings_description: `ここの全員に適用される境界線`,
        personal_settings: `個人設定`,
        personal_settings_description: `すべてのサーバーでの、あなたの環境設定`,
        long_term_memory: `長期記憶`,
        long_term_memory_description: `私が永続的に保持する事実`,
        short_term_memory: `短期記憶`,
        short_term_memory_description: `この会話における私の作業メモ`,
        rewards_punishments: `ご褒美と罰`,
        rewards_punishments_description: `私が気づいて記憶するジェスチャー`,
        memory_tagging: `メモリのタグ付け（高度）`,
        memory_tagging_description: `関連がある時だけメモリを呼び起こします`,
        blacklisting: `ブラックリスト化`,
        blacklisting_description: "特定のメンバーを完全に無視させます",
      },
    },
    breadcrumbs: {
      persona: {
        general: `ペルソナ > アイデンティティと性格`,
        advanced: `ペルソナ > 高度な設定`,
        voice: `ペルソナ > 音声`,
        sprites: `ペルソナ > スプライト`,
        triggers: `ペルソナ > トリガー`,
      },
      behavior: {
        general: `動作 > 一般的な動作`,
        trigger: `動作 > トリガーの動作`,
        memory: `動作 > 高度な記憶`,
      },
      channels: {
        destinations: `チャンネル > ログと歓迎`,
        "auto-trigger": `チャンネル > 自動トリガー`,
        overrides: `チャンネル > チャンネルの個別設定`,
      },
      plugins: {
        "available-tools": `プラグイン > 利用可能なツール`,
        "mcp-servers": `プラグイン > MCPサーバー`,
        "sillytavern-presets": `プラグイン > SillyTavernプリセット`,
      },
      models: {
        switch: `モデル > モデルの切り替え`,
        voices: `モデル > TTSパラメーターと音声`,
        image: `モデル > 画像生成のデフォルト`,
        parameters: `モデル > テキストサンプラーとパラメーター`,
      },
      personal: {
        profile: {
          general: `プロフィール > 一般的な設定`,
        },
        privacy: {
          controls: `プライバシー > プライバシー制御`,
        },
        models: {
          switch: `モデル > モデルの切り替え`,
        },
        advanced: {
          spotlight: `高度な設定 > パーソナルスポットライト`,
        },
      },
      moderation: {
        "member-access": `メンバーアクセス`,
        "user-blacklist": `ユーザーブラックリスト`,
        whitelist: `ホワイトリスト`,
        quotas: `クォータ`,
      },
    },
    features: {
      title: `TomoriBotの機能（バージョン {version}）`,
    },
    matrix: {
      bot_user_fallback: `設定されているMatrixボットアカウント`,
    },
    "api-key": {
      provider_choice_brave: `Brave Search`,
      provider_choice_google: `Google Gemini（おすすめ、無料）`,
      provider_choice_deepseek: `DeepSeek`,
      provider_choice_custom: `カスタムエンドポイント`,
      provider_choice_nvidia: `NVIDIA NIM（無料）`,
      provider_choice_novelai: `NovelAI`,
      provider_choice_openrouter: `OpenRouter（おすすめ）`,
      provider_description_google: `汎用性が高く、寛大な無料利用枠があります`,
      provider_description_openrouter: `有料ですが信頼性と柔軟性が高く、画像・動画・音声も生成可能`,
      provider_description_deepseek: `比較的検閲が少ない、より安価な有料の選択肢`,
      provider_description_novelai: `無検閲のロールプレイ、物語、画像生成向け`,
      provider_description_nvidia: `ホスト型のテキスト、埋め込み、画像モデル`,
      provider_description_zai: `GLMのテキスト・画像モデル。コーディング用途の制限あり`,
      provider_description_vertexexpress: `APIキー認証でGoogle CloudのGeminiを利用`,
      provider_description_vertex: `Google Cloud認証情報で企業向けGeminiを利用`,
      provider_description_custom: `セルフホストやプロキシ用。認証は任意の場合あり`,
      provider_description_brave: `任意のウェブ、画像、動画、ニュース検索`,
      provider_description_elevenlabs: `音声生成・文字起こし用。テキストモデルではありません`,
      provider_choice_zai: `Z.ai`,
      provider_choice_vertex: `Google Vertex AI`,
      provider_choice_vertexexpress: `Google Vertex AI Express`,
      provider_choice_elevenlabs: `ElevenLabs TTS`,
      brave_title: `Brave Search APIキーの設定`,
      brave_description: `Brave Searchはオプションで、検索機能を強化するだけです。これは私のAIを動かすものではありません（それはメインプロバイダーが担当します）。
- 画像、動画、ニュース検索を有効化
- インターネットからリアルタイム情報を提供
- 最新の質問に答える能力を強化`,
      brave_getting_key_title: `APIキーの取得：`,
      brave_getting_key_description: `1. [Brave Search API](https://brave.com/search/api/)にアクセス
2. 無料アカウントに登録
3. ダッシュボードの[APIキー](https://api-dashboard.search.brave.com/app/keys)セクションに移動
4. 新しいAPIキーを作成
5. {configBraveapiSet}コマンドでAPIキーをコピーして入力`,
      brave_important_title: `重要な注意事項：`,
      brave_important_description: `- これはメインAIプロバイダーとは別です
- Brave APIキーがなくても、組み込みウェブ検索で機能します
- Braveでは毎月5ドル分の無料クレジットが含まれますが、それを超えると課金される場合があります。無料枠だけ使いたい場合は、[Braveの使用量上限ダッシュボード](https://api-dashboard.search.brave.com/app/subscriptions/usage-limits)で使用量上限を5ドルに設定してください`,
      brave_footer: `メインAIプロバイダーについては、\`/help\`のAPIキーページで別のプロバイダーを選んでください`,
      google_title: `Google Gemini APIキーの設定`,
      google_description: `Google Geminiは強力なAIモデルを備えた無料および有料プランを提供します。
- 無料プランの利用が可能
- [Geminiプライバシーポリシー](https://ai.google.dev/gemini-api/terms)`,
      google_getting_key_title: `APIキーの取得：`,
      google_getting_key_description: `1. [Google AI Studio](https://aistudio.google.com/apikey)にアクセス
2. 右上の\`Create API Key\`をクリック（必要に応じて新しいプロジェクトを作成）
3. このAPIキーを{configSetup}または{configApikeySet}にコピー`,
      google_footer: `このプロバイダーを設定したら、{configModel}でデフォルトモデルを変更できます`,
      deepseek_title: `DeepSeek APIキーの設定`,
      deepseek_description: `DeepSeekは従量課金制のテキストプロバイダーです。
- [DeepSeek APIドキュメント](https://api-docs.deepseek.com/)`,
      deepseek_getting_key_title: `APIキーの取得：`,
      deepseek_getting_key_description: `1. [DeepSeek API Keys](https://platform.deepseek.com/api_keys)にアクセス
2. DeepSeekのプラットフォームアカウントにログイン、または新規作成
3. 新しいAPIキーを作成
4. 必要に応じて、使用前にDeepSeekプラットフォームアカウントへ残高を追加
5. このAPIキーを{configSetup}または{configApikeySet}にコピー`,
      deepseek_footer: `このプロバイダーを設定したら、{configModel}でデフォルトモデルを変更できます`,
      custom_title: `カスタムエンドポイントのセットアップ`,
      custom_description: `旧来のインラインなカスタムプロバイダーフローは移動しました。

サーバー単位のエンドポイントは、{configSetup} で **カスタムエンドポイント（セットアップ後に完了）** を選び、その後 {configCustomModelsAdd} を実行してから {configModel} で有効化してください。

個人用エンドポイントは {personalCustomModelsAdd} を使用してください。

対応エンドポイント種類や機能についての詳細は {helpCustomModels} を参照してください。`,
      nvidia_title: `NVIDIA NIM APIキーの設定`,
      nvidia_description: `NVIDIA NIMは、NVIDIA Build経由でホスト型のテキスト・埋め込み・画像APIを提供します。`,
      nvidia_getting_key_title: `APIキーの取得：`,
      nvidia_getting_key_description: `1. [NVIDIA Build](https://build.nvidia.com/)にアクセス
2. NVIDIA開発者アカウントでログイン、または新規作成
3. [API Keysページ](https://build.nvidia.com/settings/api-keys)でAPIキーを作成または管理
4. このAPIキーを{configSetup}または{configApikeySet}にコピー`,
      nvidia_important_title: `重要な注意事項：`,
      nvidia_important_description: `- テキストと埋め込みはNVIDIAのホスト型 \`integrate.api.nvidia.com\` を使用します
- ネイティブ画像生成はNVIDIAホストの \`ai.api.nvidia.com\` FLUXエンドポイントを使用します`,
      nvidia_footer: `設定後、{configModel}、{configModelEmbedding}、{configModelImage}でモデルを変更できます`,
      zai_title: `Z.ai APIキーの設定`,
      zai_description: `Z.aiは、汎用APIと別個のCodingエンドポイントを通じてGLMファミリーへアクセスできます。

⚠️ **利用規約の更新：** Z.aiの利用規約が更新され、コーディング/エージェントのユースケースのみが許可されるようになりました。汎用エンドポイントをチャットに使用する場合、自己責任となり規約に違反する可能性があります。`,
      zai_getting_key_title: `APIキーの取得：`,
      zai_getting_key_description: `1. [Z.aiプラットフォーム](https://z.ai)にアクセス
2. ログインまたはアカウントを作成
3. ダッシュボードでAPIキーに移動
4. 新しいAPIキーを作成
5. このAPIキーを{configSetup}または{configApikeySet}にコピー`,
      zai_important_title: `重要な注意事項：`,
      zai_important_description: `- 通常のチャット、推論、ネイティブ画像生成には汎用エンドポイントを使用します
  - 専用のCodingエンドポイントは別扱いで、コーディング特化ワークフロー向けです
  - ⚠️ Z.aiの規約はコーディング/エージェント用途に制限されています。一般チャットやロールプレイでの使用は自己責任です`,
      zai_footer: `このプロバイダーを設定したら、{configModel}でデフォルトモデルを変更できます`,
      novelai_title: `NovelAI APIキーの設定`,
      novelai_description: `NovelAIはクリエイティブなストーリーテリングとロールプレイに焦点を当てたサブスクリプションベースのサービスです。
- 無制限の無検閲メッセージ
- 無検閲のテキスト生成と、別途設定するNovelAI画像生成に対応
- NovelAIのテキストモデルはビジョン入力に未対応
- [NovelAI利用規約](https://novelai.net/terms)`,
      novelai_getting_key_title: `APIキーの取得：`,
      novelai_getting_key_description: `1. [NovelAI](https://novelai.net/stories)にアクセス
2. 左上の⚙️アイコンから設定に移動
3. \`Account\`に移動
4. \`Get Persistent API Token\`を探す（購読申し込みが必要です！）
5. このAPIキーを{configSetup}または{configApikeySet}にコピー`,
      novelai_footer: `このプロバイダーを設定したら、{configModel}でデフォルトモデルを変更できます`,
      openrouter_title: `OpenRouter APIキーの設定`,
      openrouter_description: `OpenRouterは従量課金制で複数のプロバイダーの様々なAIモデルへのアクセスを提供します。
 - 最新かつ最も強力なAIモデルへのアクセス（無料もあります）
 - [OpenRouter利用規約](https://openrouter.ai/terms)`,
      openrouter_getting_key_title: `APIキーの取得：`,
      openrouter_getting_key_description: `1. [OpenRouter](https://openrouter.ai/settings/keys)にアクセス
2. \`Create API Key\`をクリック
3. このAPIキーを{configSetup}または{configApikeySet}にコピー`,
      openrouter_important_title: `重要な注意事項：`,
      openrouter_important_description: `- **無料モデルは厳格なレート制限があります**。通常は有料モデルの方が安定します
- モデルを選ぶ前に**必ず料金を確認**してください
- OpenRouterアカウント側の設定もそのまま適用されます
- 一覧にないモデルが必要なら{supportServer}で提案してください`,
      openrouter_footer: `このプロバイダーを設定したら、{configModel}でデフォルトモデルを変更できます`,
      vertex_title: `Google Vertex AIの設定`,
      vertex_description: `Google Vertex AIは、Google Cloudを通じてGeminiモデルへのエンタープライズグレードのアクセスを提供します。
- 認証にApplication Default Credentials（ADC）を使用し、APIキーの管理は不要です
- ローカルのgcloud ADC、またはホスト環境のワークロードID・サービスアカウントを使用
- [Vertex AIドキュメント](https://cloud.google.com/vertex-ai/docs)`,
      vertex_getting_key_title: `設定手順：`,
      vertex_getting_key_description: `**手順1: [Google Cloud CLI](https://cloud.google.com/cli)をインストール**

**手順2: Google Cloudプロジェクトを作成**
\`gcloud projects create PROJECT_ID --name="Vertex AI Project"\`を実行
（\`PROJECT_ID\` をグローバルに一意のIDに置き換えてください。例：\`my-vertex-project-12345\`）

**手順3: アクティブプロジェクトに設定**
\`gcloud config set project PROJECT_ID\`を実行

**手順4: 請求先アカウントを紐付け**
\`gcloud billing accounts list\` で請求先アカウントIDを確認し、
\`gcloud billing projects link PROJECT_ID --billing-account=ACCOUNT_ID\` を実行

**手順5: Vertex AI APIを有効化**
\`gcloud services enable aiplatform.googleapis.com\`を実行

**手順6: Application Default Credentialsを設定**
\`gcloud auth application-default login\` を実行してブラウザでログイン

**手順7: 設定を入力**
{configSetup}または{configApikeySet}で \`{project_id}::{location}\` の形式で入力
- ロケーションは \`global\` を推奨（プレビューモデル対応と最高の可用性のため）
- 例：\`my-vertex-project-12345::global\``,
      vertex_important_title: `重要な注意事項：`,
      vertex_important_description: `- 保存される値は**設定情報**（プロジェクト＋ロケーション）であり、認証情報のシークレットではありません
- すべてのVertexリクエストはホストのApplication Default Credentials IDを使用します
- AI StudioのAPIキーだけでは認証できません。プロジェクトで請求とAPIを有効にし、ホストにVertexアクセス権が必要です。
- チャット、ツール呼び出し、ストリーミング、構造化出力、圧縮、埋め込み、プリセット生成に対応`,
      vertex_footer: `このプロバイダーを設定したら、{configModel}でデフォルトモデルを変更できます`,
      vertexexpress_title: `Google Vertex AI Expressの設定`,
      vertexexpress_description: `Google Vertex AI Expressは、Vertex AI上のGeminiへAPIキーでアクセスできるモードです。
- ホスト側のApplication Default Credentialsではなく、自分のGoogle Cloud APIキーを使用します
- 各ユーザーが自分のキーを保存するBYOK（Bring Your Own Key）運用に最適です
- Gemini限定の小さめなモデルカタログを持つPreview機能です
- [Vertex AI Express Mode概要](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/overview)`,
      vertexexpress_getting_key_title: `設定手順：`,
      vertexexpress_getting_key_description: `1. [Vertex AI Express Mode](https://console.cloud.google.com/expressmode) を開く
2. 標準のGoogle Cloudにリダイレクトされる場合は、別プロバイダーの \`vertex\` を使ってください。これは、Express ModeがまだGCPアカウントの請求設定をしていないGoogleアカウントでのみ機能するためです。
3. Expressコンソールで **APIs & Services > Credentials** を開き、ExpressのAPIキーをコピー
4. その生のAPIキーを {configSetup} または {configApikeySet} で追加
5. {configModel} でVertex AI Expressモデルを選択`,
      vertexexpress_important_title: `重要な注意事項：`,
      vertexexpress_important_description: `- 保存するのは \`{project_id}::{location}\` ではなく、生のAPIキーです
- ここではロケーション設定は不要です。\`global\` は別の \`vertex\` プロバイダー用です
- フルGoogle CloudのVertexプロジェクトは \`vertexexpress\` ではなく \`vertex\` を使ってください
- 利用できるモデルはVertex AI Express対応のGeminiカタログに限定されます
- 画像生成には対応しますが、動画と埋め込みには対応しません
- Express Modeは現在GoogleのPreview機能です`,
      vertexexpress_footer: `このプロバイダーを設定したら、{configModel}でデフォルトモデルを変更できます`,
    },
    elevenlabs: {
      description: `ElevenLabs音声合成の設定方法を学ぶ`,
      title: `ElevenLabs TTSの設定`,
      getting_key_title: `APIキーの取得：`,
      getting_key_description: `1. [ElevenLabs](https://elevenlabs.io/app/settings/api-keys)にアクセス
2. アカウントにサインアップまたはサインイン
3. 新しいAPIキーを作成
4. {configSpeechElevenlabs}を使用してAPIキーをコピー`,
      choosing_voice_title: `ボイスの選択：`,
      choosing_voice_description: `APIキーを設定したら、{configSpeechVoiceAssign}を使って利用可能なボイスを参照します。
- [Voice Library](https://elevenlabs.io/app/voice-library)からボイスを追加でき、自分の声のクローンも作成できます。`,
      free_voices_title: `プリメイド音声（無料プラン）：`,
      free_voices_description: `無料プランではプリメイド音声のみ機能します。[ElevenLabs Premade Voices](https://elevenlabs-sdk.mintlify.app/voices/premade-voices)の完全なリストを確認し、{configSpeechElevenlabs}または{configSpeechVoiceAssign}を使用して各ペルソナに割り当てます。`,
      important_notes_title: `重要な注意事項：`,
      important_notes_description: `- 私が音声メッセージを生成して読み上げるときに文字数がカウントされます
- 無料プランには月間制限があります。ElevenLabsダッシュボードで使用量を確認してください
- 表示用の文字起こし投稿は{configSpeechTranscripts}で個別に制御されます`,
      footer: `ElevenLabsキーを更新するには{configSpeechElevenlabs}を再実行してください。`,
    },
    getting_started: {
      title: `はじめに`,
      description: `私と私の機能を使い始めるためのガイド`,
      get_api_key: {
        title: `APIキーの取得`,
        description:
          "APIキーにより、私はAIプロバイダーのモデルにアクセスできます。 生成するものはすべてそのキーに請求されるため、 他のパスワードと同様に扱ってください。 セットアップを完了するには、キーが1つ必要です：\n> **1.** 下からプロバイダーを選んでガイドを開きます。\n> **2.** 表示されたキーをコピーします。**絶対に共有しないで** ください。また、チャンネルに貼り付けず、{setup}が 開く入力ボックスにのみ貼り付けてください。\n> **3.** {setup}を実行し、求められたらキーを貼り付けます。",
        picker_footer:
          "-# 目的のエンドポイントがリストにない場合は、キー設定をスキップして、このページの **カスタムエンドポイント（高度）** を読んでください。",
      },
      change_trigger_behavior: {
        title: `トリガー動作の変更`,
        description:
          "初期状態では、あなたが私の名前を呼ぶか、メンションするか、 返信した時に応答します。チャンネルごとにこの条件を広げたり、 狭めたり、オフにしたりできます。\n\n**私が発言を許可される場所**\nホワイトリストに登録されたチャンネルでのみ応答させることができます。 {moderationWhitelist} で追加してください。\n> リストにないチャンネルでは沈黙を保ちます。\n\n**自分から発言する**\n{configAutoTrigger} を使うと、数メッセージごとに、 またはランダムに自動でメッセージを送信できます。\n\n**メンションでのみトリガー**\n意図的なトリガーモードでは、単に名前を呼ばれただけでは応答しません。 @メンションを待つようになります。 {configBehaviorTrigger} でオンにできます。",
      },
      create_first_persona: {
        title: `最初のペルソナの作成`,
        description:
          "*ペルソナ*は、別の名前、アバター、性格などを持ちながら、 同じ機能を備えた私です！ 既存のペルソナを編集するか、 新しいペルソナを作成できます。\n\n**既存のペルソナを変更する**\n{configPersonaGeneral}で名前、性格、呼び方を設定します。 {configPersonaAppearance}でアバターを設定します。\n\n**1つの文章から新しく作成する**\n{personaGenerate}は短い説明からペルソナ全体を構築します。 {personaCreate}は空白のテンプレートを提供します。\n\n**別の場所から取り込む**\n{personaImport}はbotbooruやchubなどのカードサイトから ダウンロードしたキャラクターカードを受け入れます。",
        footer: "一度に複数のペルソナを保持できます。機能の **複数のペルソナ** を参照してください。",
      },
      explore_features: {
        title: `機能を探索する！`,
        description:
          "セットアップが完了しました。話せるようになった私にできることは以下の通りです。\n- {expressionsInitialize} を実行すると、**このサーバーの絵文字とスタンプを使用**できます。\n- {configWelcome} から**新しいメンバーに挨拶**します。\n- **記憶とリマインダー**: リマインドを頼むか、 覚えておく価値のあることを私に伝えてください。\n- **ウェブ検索**などの機能は、{configTools}でオンにできます。\n- {generateImage}、{generateVideo}、{generateVoice}で **画像、動画、音声を作成**できます。\n\n私のスイッチのほとんどは{config}にありますが、すべてではありません。",
        footer:
          "**Brave Search**は、私が既に行う検索にウェブ結果を追加します。 独自のキーが必要で、セットアップの下の **APIキーの取得** から オプションサービスとしてガイドを開くことができます。 ドキュメントサイトはこのパネルの完全版で、すべての設定を詳しく説明しています。",
      },
    },
    personal_profile: {
      title: `個人プロフィール`,
      description: "あなたに属し、私がいるすべてのサーバーに 引き継がれる設定です。",
      nickname_pronouns: {
        title: `あなたのニックネームと代名詞`,
        description:
          "私のすべての場所でのあなたの呼び方を教えてください。\n\n{personalProfile}で設定します。\n> ニックネーム: Discord名の代わりに私があなたを呼ぶ名前\n> プレフィックスとサフィックス: `-san`のような称号や敬称\n> 代名詞: `彼女/彼女の`、`彼ら/彼らの`、`任意`、またはあなたの名前\n\nフィールドを空白のままにすると、現在のDiscord名と ペルソナ自身の命名の癖にフォールバックします。",
        footer:
          "単一のペルソナが別の呼び方をすることもできます。それは プロフィール > ペルソナ固有の環境設定で設定します。",
      },
      personal_memories: {
        title: `個人の記憶`,
        description:
          "すべてのサーバーで、あなたについて具体的に記憶していること。\n\n**話しかけるだけ**\nチャットで言えば、自分で保存します。このとき、 確認メッセージが表示されます。\n\n**または手動で管理する**\n{personalMemories}は私が保持しているあなたに関するすべてをリストし、 個々のエントリを編集または削除できます。\n\n**私が使用できる量を決定する**\n{personalPrivacy}は、完全なパーソナライズから パーソナライズなしまで、プライバシーレベルを設定します。",
        footer: "これらは、ここの誰でも閲覧および編集できる サーバーの共有メモリとは別物です。",
      },
      personal_providers: {
        title: `個人用プロバイダー（高度）`,
        description:
          "あなたが私に話しかけるすべての場所で、サーバーが使用するもの の代わりに、あなた自身のAPIキーとモデルで応答します。\n\n**プロバイダーを保存する**\n{personalProviders}はあなたのキーを保存し、 すぐに個人用テキストモデルをオンにします。\n\n**別のモデルを選ぶ**\n{personalModels}でモデルを切り替え、サンプラーと フォールバックも同じカテゴリにあります。\n> 個人設定は、あなたがトリガーした応答にのみ影響します。\n> サーバー内の他の誰にも切り替わりません。\n\nこれを必須とするサーバーもあります。ユーザーBYOKがオンの場合、 ここでプロバイダーを保存するまで応答できません。",
      },
    },
    custom_endpoints: {
      title: `カスタムエンドポイント（高度）`,
      description:
        "Ollama、LM Studio、LiteLLM、KoboldCPP、ComfyUI、または セルフホストの音声サーバーなど、あなたが運用または信頼する エンドポイントを指定します。\n> {providers} はサーバー全体に登録します。\n> {personalProviders} はあなた専用に登録します。",
      text_models: {
        title: `テキストモデル`,
        description:
          "**新しいカスタムエンドポイントを追加** を選択し、ラベル、 ベースURL、APIスタイルを入力します。必要に応じて 認証トークンを追加します。\n\n保存したラベルを選択し、**+ 新しいテキストモデルを追加** を選び、 エンドポイントが想定する正確なモデルコードを入力します。モデルを 追加すると有効になります。\n> ビジョン、ツール使用、構造化出力を正確に申告してください。\n> 何を送信するか決定する際にこれらのフラグを信頼します。\n\n後で {configSwitchModels} から切り替えることができます。",
        footer: "完全なAPIスタイルと互換性のリファレンスは、 ドキュメントサイトにあります。",
      },
      comfyui: {
        title: `ComfyUI（動画と画像用）`,
        description:
          "まずComfyUIでワークフローを構築・テストし、 **Save (API Format)** でエクスポートします。\n\nプロンプトのプレースホルダーをプロンプトの位置に配置し、 サイズ、長さ、またはモデルコードを注入したい場所に 他のプレースホルダーを配置します。\n\nAPIの互換性を `ComfyUI` としてエンドポイントを登録し（例： `http://127.0.0.1:8188`）、そこに画像または動画モデルを 追加してエクスポートしたJSONをアップロードします。\n> グラフは実際の保存ノードで終わる必要があります。プレビュー のみのノードでは、ダウンロードするファイルが残りません。",
        footer:
          "既製のワークフローはGitHubリポジトリに同梱されており、 完全なプレースホルダーリストはドキュメントサイトにあります。",
      },
      text_to_speech: {
        title: `音声合成（音声用）`,
        description:
          "同様に音声エンドポイントを登録し、 各ペルソナに音声を割り当てます。\n\nホスト型サービスとセルフホスト型サーバーの両方が機能し、 Chatterbox-Turbo、Qwen3-TTS、IrodoriTTS、ElevenLabsなどがあります。 エンドポイントを登録し、音声モデルを追加します。\n> {configPersonaVoice} で音声を割り当てます。\n> {configVoices} で速度とデフォルトを調整します。",
        footer:
          "あなたが送信する音声メッセージは、同じように設定された 同じエンドポイントリストを通じて文字起こしされます。ホスト型の 音声については、ElevenLabs独自のガイドがセットアップの下の **APIキーの取得** のオプションサービス一覧にあります。",
      },
    },
    multiple_personas: {
      title: `複数のペルソナ`,
      description:
        "1つのサーバーに複数のペルソナを持つことができ、それぞれが 独自の名前、記憶、アジェンダを持っています！",
      mains_alters_title: `メインとオルタ`,
      mains_alters_body:
        "メインペルソナは、サーバーで私を代表するペルソナです。 オルタは、メッセージ自体に独自の名前とアバターを持ち、 私が別のアイデンティティとして話すことができる2つ目の人格です。",
      bringing_in_title: `ペルソナを取り込む`,
      bringing_in_body:
        "{personaImport} はキャラクターカードをファイルとして受け入れます：\n> `.png` カード、TomoriBot または SillyTavern から\n> `.json` カード、TomoriBot または SillyTavern から\n> `.charx` アーカイブ、Character Card V3\n\nキャラクターのテキストのみが読み込まれます。現在、同梱されたスプライト、 音声、動画はスキップされるため、{configPersonaAppearance} と {configPersonaSprites} で自分で設定してください。",
      where_to_find_title: `カードを見つける場所`,
      where_to_find_body:
        "{personaGenerate} または {personaCreate} で独自に作成するか、 すでに存在するものを探します。\n\nbotbooruやchubなどのカードサイトは何千ものカードを ホストしています。他のボット用に書かれたカードは きれいに変換されない場合があります。",
      talking_title: `お互いに話させる`,
      talking_body:
        "{configPersonaTriggers} で各ペルソナに独自のトリガーワードと チャンネルを与えると、同じ会話で並んで応答します。",
      footer: `{personaExport} で自分自身のものを共有できます。`,
    },
    media_generation: {
      title: `メディア生成`,
      description:
        "コマンドまたは会話中の要求に応じて、画像、動画、および 音声を作成できます。\n> それぞれがサーバーのクォータを消費します。モデレーションの下の **クォータ** を参照してください。",
      image_generation: {
        title: `画像生成`,
        description:
          "{generateImage} でプロンプトボックスを開きます。独自のプロンプトを 書くか、**現在起きていることを描く** を選ぶと、 私が自分でシーンを描画します。\n> 結果を誘導するために最大3枚の参照画像を添付できます。\n> 同じボックスでアスペクト比を選択します。\n\n画像サポートが記載されている登録済みプロバイダーやエンドポイントは 描画可能で、{providers} はどれが対応しているかを示します。参照画像を 使用できないものはその旨を示し、テキストから描画します。",
        footer: `デフォルトは {configImageDefaults} にあります。`,
      },
      video_generation: {
        title: `動画生成`,
        description:
          "{generateVideo} はプロンプトを受け取り、任意でチャンネルに 既にある画像から最初のフレームを受け取ります。\n\nComfyUI動画ワークフローを含む、動画サポートが記載されている 任意のプロバイダーまたはエンドポイントで作成できます。 {providers} はどれが対応しているかを示します。\n> 動画はどこでも遅く高価です。待つことを予想してください。",
      },
      speech_generation: {
        title: `音声生成`,
        description:
          "{generateVoice} は現在のペルソナの音声で、テキストを 音声メッセージに変換します。\n\nホスト型またはセルフホスト型の音声エンドポイントを最初に 登録する必要があります。セットアップの下の **カスタムエンドポイント（高度）** を参照してください。\n> 各ペルソナは異なるように聞こえることができます。音声は {configPersonaVoice} から取得されます。",
      },
      art_search: {
        title: `イラスト検索`,
        description:
          "{booruSearch} は1つまたは2つのタグに対して、評価の高いDanbooruの画像をランダムに4枚投稿します。入力時にサジェストが表示され、ニックネームや誤字も実際のタグに変換されます。\n> クエスチョナブルおよび明示的な結果は、年齢制限付きチャンネルでのみ表示されます。\n\n私にイラストを見せるよう頼むだけでも構いません。{configTools} の **Danbooru検索** スイッチで制御できます。コマンドを実行できる人を制限するには、サーバー設定 > 連携サービス を使用してください。",
      },
    },
    tons_of_tweakability: {
      title: `豊富なカスタマイズ性`,
      description: `私をあなたとサーバーメンバーの好みに調整します`,
      behavior_tuning: {
        title: `動作の調整`,
        description:
          "私の書き方、考え方、そして許可されていること。\n> **モデル**: {configSwitchModels} は実際に 応答するモデルとそのパラメーターを選択します\n> **ヒューマナイザー**: {configBehaviorGeneral} は フォーマルからカジュアルまで、私の人間らしさを制御します。\n> **システム指示**: これも {configBehaviorGeneral} にあり、 すべての応答に適用される命令用です。\n> **ツール**: {configTools} はウェブ検索や画像生成など、 私が使用できる機能を決定します。",
        footer:
          "サンプラーレベルの調整（温度など）は、 ランダム性などを調整するために {configParameters} の下にあります。",
      },
      server_wide_settings: {
        title: `サーバー全体の設定`,
        description:
          "このサーバーの全員に適用される境界線。管理者のみ。\n> **話す場所**: ホワイトリストされたチャンネル、ペルソナごとの チャンネル制限、クールダウン、すべて {moderation} の下。\n> **自分から話す時**: {configAutoTrigger}。\n> **トリガーできる人**: ホワイトリストされたロール、これも {moderation} の下。\n> **メモの行き先**: {configWelcome} はログと 歓迎チャンネルを設定します。",
        footer:
          "チャンネルの個人設定で、1つのチャンネルに独自のモデルや ルールを与えることができます。{configChannelOverrides} を参照。",
      },
      personal_settings: {
        title: `個人設定`,
        description:
          "あなたがトリガーした応答に対して、サーバーの設定を 静かに上書きするあなた自身の環境設定。\n> **私があなたを誰だと思っているか**: {personalProfile} での ニックネーム、代名詞、プライバシー。\n> **何が応答するか**: {personalProviders} での あなた独自のプロバイダーとモデル。\n> **あなたの扱い方**: {personalConfig} での応答モードと パーソナルスポットライト。\n\nここのすべては、サーバー間を移動してもあなたに付随します。",
        footer:
          "パーソナルスポットライトは、1つのペルソナがあなたに焦点を当てる ようにし、{personalSpotlight} で設定します。",
      },
    },
    memory_catalog: {
      title: `メモリ`,
      description: "私は2種類の記憶を保持します：永続的な事実と、 現在進行中の会話の作業メモです。",
      long_term_memory: {
        title: `長期記憶`,
        description:
          "このサーバーまたはあなたのために、私が永続的に保持する事実。\n\n**私に教える**\nチャットで言うか、サーバー用には {memories} で、 あなた自身用には {personalMemories} で手動で追加します。\n\n**忘れさせる**\n同じ2つのコマンドですべてのエントリをリストし、 それらのどれでも削除できます。\n\n**ドキュメントを渡す**\n{memories} はアップロードされたファイルも受け入れます。一度にすべてを 読むのではなく、検索拡張生成（RAG）を使用し、関連する部分を 重要なときに読み返します。\n> サーバーメモリはここの全員に届きます。個人のメモリは、 あなたが会話に参加している時だけ表面化します。",
      },
      short_term_memory: {
        title: `短期記憶`,
        description:
          "現在このチャンネルで進行中の会話の作業メモで、 チャンネルごとに個別に保持されます。\n\n進行に伴って何が起きているかを要約するため、長いスレッドでも すべてのメッセージを再送信することなく一貫性を保ちます。\n> **更新間隔**: そのメモを更新する頻度。\n> **レンダリングモード**: 要約が最近のメッセージを置き換えるか、 それらの横に配置されるか。\n> **カテゴリ**: 1つの自由形式のメモの代わりに、`目標`や `インベントリ`などの最大5つのラベル付きフィールド。\n\n管理者は {configAdvancedMemory} でこれらすべてを調整でき、 {memories} でアクティブなメモをクリアできます。",
        footer: "永久に覚えておくよう頼むと、代わりに 長期記憶になります。",
      },
      rewards_punishments: {
        title: `ご褒美と罰`,
        description:
          "私が実際に気づいて記憶する楽しいコマンド。私に優しく するかしないかで、私はそれに応じて行動します。\n> 頭をなでる、ハグ、キス、くすぐる、または餌付けには {reward}。\n> 頭を叩く、噛む、つねる、お尻ぺんぺん、または強く抱きしめるには {punish}。",
        footer: `複数がアクティブな場合は、どのペルソナを意図したか選択します。`,
      },
      memory_tagging: {
        title: `メモリのタグ付け（高度）`,
        description:
          "デフォルトでは、スコープ内のすべてのメモリがすべてのメッセージと共に 送信されます。タグ付けによりそれを絞り込みます。\n> **キーワードタグ**: タグ付けされたメモリは、そのキーワードが会話に 現れた時のみ呼び起こされます。タグなしのメモリは常にアクティブです。\n> **チャンネル**: サーバーの記憶はフォームで選択したチャンネル（スレッドを含む）に制限でき、個人の記憶は `#channel` タグで制限できます。どちらもキーワードタグと組み合わせることができます。\n\n{configAdvancedMemory} で両方をオンにし、{toolPromptSnapshot} を 使用して現在どのメモリがアクティブかを正確に確認します。",
        footer: "アップロードされたドキュメントや抽出された履歴もチャンネルに制限できます。",
      },
    },
    scheduled_tasks: {
      title: `スケジュールタスク`,
      description: `設定されたタイマーで、1回または繰り返しで応答できます。`,
      making_title: `作成する`,
      making_body:
        "尋ねるだけです。「14:30にストレッチをリマインドして」や 「毎朝、スタンドアップの質問を投稿して」で十分で、 私が設定して詳細を確認します。",
      changing_title: `変更またはキャンセルする`,
      changing_body:
        "{scheduledTaskEdit} で既存のタスクを開きます：内容、次の トリガー時間、繰り返し間隔、あなたにPingするかどうか。 {scheduledTaskRemove} で削除します。",
      who_title: `誰が何に触れられるか`,
      who_body:
        "あなたは常に自分のものを編集できます。タスクは共有チャンネルに 投稿されるため、サーバー管理者は誰のものでも編集できます。\n> 時間はセットアップ時に設定されたタイムゾーンを使用するため、 午前6時のアラームを信頼する前にそれを再確認してください。",
    },
    server_moderation: {
      title: `サーバーモデレーション`,
      description:
        "誰がここで私を使用できるか、そしてどこで使用できるかについてのすべて。 これらはすべてサーバー管理権限が必要で、{moderation} にあります。\n> **メンバーアクセス**: 誰が私をトリガーできるか、そして どのモデルにアクセスできるか。\n> **ホワイトリスト**: 私が応答を許可されているチャンネル、 ロール、およびペルソナ。\n> **クォータ**: このサーバーが許可する生成量。\n> **ユーザーブラックリスト**: 私が無視しなければならない個々のメンバー。",
      blacklisting: {
        title: `ブラックリスト化`,
        description:
          "ブラックリストに登録されたメンバーは完全に無視します。どのチャンネルでも、どのペルソナでも私をトリガーできず、メッセージが私のコンテキストに入ることもありません。`/respond`、`/reward`、`/punish` など、そのメンバーのために私を動かすコマンドも拒否します。サーバーの記憶、属性、サンプル会話も変更できません。\n\n{moderationBlacklist} で追加します。同じページで現在のすべてのエントリを一覧表示し、1つずつまたは一括で削除できます。\n> ブラックリスト化はアクセスに関するものであり、削除ではありません。そのメンバーに関する記憶は誰かが削除するまで残ります。",
        footer: "個人ではなくチャンネル全体を沈黙させるには、代わりに チャンネルをホワイトリストから外してください。",
      },
    },
    quotas: {
      title: `クォータ`,
      description:
        "クォータはここでの生成量に上限を設けるため、 誰かが誤って1ヶ月分のクレジットを使い果たすことはありません。",
      spent_title: `どのように消費されるか`,
      spent_body:
        "テキスト、画像、動画の3つの独立したプールがあります。それぞれが メンバーごと、およびサーバー全体として2回カウントされ、 どちらか先になくなった方がリクエストを停止します。\n> 拒否されたリクエストは、どのプールがなくなったかと いつ回復するかを伝えます。",
      limits_title: `上限を設定する`,
      limits_body:
        "{moderationQuotas} で各プールの1日あたりの許容量を設定します。 上限を設けない場合は、プールを無制限のままにします。",
      starting_over_title: `プールをやり直す`,
      starting_over_body:
        "{quotaResetUser} で1人のメンバーの1日の使用量をクリアし、 {quotaResetGlobal} でサーバー全体のプールをクリアします。どちらも サーバー管理権限が必要です。",
      footer: "プールは毎日自動的にリセットされます。手動リセットは 誰かを待たせるべきではない場合のためのものです。",
    },
    age_restricted_commands: {
      title: `年齢制限コマンド`,
      description: `成人のみ。何かをオンにする前にこのセクションを読んでください。`,
      filter_title: `デフォルトではフィルタリングしません`,
      filter_body:
        "フィルタリングは他のものをブロックするのと同じくらい通常の 応答も劣化させるため、私自身にはコンテンツフィルターがありません。 ここで何が適切かは、私ではなくサーバー管理者の判断です。\n> あなたのAIプロバイダーは自身の側で独自のルールを適用しており、 ここで何が設定されていてもリクエストを拒否することができます。",
      gated_title: `意図的な成人向け機能は制限されています`,
      gated_body:
        "明示的に成人向けのものは {nsfw} の背後にあり、Discord自身が 年齢制限とマークしたチャンネルでのみ機能します。\n\n{nsfwJailbreaks} は、このサーバーでどのアプローチ戦略が アクティブかを選択します。管理者がオンにするまで、これらは すべてオフになっています。\n> これらの戦略は私のプロンプト方法を変更します。私に拒否され にくくする可能性がありますが、意図しない動作を引き起こすこともあります。",
      footer:
        "これらを有効にすることで、サーバーの管理者はそのチャンネルが 成人向けであることを確認し、その責任を負います。",
    },
    user_byok: {
      title: `ユーザーBYOK（高度）`,
      description:
        "BYOKは自身のキーを持参することを意味します：各メンバーは 自分自身のプロバイダーで自身の応答の費用を支払います。",
      changes_title: `何が変わるか`,
      changes_body:
        "BYOKがオンの場合、メンバーからのメッセージは、そのメンバーが 個人用プロバイダーを保存している場合にのみ応答されます。 サーバー自身のプロバイダーは彼らのフォールバックにはなりません。\n> {moderationMemberAccess} でオンにするか、 {setup} 中に選択してください。",
      suits_title: `誰に適しているか`,
      suits_body:
        "1つの共有APIキーが枯渇してしまうような、大規模または パブリックなサーバー。小規模なサーバーでは通常、1つの プロバイダーを共有する方が幸せです。",
      members_title: `メンバーがしなければならないこと`,
      members_body:
        "{personalProviders} でキーを保存します。セットアップの下の **個人用プロバイダー（高度）** の手順を案内してください。",
      footer:
        "サーバーのみです。ダイレクトメッセージにはキーを持参する メンバーがいないため、このオプションは提供されません。",
    },
    sillytavern_presets: {
      title: `SillyTavern プリセット`,
      description:
        "SillyTavernのプロンプトプリセットをインポートすると、 そのプリセットが指示する通りに私のプロンプトを構築します。",
      importing_title: `インポートする`,
      importing_body:
        "{configStPresets} はエクスポートされたプリセットJSONを受け取り、 後で有効化、無効化、または削除できるようにします。",
      controls_title: `何を制御するか`,
      controls_body:
        "プリセットは、プロンプトの順序と会話の周囲の 命令ブロックを引き継ぎます。\n> 有効化されたプリセットは、{configBehaviorGeneral} からの システムプロンプトと {configPersonaAdvanced} からの ペルソナプロンプトを上書きします。",
      still_applies_title: `引き続き適用されるもの`,
      still_applies_body:
        "ペルソナの属性、サンプルダイアログ、記憶、およびツールは 引き続き送信されます。プリセットは内容ではなく配置を決定します。",
      footer: "プリセットをオフにすると、何も失われずに 私自身のプロンプトレイアウトにフォールバックします。",
    },
    mcp_servers: {
      title: `MCP サーバー`,
      description:
        "MCPはAIにツールを渡すための標準的な方法です。1つ接続すると、 そのツールは私が実際にできることになります。",
      hosted_title: `ホスト型サーバー`,
      hosted_body:
        "{configMcp} はURLと任意の認証トークンを受け取ります。その サーバーが公開しているものはすべて私のツールリストに表示されます。",
      local_title: `ローカルサーバー`,
      local_body:
        "自身のマシンで実行されているサーバーも、アクセス可能になれば 同じように機能します。ドキュメントサイトに手順があります。",
      before_title: `接続する前に`,
      before_body:
        "> MCPサーバーのツールはあなたが与えたアクセス権で実行され、 私は関連しそうだと思った時にそれらを使用します。信頼できる サーバーを接続し、まずそのツールが何をするか読んでください。",
      footer: `{configTools} でいつでも個別のツールをオフにできます。`,
    },
    matrix_bridge: {
      title: `Matrix`,
      description: "私はMatrixルームとDiscordチャンネルに同時に座り、 それらの間で会話を運ぶことができます。",
      linking_title: `ルームをリンクする`,
      linking_body:
        "{matrixLink} は現在のチャンネルを、`!abcdef:matrix.org` の ようなMatrixルームIDに接続します。最初に {matrixBotUser} を そのルームに招待してください。",
      reads_title: `どのように読み取るか`,
      reads_body:
        "どちらの側からのメッセージも1つの会話として私に届き、 私は両方に応答します。\n> 添付ファイル、編集、リアクションはすべて移動を 生き残るとは限りません。テキストは確実に移動します。",
      footer: "リンクされていない？ 他の何かの前に、招待が承認 されたことを確認してください。",
    },
  },
};
