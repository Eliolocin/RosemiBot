export default {
  matrix: {
    encryption_unlinked: {
      title: `Matrix 橋接已停止`,
      description: `Matrix 房間 \`{room_id}\` 開啟了端對端加密，因此我已解除它與此頻道的連結並停止轉發訊息。Matrix 加密一旦開啟便無法關閉。

若要繼續橋接，請建立一個未加密的新 Matrix 房間，邀請 bot 帳號，並使用 {link_command} 進行連結。`,
    },
    notices: {
      invited: `TomoriBot 已加入這個房間。

完成設定：
1. 在 Discord 中，到你想要橋接的頻道執行 {link_command}。
2. 貼上這個房間的 Internal Room ID，位置在 {room_id_path}。

重要事項：
- 這個房間必須保持未加密。
- 連結完成後，就可以直接在這裡正常對話。
- Matrix 文字指令只有 {kill_command} 與 {refresh_command}。

完整說明與限制清單請在 Discord 使用 {help_command}。`,
      linked: `這個房間已經橋接到 Discord 頻道 {channel_name}。

快速提示：
- 直接在這裡正常聊天，就能和 TomoriBot 對話。
- Matrix 文字指令只有 {kill_command} 與 {refresh_command}。
- 斜線指令、私訊與釘選在 Matrix 都無法使用。
- 自訂表情符號與 Markdown 不一定能正常顯示，嵌入訊息也會以純文字轉送。
- Matrix 使用者的個人記憶會退回使用伺服器記憶。

完整說明與目前限制請在 Discord 使用 {help_command}。`,
    },
  },
};
