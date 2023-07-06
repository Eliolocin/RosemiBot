const Discord = require('discord.js')

module.exports = {
  name: 'help',
  aliases: ['h', 'cmd', 'command'],
  run: async (client, message) => {
    message.channel.send({
      embeds: [
        new Discord.EmbedBuilder()
            .setTitle('RosemiBot 3.0\'s Command List')
            .setURL('https://www.youtube.com/watch?v=mXrIBio12vI')
            .setThumbnail('https://i.imgur.com/1GJJRJl.png')
            .setDescription('**Your local video/song playing Rose!**\n'+client.commands.map(cmd => `\`${cmd.name}\``).join(', '))
            .addFields(
                {
                  name: 'My valid song filters:',
                  value: ' `\`3d\``, `\`bassboost\``, `\`echo\``, `\`karaoke\``, `\`nightcore\``, `\`vaporwave\``, `\`flanger\``, `\`gate\``, `\`haas\``, `\`reverse\``, `\`surround\``,`\`mcompand\``,`\`phaser\``,`\`tremolo\``,`\`earwax\``',
                  inline: true,
                },
                {
                    name: 'I can currently play Youtube, Spotify, and Soundcloud links/playlists!',
                    value: '`Please use the default prefix: =`',
                    inline: true,
                },
                {
                    name: 'Check out my available Slash commands!',
                    value: '`Scrape Booru images, generate them with Stable Diffusion, and more!`',
                    inline: true,
                },
            )
            .setFooter({
                text: 'Lazily made by Aso19',
                //iconURL: 'https://i.imgur.com/4AZwvbD.png'
            })
            //.setColor('#f4ff94')    
            .setColor('#DE3163')    
      ]
    })
  }
}