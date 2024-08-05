const {translate} = require('bing-translate-api');
const deepltrans = require("deepl");
const {EmbedBuilder, ApplicationCommandOptionType,ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType} = require('discord.js');
const left = new ButtonBuilder()
    .setLabel('Previous')
    .setStyle(ButtonStyle.Primary)
    .setCustomId('prev-page')
    .setDisabled(true);
const right = new ButtonBuilder()
    .setLabel('Next')
    .setStyle(ButtonStyle.Primary)
    .setCustomId('next-page')
const buttonRow = new ActionRowBuilder().addComponents(left, right);

module.exports = (client, message) => {
    //const genCH = client.channels.cache.get(process.env.GENERAL_ID);

    if(  !message.content.includes("><") && !message.author.bot && message.channel.id !== process.env.COMMANDS_ID && message.attachments.size === 0) {

        translate(message.content, null, 'en').then(res=>{
            if(res.language.from ==='ja' )
            //message.reply("```bash\n"+res.translation+"\n```");
            deepltrans({
                free_api: true,
                text: message.content,
                target_lang: 'EN',
                auth_key: process.env.DEEPL_KEY,
              }).then(result => {
                message.reply("```bash\n"+result.data.translations[0].text+"\n```");
                //console.log(result.data);
                //console.log(result.data.translations);
                })
        }).catch(err=>{
            console.error(err);
        });





















    }
    /*
    const genCH = client.channels.cache.get(process.env.GENERAL_ID);
    if(message.channel.id === genCH) {
        const translated = await translate(message.content, {to: "en"}, {from: "ja"});
        genCH.send(translated);
    }
    */
};