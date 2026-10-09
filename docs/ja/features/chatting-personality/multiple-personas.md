---
title: "マルチペルソナ"
# Keyword-rich <title> targeting "AI companion Discord" queries; replaces
# Starlight's default "{title} | TomoriBot" for this page only. H1 and sidebar
# keep the plain title. The homepage title bets on "AI agent" + "roleplay" -
# this page carries the "companion" keyword instead.
head:
  - tag: title
    content: "TomoriBot | Discord向けAIペルソナ"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "1つのDiscordサーバーで複数のAIを稼働させます。独自のアバター、トリガー、話し方を持つカスタムペルソナ。"
sidebar:
  order: 2
---

TomoriBotの名前、アバター、性格、話し方、動作はペルソナに保存されます。複数のペルソナを同時に使い、それぞれ別のキャラクターとして独自のトリガーワードとWebhookアバターで会話できます。このページではペルソナの動作を説明します。知識や記憶については[記憶](/ja/features/knowledge/memory/)を参照してください。

## ペルソナの作成

- `/persona create`: カスタムペルソナを最初から作成します。
- `/persona generate`: AIにプロンプトと画像からペルソナを生成させます (構造化された出力をサポートするプロバイダーが必要です)。既存のTomoriBotプリセットまたはSillyTavernカードを提供することもできます ([SillyTavernサポート](/ja/features/integrations/sillytavern-support/) を参照)。
- `/persona default`: 組み込みのデフォルトキャラクターの1つに切り替えます。
- `/persona export`および`/persona import`: ペルソナファイルをバックアップまたは共有します。インポートは、独自のトリガーとWebhookアバターを備えたオルタペルソナとしてキャラクターを追加することをサポートしています。
- `/persona remove`: オルタペルソナを削除します。

## オルタペルソナ

オルタペルソナを使うと、1つのサーバーで複数のキャラクターが会話できます。

- オルタごとに性格、トリガーワード、Webhookアバターを設定できるので、同じチャンネルでもそれぞれの名前と画像で投稿します。
- 1つのメッセージに複数のオルタが返信できます。上限は`/config` > `動作` > `トリガーの動作`で設定します。
- Webhookメッセージに直接返信すると、そのペルソナとの会話を続けられます。
- `/persona import`でオルタの選択肢を選ぶと追加できます。管理には`/persona`と`/persona remove`を使います。

返信先の決定とWebhookの識別の仕組みは、[マルチペルソナのアーキテクチャ](/en/architecture/subsystems/multi-persona/)を参照してください。

## 性格の形成

ペルソナの見た目、話し方、動作を微調整します。

### 属性
<!-- anchor: attributes -->

`/config` > `ペルソナ` > [アイデンティティとパーソナリティ] を開いて、性格特性または身体的詳細 (`friendly`、`red hair`、または`ends sentences with *Nya~*`など) を定義します。

### サンプル会話
<!-- anchor: sample-dialogues -->

`/config` > `ペルソナ` > [アイデンティティとパーソナリティ] を開き、`{user}`および`{bot}`プレースホルダーを使用した例で彼女の話し方を教えます。

- `{user}`: 実際のユーザーの表示名またはニックネームに置き換えられます。
- `{bot}`: 現在のペルソナ名に置き換えられます。

```text
{user}: What's your favorite hobby?
{bot}: Fufu~ I like knitting tiny clothes for tiny plushies~♥
```

効果的なサンプルダイアログのヒント:

- 伝えるのではなく示すような自然なやりとりを書きましょう。
- 彼女に使ってほしい口調や語彙を示します。
- いくつかの例に多様性を加えて、一般化できるようにします。

### 名前とアバター

`/config` > `ペルソナ` > [アイデンティティとパーソナリティ] を開いて、自分自身を何と呼ぶかを設定し、プロフィール写真をアップロードします。

`/config` > `動作` > `一般的な動作` でカスタムシステムプロンプトを設定することもできます。[動作の調整](/ja/features/chatting-personality/behavior-tweaking/) を参照してください。

### ネーミングの習慣

サーバー管理者は、`/config` > `ペルソナ` > [名前付けの習慣] を開いて、ペルソナがメンバーにどのように対応するかを設定できます。

- 男性、女性、中立の接頭辞、接尾辞、およびアドレス用語を個別に設定します。
- 異なるペルソナが、同じユーザーを異なる肩書きで呼ぶことができます (たとえば、あるペルソナは「キャプテン」と呼び、別のペルソナは「センパイ」と呼びます)。
- 個人的なオーバーライドは、サーバー間で各ユーザーに従います。[パーソナライゼーション](/ja/features/knowledge/personalization/)を参照してください。

## スプライト（表情アバター）
<!-- anchor: sprites-emotion-avatars -->

スプライトは、感情を反映するために会話中にペルソナが切り替わる代替アバターです (`happy`、`mad`、`embarrassed`など)。

返信するとき、彼女は自分の感情に合ったスプライトを選択します。これを使用するには、返信行を`PersonaName (label):`で開始し、Discordが一致するスプライトアバターを使用してそのメッセージを配信します。適合するスプライトがない場合、彼女はデフォルトのアバターで応答します。

`/config` > `ペルソナ` > スプライトでスプライトを管理します (サーバーの管理が必要):

- **追加または置換**: ペルソナを選択し、ラベルを指定し、画像 (PNG、JPG、またはGIF) をアップロードし、必要に応じて、いつ表示するかを説明する使用手順を記述します。
- **編集**: 既存のスプライトのラベル、画像、または説明を更新します。
- **削除**: 不要になったスプライトを削除します。
- **エクスポートとインポート**: ペルソナの完全なスプライトパックをファイルとして共有またはバックアップします。

`アイデンティティとして保存`トグルは、メッセージ作成者をDiscordの`Label (Persona)`として表示します。これは、複数の形式を持つ文字に便利です。

デフォルトのペルソナのアバターを置き換えると、元のキャラクターが描かれているため、組み込みのスプライトがクリアされます。自分で追加したスプライトはそのまま残ります。`/persona default`を実行すると、組み込みのスプライトが復元されます。

## チャンネル別のペルソナ選択

サーバー全体の設定を変更せずに、特定のチャネルでどのペルソナが返信するかを選択するには、パーソナルスポットライトを使用します。[パーソナライゼーション](/ja/features/knowledge/personalization/#personal-spotlight)を参照してください。
