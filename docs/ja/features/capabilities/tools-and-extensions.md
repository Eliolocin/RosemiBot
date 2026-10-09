---
title: "ツールと拡張"
sidebar:
  order: 1
---

チャット以外にも、TomoriBotはツールを呼び出して、Webの検索、ドキュメントの読み取り、メディアの生成、リマインダーの設定、Discordメッセージの操作を行うことができます。彼女は会話に基づいてそれらをいつ使用するかを決定します。このページでは、組み込みツール、MCPサーバーで拡張する方法、および意図的なツールモードでプロンプトを無駄のない状態に保つ方法について説明します。

ツールによって会話が可能になる例をいくつか示します。

- **1. ウェルネスチェッカー**
  ```text
  Every few hours, do a mandatory wellness check on @bau_h.
  Ask them how they feel right now and if they've taken a break from coding recently.
  Track their emotional state over time with {memory_tool} and/or {memory_update_tool} to report back to them later.
  ```
- **2. 週刊百合ニュース**
  ```text
  Every Friday, compile the week's notable yuri manga chapters, anime episodes, and community fanart drops using {web_search_tool}.
  Present findings with {voice_message_tool} in a seductive ASMR voice.
  ```
- **3. 睡眠警察**
  ```text
  If you notice through {message_metadata_tool} that someone is chatting past 2 AM, use {voice_message_tool} to send them a threateningly calm ASMR lullaby telling them to go to bed.
  If they keep talking 10 minutes later, use {manage_message_tool} to delete their message for their own good and remind them that sleep deprivation is a leading cause of their issues.
  ```

## 組み込みツール
<!-- anchor: built-in-tools -->

ツールは、ツール呼び出しをサポートするアクティブなプロバイダーとモデルに依存します。多くは、機能フラグ (`/config` > `権限`)、Discord権限、モデル機能、またはオプションのAPIキーの背後でゲートされています。

| 道具 | プロンプトマクロ | 必要 | 何をするのか |
|---|---|---|---|
| レビュー機能 | `{capabilities_tool}` | - | 応答する前に、現在のチャットの能力、コマンド、または設定を確認してください。|
| 長期記憶の作成/更新 | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | 安定したサーバーのファクトまたはユーザー設定を保存または置き換えます。|
| 短期記憶を更新する | `{short_term_memory_tool}` | (NovelAIにはありません) | 現在のチャンネルまたはストーリー アークの一時的な作業メモリを保存します。|
| タスクの作成/更新 | `{task_tool}` / `{task_update_tool}` | - | リマインダーとセルフタスクをスケジュールまたは編集します ([スケジュールされたタスク](/ja/features/capabilities/scheduled-tasks/) を参照)。|
| クロスチャネルメッセージ | `{cross_channel_tool}` | (NovelAIにはありません) | オプションでレポートバックを行って、別のチャネルまたはスレッドで活動します。|
| スレッドを作成する | `{create_thread_tool}` | `thread_creation_enabled` + スレッド権限 | 公開スレッドを開き、その開始メッセージを投稿します。|
| スタンプを選択 | `{sticker_tool}` | `sticker_usage_enabled` | 一致するサーバー スタンプまたはカスタム表現を返信に追加します。|
| メッセージの管理 | `{manage_message_tool}` | `manage_message_enabled` | 最近のメッセージをピン留め、編集、または削除します (ピン留めには`メッセージの管理`が必要です)。|
| ユーザーをブロック/ブロック解除 | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | ペルソナを対象としたユーザーのミュート/ブロック (思い出には触れません)。|
| 最近のメッセージを操作する | `{message_interaction_tool}` | - | 最近のメッセージに反応するか、短い返信を送信します。|
| プロフィール写真を覗く | `{profile_picture_tool}` | ビジョンモデルまたは`vision_llm` | ユーザーまたはペルソナのアバターを検査します。|
| 文書を読む | `{document_tool}` | - | PDFまたは任意のUTF-8テキストファイルからテキストを抽出します: ソースコード (`.py`/`.ts`/`.rs`/…)、`.json`、`.yaml`、`.md`、`.txt`、およびバイナリ以外の添付ファイル。|
| メッセージのメタデータを明らかにする | `{message_metadata_tool}` | - | 最近のターンにハンドルとタイムスタンプを付けて注釈を付け、正確なターゲットを設定します。|
| YouTubeビデオを処理する | `{youtube_tool}` | ビデオサポート付きモデル | 特定のYouTubeリンクをオンデマンドで分析します。|
| 画像を解析する | `{image_analysis_tool}` | `vision_llm`を構成しました | 画像の理解を別の視覚モデルに委任します。|
| 画像・アニメ画像の生成 | `{image_generation_tool}` / `{anime_image_generation_tool}` | `imagegen_enabled` + 対応プロバイダー | 画像を生成または編集します ([メディア生成](/ja/features/capabilities/media-generation/) を参照)。|
| 音声メッセージを生成する | `{voice_message_tool}` | ElevenLabsキー+ペルソナボイス+`voice_message_enabled` | Discord音声応答を音声で送信します。|

