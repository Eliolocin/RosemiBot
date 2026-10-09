export default {
  matrix: {
    encryption_unlinked: {
      title: `Matrixブリッジを停止しました`,
      description: `Matrixルーム \`{room_id}\` でエンドツーエンド暗号化が有効化されたため、このチャンネルとのリンクを解除し、メッセージの転送を停止しました。Matrixの暗号化は無効化できません。

ブリッジを継続するには、暗号化されていない新しいMatrixルームを作成し、Botアカウントを招待して {link_command} でリンクしてください。`,
    },
    notices: {
      invited: `TomoriBotがこのルームに参加しました。

セットアップを完了するには:
1. Discordで、ブリッジしたいチャンネルで {link_command} を実行します。
2. {room_id_path} にあるこのルームの Internal Room ID を貼り付けます。

重要:
- このルームは非暗号化のままにしてください。
- リンク後は、このルームで普通に話しかければ使えます。
- Matrix側で使えるテキストコマンドは {kill_command} と {refresh_command} のみです。

詳しい手順と制限一覧は、Discordで {help_command} を確認してください。`,
      linked: `このルームはDiscordチャンネル {channel_name} とブリッジされました。

クイックヒント:
- ここで普通に話しかければTomoriBotと会話できます。
- Matrix側で使えるテキストコマンドは {kill_command} と {refresh_command} のみです。
- Slash Command、DM、ピン留めはMatrixから使えません。
- カスタム絵文字/Markdownは安定して描画されず、Embedはプレーンテキストとして転送されます。
- Matrixユーザーの個人メモリはサーバーメモリにフォールバックします。

詳しい手順と現在の制限は、Discordで {help_command} を確認してください。`,
    },
  },
};
