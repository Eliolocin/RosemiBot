export default {
  matrix: {
    description: `把 Discord 頻道連結到 Matrix 房間，進行雙向轉送。`,
    link: {
      description: `把 Discord 頻道連結到 Matrix 房間，進行雙向轉送`,
      channel_description: `要連結的 Discord 頻道`,
      room_description: `要連結的 Matrix 房間 ID（例如 !abc:matrix.org）`,
      success_title: `Matrix 房間已連結`,
      success_description: `<#{channel_id}> 現在已橋接到 \`{room_id}\`。我的訊息會出現在 Matrix 房間，Matrix 的訊息也會出現在這裡。

設定步驟、Matrix 專屬的指令注意事項與目前的功能限制清單，請開啟 {help_matrix}，前往整合 > Matrix。`,
      invalid_room_title: `房間 ID 無效`,
      invalid_room_description: `Matrix 房間 ID 必須以 \`!\` 開頭，並且包含 \`:\`（例如 \`!abc:matrix.org\`）。請確認房間 ID 後再試一次。`,
      join_failed_description: `<#{channel_id}> 已連結到 \`{room_id}\`，但我無法自動加入這個 Matrix 房間。請手動邀請 \`{bot_user_id}\` 加入。如果你需要設定步驟與限制清單，請開啟 {help_matrix} 並前往整合 > Matrix。`,
      encrypted_room_title: `無法連結加密房間`,
      encrypted_room_description: `\`{room_id}\` 啟用了端對端加密。Matrix 的加密一旦設定就無法停用，因此這個房間不能用來橋接。請建立一個**未加密**的新 Matrix 房間，改為邀請 \`{bot_user_id}\` 加入。`,
      encryption_unknown_title: `無法驗證房間加密狀態`,
      encryption_unknown_description: `我無法確認 \`{room_id}\` 未加密，因此未進行連結。因為訊息會以明文轉發，我只橋接能夠驗證的房間。

請邀請 \`{bot_user_id}\` 加入房間，等待其加入後再次執行此指令。如果 bot 已在房間內，可能是主伺服器無法連線，請過幾分鐘後再試。`,
      matrix_not_configured_title: `Matrix 橋接無法使用`,
      matrix_not_configured_description: `這個 bot 執行個體沒有設定 Matrix 橋接。請聯絡 bot 擁有者啟用。`,
    },
    unlink: {
      description: `移除 Discord 頻道上的 Matrix 橋接連結`,
      channel_description: `要與其 Matrix 房間解除連結的 Discord 頻道`,
      success_title: `Matrix 房間已解除連結`,
      success_description: `<#{channel_id}> 已經不再橋接到任何 Matrix 房間。`,
      not_linked_title: `尚未連結`,
      not_linked_description: `<#{channel_id}> 沒有連結任何 Matrix 房間。`,
    },
  },
};