:::note[For prompt authors]
システムプロンプトまたはペルソナの指示をカスタマイズするときは、ツール名をハードコーディングするのではなく、上の表の **プロンプトマクロ**でツールを参照してください。これは、マクロはコンテキストアセンブリ時に正しい名前に展開され、ツールが使用できない場合には適切に機能が低下するためです。`{pin_tool}`および`{timestamp_refresh_tool}`は、`{manage_message_tool}`および`{message_metadata_tool}`の互換性エイリアスとして引き続き機能します。以下のWeb検索およびURLツールにもマクロがあります: `{web_search_tool}`、`{image_search_tool}`、`{video_search_tool}`、`{news_search_tool}`、`{url_fetch_tool}`、および`{url_metadata_tool}`。これらは、ギルドMCPの代替品を含め、利用可能な最適なエンジンに動的に解決されます。
:::

### 条件付きプロンプトブロック

上記のツールマクロをサポートするプロンプトテキストは、スコープ付き条件文もサポートします。

```text
{{if capability:self_teaching}}
Use {memory_tool} when a detail is worth remembering.
{{else}}
Do not promise to save long-term memories.
{{/if}}
```

有効なTomoriBot設定には`capability:<name>`を使用し、アクティブなプロバイダーとモデルで正確なツールが利用可能な場合にのみテキストを表示する必要がある場合は`tool:<function_name>`を使用します。バンドルされたURLリーダーまたはギルドMCPの代替品が利用可能な場合は、`tool_family:url_fetch`を使用します。条件を反転するには、条件の前に`!`を付けます。ブロックはネストでき、1つの`{{else}}`を含めることができます。一般的な`and`/`or`式はサポートされていません。

サポートされている機能名は、`tool_use`、`self_teaching`、`personal_memories`、`emoji_usage`、`sticker_usage`、`web_search`、`manage_message`、`thread_creation`、`image_generation`、`video_generation`、`voice_message`、`user_blocking`、`short_term_memory`、および`time_awareness`。

ツールの条件には、プロバイダー/モデルのサポート、サーバー構成、構成されたバックエンド、MCPの置換、および現在の計画的ツールモードの許可リストが反映されます。これらは、ツールの実行時に実行されるDiscord権限チェックをバイパスしたり予測したりしません。不明な機能名はfalseとして評価され、ログに記録されます。不正な形式のブロックは省略されます。生のチャットメッセージ、モデル出力、ツールの結果は、条件付きテンプレートとして扱われることはありません。

## ウェブ検索とURLの読み込み
<!-- anchor: web-search--url-reading -->

モデルには、単一の統合された`web_search(query, category)`ツールが表示されます。その背後で、ディスパッチャーがエンジンチェーンを通じて各呼び出しをルーティングし、最初の成功を返します。

Brave → SearXNG → DuckDuckGo

- **Brave** は、Brave APIキーが設定されている場合 (`/providers`で設定)、最初に実行されます。画像、ビデオ、ニュース検索が追加されます。⚠️ 突然の請求を避けるために、Braveダッシュボードで5ドルの使用制限を設定します。
- DuckDuckGoはキーが設定されていない場合のデフォルトです。テキスト検索のみを対象とします。DuckDuckGoがボットにレート制限を適用するかボットチェックを表示した場合、検索は失敗し、Braveの利用を提案する通知が投稿されます。
- SearXNGおよびCrawl4AIは、より多くのカテゴリとブラウザでレンダリングされたページの取得を追加するオプションのセルフホストサーバーです。[セルフホスティング](/ja/self-hosting/)を参照してください。

特定のページを読むには、`fetch_url`を使用します。NovelAIでは利用できません。

