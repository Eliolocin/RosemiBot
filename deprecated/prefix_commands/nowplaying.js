module.exports = {
  name: 'nowplaying',
  aliases: ['np'],
  inVoiceChannel: true,
  run: async (client, message, args) => {
    const queue = client.distube.getQueue(message)
    if (!queue) return message.channel.send(`${client.emotes.error} | バカ！ There is nothing in the queue right now!`)
    const song = queue.songs[0]
    message.channel.send(`${client.emotes.play} | Right now I'm playing **\`${song.name}\`**, by ${song.user}`)
  }
}
