const Discord = require('discord.js')

module.exports = {
  name: 'help',
  aliases: ['h', 'cmd', 'command'],
  run: async (client, message) => {
    const jackOFF = client.guilds.cache.get(process.env.JACKO_ID)
    const aso19 = jackOFF.members.cache.get(process.env.ME_ID)
    const rosemi = jackOFF.members.cache.get(process.env.ROSEID)

    message.channel.send({
      embeds: [
        new Discord.EmbedBuilder()
            .setTitle('RosemiBot 3.2\'s Command List')
            .setURL('https://www.youtube.com/watch?v=mXrIBio12vI')
            //.setThumbnail(`${process.env.ROSEMIDP}`)
            .setThumbnail(rosemi.displayAvatarURL())
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
                    value: '`Scrape Booru images, generate them with Stable Diffusion, and more coming!`',
                    inline: true,
                },
                {
                  name: 'If you want to chat me, simply call my name, "Rosemi", in your messages!',
                  value: '`Be nice!`',
                  inline: true,
              },
            )
            .setFooter({
                text: 'Lazily made by Aso19',
                iconURL: aso19.displayAvatarURL()
            })
            //.setColor('#f4ff94')    
            .setColor('#DE3163')    
      ]
    })
  }
}