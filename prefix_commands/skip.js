module.exports = {
  name: 'skip',
  inVoiceChannel: true,
  run: async (client, message) => {
    const queue = client.distube.getQueue(message)
    if (!queue) return message.channel.send(`${client.emotes.error} | バカ！ There is nothing in the queue right now!`)
    try {
      const song = await queue.skip()
      message.channel.send(`${client.emotes.success} | Skipped current song! Now playing:\n${song.name}`)
    } catch (e) {
      message.channel.send(`${client.emotes.error} | Oops! An error popped up: ${e}`)
    }
  }
}