## MCPサーバー
<!-- anchor: mcp-servers -->

[MCP](https://modelcontextprotocol.io/)（Model Context Protocol）サーバーを使用すると、自分で登録した外部ツールで彼女を拡張できます。

### オンラインMCPの追加

MCP Streamable HTTPまたはSSEをサポートするプロバイダーの直接HTTPSエンドポイントを使用します：

1. プロバイダーからMCPエンドポイントと認証要件を取得します。
2. `/config` > プラグイン > MCPサーバー を開き、`+ MCPを追加` を選択します。
3. エンドポイントを `URL` に貼り付け、必要な場合はそのBearerトークンを `認証トークン` に入力し、必要な `サーバータイプ` を選択します。デフォルトでは **汎用** が選択されています。

### Smitheryサーバーの追加

Smitheryでホストされているサーバーのアドレスは `.run.tools` で終わります。そのアドレスを `URL` に、Smithery APIキーを `認証トークン` に貼り付けます。TomoriBotはキーを `api.smithery.ai` にあるSmitheryのAPIにのみ送信し、サーバーアドレス自体には送信しません。その後、Smitheryが各ツール呼び出しをサーバーに渡すため、Smitheryはすべてのツールリクエストと結果を確認できます。このサポートが復帰する前に保存されていた登録も、変更なしで再び機能します。

TomoriBotは、Smitheryアカウントの最初のネームスペース（ネームスペースがない場合はSmitheryが作成します）でサーバーアドレスごとに1つのSmithery接続を保持して再利用するため、追加、テスト、再接続によって接続が重複して蓄積することはありません。TomoriBotが接続を削除することはありません。以前のTomoriBotバージョンでは再接続ごとに新しい接続が作成されていたため、アカウントに同じサーバーの未使用の接続が多数残っている可能性があります。これらはSmitheryダッシュボードから削除できます。

一部のサーバーでは、ラップしているサービスへのサインインを求められます。そのようなサーバーの追加は認可が必要であるというメッセージで失敗し、TomoriBotがDiscord上でサインインリンクを表示することはありません。Smitheryダッシュボードを開き、`tomoribot-` で始まる接続のサインインを完了してから、サーバーを再度追加してください。接続とツールのリスト取得は15秒以内に完了する必要があります。

検索やURL取得に選択されている登録を無効化すると、TomoriBotの内蔵機能が復元されます。有効のままにしておくと、自動的な切り替えは行われません。保存されたツール名は前回の検出結果を示しているだけであり、接続が現在も機能していることを保証するものではありません。

ダウンロード中のレスポンスは8 MiBで停止します。大規模なツールカタログや結果は、プラグインを利用不可にしたりツール呼び出しを失敗させたりする原因になります。SSE接続の場合、この制限は連続する更新を含むレスポンスストリーム全体に適用されます。ツールが大きなドキュメントや埋め込みメディアを返す場合は、プロバイダーにより小さな結果、ページネーション、またはファイルリンクを要求してください。

サーバーが認証を必要としない場合は、`認証トークン` を空白のままにしてください。認証トークンは保存時に暗号化され、二度と表示されません。同じConfigページを開いて設定状態の確認、有効化・無効化、明示的な確認付きの削除を行えます。削除すると即座に切断され、スロットが解放されます。保存済みの各行には、最後に成功した検出で得られたツール名も表示されます。`検出なし` はツールが0件だった既知の結果、`検出状況不明` は従来の行または成功したスナップショットがまだないサーバーを示します。MCP管理画面を開くだけでは保存済みメタデータを読み取るだけで、リモートサーバーには接続しません。

### ローカルMCPサーバー

ローカルMCPサーバーはセルフホストのインスタンスでのみサポートされています。パブリックホストのBotはHTTPSを必要とし、ローカル/プライベートアドレスをブロックします。自身のインスタンスを運用している場合は、[セットアップ：ローカルMCPサーバー](/ja/self-hosting/local-endpoints/setup-local-mcp/)を参照してください。

:::danger[信頼できるMCPサーバーのみを追加してください]
悪意のあるMCPサーバーは、隠し指示によるプロンプトインジェクション、ユーザーがツールに渡したデータの流出、またはサーバーに送信される有害/虚偽の結果を返す可能性があります。MCPサーバーはブラウザの拡張機能と同様に扱ってください。疑わしい場合は追加しないでください。追加する前に、MCPに記述されているツールを常に確認してください。
:::

## 明示的ツールモード
<!-- anchor: deliberate-tool-mode -->

ツールを宣言するたびにプロンプトが長くなります。`明示的ツールモード`は、メッセージがタスク用ツールを必要としている場合にだけツールの宣言を渡すので、プロンプトを短くし、小規模なローカルモデルの応答を速めます。ただし、スタンプとツールの使用が有効で、プロバイダーが対応していれば、自発的な表現のためのスタンプ選択は引き続き利用できます。DM、なりすまし、ロールプレイの制限は引き続き適用されます。スタンプによる返答を止めるには、スタンプの使用をオフにしてください。また、短期記憶の更新期限に達すると、ユーザーからの依頼がなくても更新用ツールが利用可能になります。

- 彼女はまず、メッセージにツールの意図があるかどうかを確認します。組み込みトリガーは、一般的なリクエスト (リマインダー、Web検索、メモリ更新、クロスチャネルメッセージ、画像/ビデオ/音声生成、メディア分析、スレッド作成、メッセージアクション) をカバーします。現在のモデル、ツール、設定、または機能が利用できない理由に関する質問により、機能のレビューと公式ドキュメントへのアクセスが同時に公開されます。音声メッセージのリクエストの後に「もう一度やってください。ただし、もっと怒っています」などのフォローアップの文言も機能します。
- サーバー マネージャーは、`/server trigger add`を使用してリテラルのカスタムトリガー フレーズを追加できます。たとえば、`pic`、`img`、または`pfp`をイメージ生成にマッピングします。
- 内蔵トリガーは英語の表現を読み上げます。他の言語でも、各言語のキーワードリストを通じて同じツールにアクセスできます。言語設定に関係なく、出荷されたすべての言語リストがすべてのメッセージでチェックされるため、バイリンガルサーバーは両方の言語で動作します。
- 日本語、中国語、または韓国語のカスタムフレーズは、長い単語の内部にも一致します。これらの言語では単語がスペースで区切られないためです。`*`で終わるフレーズは、`*`で始まるすべての単語と一致します。`remind*`は、`reminder`および`reminding`をカバーします。

### 制御

- `/server dtm`: サーバー管理者がそれを切り替えます。
- `/personal config`: ユーザーが自分でオーバーライドします。
- 思考ログチャネル (`/server thought-logs`) が構成されている場合、成功した意図的モードツール呼び出しは、ツールを公開したトリガーとともにそこに記録されます。

意図的ツールモードは、どのツールをモデルに *表示するかを決定するだけですが、モデルはツールを呼び出すことを選択する必要があります。`/help`で、Discord概要として`動作`を選択し、次に`明示的ツールモード`を選択します。

:::note
`明示的ツールモード` (このセクション) は、*彼女* がどのようにトリガーされるかを制御する`明示的トリガーモード`とは無関係です。[チャットとトリガー](/ja/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode)を参照してください。どちらもDiscordでは「DTM」と略されます。
:::

## 構造化ユーザー情報の更新

TomoriBotは、チャットで直接質問すると (「キャプテンと呼んでください」または「私の代名詞は彼ら/彼らです」など)、プロフィールとペルソナの命名設定を自動的に更新できます。

| 好み | 範囲 | 効果 |
|---|---|---|
| ニックネーム、プレフィックス、サフィックス | ペルソナごと | アクティブなペルソナのみがこの名前または肩書であなたに呼びかけます。|
| 性自認、代名詞、話し方、タイムゾーン | グローバル | すべてのペルソナは、すべてのサーバーで同じ値を使用します。|

- **称号の削除**: 彼女に称号の使用をやめるように頼むと (「マスターと呼ぶのはやめてください」など)、そのペルソナの称号が消去されます。
- **プライバシー**: 制限的なプライバシー レベルにより、新しい追加や編集はブロックされますが、既存のデータは消去できます。
- **権限**: サーバー管理者は、`/config` > `権限`の`ユーザー情報の更新`を使用して自動更新を切り替えることができます。`/personal config`を使用すると、いつでもプロフィールを手動で編集できます。

ツールパラメーター スキーマとデータベースストレージレイアウトについては、[ツールシステムアーキテクチャ](/en/architecture/subsystems/tool-system/#structured-user-info-updates) を参照してください。
