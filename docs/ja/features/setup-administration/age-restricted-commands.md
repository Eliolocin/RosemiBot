---
title: "年齢制限のあるコマンド"
sidebar:
  order: 3
---

TomoriBotは、成人専用の`/nsfw`コマンドカテゴリをDiscordの組み込みの年齢制限の背後に保持しており、オプトインするまで非表示になっています。このページでは、それらにアクセスする方法と動作する場所について説明します。

## 年齢制限のあるコマンドを有効にする

1. Discordで、`User Settings` > `Privacy & Safety`を開きます。
2. `Allow access to age-restricted commands in apps`をオンにします。18歳以上である必要があります。
3. `Age-Restricted Channel`とマークされたチャネルで年齢制限のあるコマンドを実行します。チャンネルをマークするには、チャンネルを右クリックし、`Edit Channel`を選択し、`Age-Restricted Channel`をオンにします (チャンネルの管理権限が必要です)。

コマンドが制限されており、チャネルに年齢制限のマークが付けられていない場合、Discordはコマンドを表示または実行できません。

## 制限されている内容

- **NSFWコンテンツ設定**：`/nsfw jailbreaks`は、厳しすぎる*プロバイダー側*のコンテンツフィルターに対する回避策を切り替えます（TomoriBot自体には独自の安全装置は追加されていません）。詳細は[動作の微調整](/ja/features/chatting-personality/behavior-tweaking/#検閲なしの出力)をご覧ください。

画像および動画生成は、設定されたプロバイダーとサーバーの機能設定によって個別に管理されており、`/nsfw`コマンドカテゴリによる制限の対象ではありません。

年齢制限のあるコンテンツは成人ユーザー専用です。責任を持って利用し、Discordの[コミュニティガイドライン](https://discord.com/guidelines)に従ってください。`/help`コマンドで`動作`、次に`年齢制限コマンド`を選択すると、Discord内で同じガイドを確認できます。
