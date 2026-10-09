export default {
  matrix: {
    description: `把 Discord 频道连接到 Matrix 房间，实现双向转发。`,
    link: {
      description: `把一个 Discord 频道连接到 Matrix 房间，实现双向转发`,
      channel_description: `要连接的 Discord 频道`,
      room_description: `要连接的 Matrix 房间 ID（例如 !abc:matrix.org）`,
      success_title: `Matrix 房间已连接`,
      success_description: `<#{channel_id}> 现在已桥接到 \`{room_id}\`。我发的消息会出现在 Matrix 房间里，Matrix 里的消息也会出现在这里。

打开 {help_matrix}，进入「集成 > Matrix」，可以看设置步骤、Matrix 专用的指令说明，以及目前的限制列表。`,
      invalid_room_title: `房间 ID 无效`,
      invalid_room_description: `Matrix 房间 ID 必须以 \`!\` 开头，并且包含一个 \`:\`（例如 \`!abc:matrix.org\`）。请检查房间 ID 后重试。`,
      join_failed_description: `<#{channel_id}> 已连接到 \`{room_id}\`，但我没能自动加入这个 Matrix 房间。请手动邀请 \`{bot_user_id}\` 加入。如果需要设置步骤和限制列表，请打开 {help_matrix}，进入「集成 > Matrix」。`,
      encrypted_room_title: `无法连接加密房间`,
      encrypted_room_description: `\`{room_id}\` 开启了端到端加密。Matrix 加密一旦设置就无法关闭，所以这个房间不能用来桥接。请新建一个**不加密**的 Matrix 房间，然后邀请 \`{bot_user_id}\` 加入。`,
      encryption_unknown_title: `无法验证房间加密状态`,
      encryption_unknown_description: `我无法确认 \`{room_id}\` 未加密，因此未进行关联。因为消息以明文形式转发，我只桥接能够验证的房间。

请邀请 \`{bot_user_id}\` 加入房间，等待其加入后再运行此指令。如果 bot 已在房间内，可能是主服务器无法连接，请过几分钟再试。`,
      matrix_not_configured_title: `Matrix 桥接不可用`,
      matrix_not_configured_description: `这个 bot 实例还没有配置 Matrix 桥接。请联系 bot 的所有者开启。`,
    },
    unlink: {
      description: `移除一个 Discord 频道上的 Matrix 桥接连接`,
      channel_description: `要断开 Matrix 房间连接的 Discord 频道`,
      success_title: `Matrix 房间已断开`,
      success_description: `<#{channel_id}> 已不再桥接到任何 Matrix 房间。`,
      not_linked_title: `未连接`,
      not_linked_description: `<#{channel_id}> 没有连接任何 Matrix 房间。`,
    },
  },
};
