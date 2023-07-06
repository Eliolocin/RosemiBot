const Discord = require('discord.js')

module.exports = {
  name: 'coinflip',
  aliases: ['cf', 'flip'],
  run: async (client, message) => {
    if(Math.round(Math.random())){
      message.channel.send({
        embeds: [
          new Discord.EmbedBuilder()
              .setTitle('I got Heads!')
              .setColor('#DE3163')
              .setThumbnail('https://i.imgur.com/v5ISQCD.png')
        ]
      })
    }
    else {
      message.channel.send({
        embeds: [
          new Discord.EmbedBuilder()
          .setTitle('I got Tails!')
          .setColor('#DE3163')
          .setThumbnail('https://i.imgur.com/lMVN8FF.png')
        ]
      })
    }

  }
}