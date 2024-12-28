module.exports = {
  name: "ping",
  description: "Pong!",
  // devOnly: Boolean,
  // testOnly: Boolean,
  // options: Object[],
  // deleted: Boolean,

  callback: async (client, interaction, profileData) => {
    await interaction.deferReply();
    const reply = await interaction.fetchReply();

    const ping = reply.createdTimestamp - interaction.createdTimestamp;
    const actualspeed = ping;

    if (actualspeed > 250)
      interaction.editReply(
        `Pong! I responded to Discord within **${actualspeed}ms**! | Discord is responding to me **${client.ws.ping}ms** fast! Looks like I am a bit laggy today (￣▽￣*)ゞ`,
      );
    else
      interaction.editReply(
        `Pong! I responded to Discord within **${actualspeed}ms**! | Discord is responding to me **${client.ws.ping}ms** fast!`,
      );
  },
};

/*
{
        name: 'add',
        description: 'Adds two numbers',
        options: [
            {
                name: 'first-number',
                description: 'The first number',
                type: ApplicationCommandOptionType.Number,
                choices: [
                    {
                        name: 'one',
                        value: 1
                    },
                    {
                        name: 'three',
                        value: 3
                    },
                    {
                        name: 'sixty-nine',
                        value: 69
                    }
                ],
                required: true,
            },
                {
                    name: 'second-number',
                    description: 'The second number',
                    type: ApplicationCommandOptionType.Number,
                    required: true,
                }
            
        ]
    }
];
*/
