---
title: "SillyTavernサポート"
# Keyword-rich <title> targeting "SillyTavern character cards in Discord"
# queries; replaces Starlight's default for this page only. H1 and sidebar
# keep the plain title.
head:
  - tag: title
    content: "TomoriBot | Use SillyTavern Character Cards in Discord"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "TomoriBotを使用して、SillyTavernのキャラクターカードとプロンプトプリセットをDiscordにインポートします。既存のキャラクターをサーバーに持ち込みましょう。"
sidebar:
  order: 2
---

TomoriBotは、[SillyTavern](https://github.com/SillyTavern/SillyTavern) から2つのアセット、プロンプトマネージャー プリセット (プロンプト構造を制御する) とキャラクター カード (キャラクター定義) をインポートできます。SillyTavernを使用したことがない場合は、このページをスキップしても問題ありません。

## キャラクターカードのインポート

`/persona import`を使用して、既存のSillyTavernキャラクターをDiscordに取り込みます。以下のものを受け入れます:

- `chara`または`char`メタデータが埋め込まれた **PNGカード**。
- ルートレベルのプロパティを持つ **v2スタイルのJSON** カード (`name`、`description`、`first_mes`)。
- **v3 JSON** カード (ネストされた`data`オブジェクトを含む`spec: "chara_card_v3"`)。
- **`.charx`アーカイブ** (キャラクター カードV3パッケージ)。

`.charx`ファイルは、`card.json`定義を含むZIPアーカイブです。TomoriBotは、`card.json`から文字テキストをインポートし、バンドルされたアセットファイル (アイコン、スプライト、オーディオ、ビデオ) をスキップします。`/config` > `ペルソナ` > アイデンティティとパーソナリティでアバターを設定し、`/config` > `ペルソナ` > スプライトでスプライトを追加できます。

アップロードされたファイルがTomoriBotメタデータのない有効なSillyTavernカードである場合、インポートによって自動的に変換されます。`/persona generate`にカードを渡して、キャラクターからインスピレーションを得た新しいペルソナを作成することもできます。

インポートは保存する前に検証されます (デフォルトの制限: テキストフィールドあたり5,000文字、属性200、片面あたり100のサンプルダイアログ、100のトリガー ワード)。フィールドマッピングと変換の仕組みについては、[カードサポートアーキテクチャ](/en/architecture/integrations/sillytavern/card-support/) を参照してください。

## プロンプトプリセット
<!-- anchor: prompt-presets -->

SillyTavernプロンプトマネージャー プリセットは、モデルに送信されるプロンプトの順序とレイアウトを制御します。`/config` > `プラグイン` > SillyTavernプリセットを開いて、プリセットをインポートしたり、個々のノードを切り替えたり、アクティブなプリセットを切り替えたり、デフォルトのフォーマットを復元したりできます。

### プリセットが制御するもの

- 即時注文とマーカーの配置
- カスタムプロンプトノード
- ポストヒストリーおよび深度注入ノード
- インポートされたノードの初期有効状態

### プリセットで置き換えられないもの

プリセット構造によりレイアウトが促されます。それを埋めるテキストソースは置き換えられません。

- システム命令とペルソナフィールド: `/config` > `動作` > `一般的な動作`、`/config` > `ペルソナ` > 詳細、および`/config` > `ペルソナ` > アイデンティティとパーソナリティ。
- ライブチャット履歴と取得されたドキュメントコンテキスト。
- 自動コンテキスト: サーバーの記憶、絵文字とスタンプのデータ、参加者リスト、短期記憶。

### ネイティブブロックのマッピング

ネイティブブロックは、TomoriBotプロンプトコンポーネントに直接マップされます。

- `main`: アクティブなシステムプロンプト (`/config` > `動作` > `一般的な動作`、またはデフォルトのフォールバック)
- `charDescription`: `/config` > `ペルソナ` > アドバンスト
- `charPersonality`: `/config` > `ペルソナ` > `アイデンティティと性格`
- `dialogueExamples`: `/config` > `ペルソナ` > `アイデンティティと性格`
- `chatHistory`: ライブチャンネルメッセージ履歴
- `worldInfoBefore`および`worldInfoAfter`: 取得されたドキュメントコンテキスト (SillyTavernロアブックではありません)

### システムプロンプトルール

インポートされたプリセットがアクティブになると、組み込みのフォールバックシステムプロンプトが削除されます。ただし、`/config` > `動作` > `一般的な動作` でカスタムシステムプロンプトを構成すると、そのプロンプトは常に含まれます。

### 互換性に関する注意事項

- `prompt_order`で無効になったノードは、`/config` > `プラグイン` > SillyTavernプリセットで有効になるまで非アクティブのままになります。空のコメントのみのノードは送信されません。
- ブロックの順序は文字通りです。`chatHistory`を`dialogueExamples`の前に置くと、チャット履歴がプロンプトの最初に配置されます。
- 履歴後の挿入は、スタンドアロンのメッセージとして送信されるのではなく、既存の会話履歴にマージされます。
- 正規表現の後処理、プリセット定義のサンプリングパラメーター (温度、トップ-p)、および階層化されたプリセットはサポートされていません。従来のテキスト補完プリセットは、STのみのブロックが削除された状態でインポートされます。

`/help`で、Discordガイドとして`プラグイン`を選択し、次に`SillyTavernプリセット`を選択します。内部プリセット処理については、[プリセットシステムアーキテクチャ](/en/architecture/integrations/sillytavern/preset-system/)を参照してください。
