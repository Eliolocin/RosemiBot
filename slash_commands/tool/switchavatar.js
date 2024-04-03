module.exports = {
    name: 'switchavatar',
    description: 'Change profile picture of Rosemi.',
    devOnly: true,
    // testOnly: Boolean,
    // options: Object[],
    // deleted: Boolean,
    options:
    [
        {
            name: 'picture',
            description: 'Please enter the profile picture you want Rosemi to use!',
            type: 11, // Attachment type (For file attachments)
            required: true,
        }
    ],

    callback: async (client, interaction) =>{
        await interaction.deferReply();
        const avatar = interaction.options.getAttachment('picture');
        await client.user.setAvatar(avatar.url)
        interaction.editReply(`Avatar changed successfully! (o゜▽゜)o☆`);
    }
}

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