const { ChannelType } = require('discord.js');

module.exports = (client, thread) => {
    const genCH = client.channels.cache.get(process.env.GENERAL_ID)
    if (thread.parent.type === ChannelType.GuildForum && thread.parent.id === process.env.PIRATE_ID) {
        genCH.send(`Yarr! New treasure has been plundered in the <#${process.env.PIRATE_ID}>!`);
        genCH.send(`**${thread.name}**`);
        genCH.send(`https://media.tenor.com/dadRa781ggoAAAAC/rosemi-yeah.gif`);
        //genCH.send(`https://media.tenor.com/kblBg1Kxv9YAAAAC/guilty-gear-anime.gif`);
    }

    else if (thread.parent.type === ChannelType.GuildForum && thread.parent.id === process.env.GPT_ID) {
        genCH.send(`A new waifu has spawned in <#${process.env.GPT_ID}>!`);
        genCH.send(`**${thread.name}**`);
        genCH.send(`https://media.tenor.com/dadRa781ggoAAAAC/rosemi-yeah.gif`);
        //genCH.send(`https://media.tenor.com/kblBg1Kxv9YAAAAC/guilty-gear-anime.gif`);
    } 
    else if (thread.parent.type === ChannelType.GuildForum && thread.parent.id === process.env.JP_ID) {
        genCH.send(`新しい教材が着いていました！<#${process.env.JP_ID}>に！`);
        genCH.send(`**${thread.name}**`);
        genCH.send(`https://media.tenor.com/dadRa781ggoAAAAC/rosemi-yeah.gif`);
        //genCH.send(`https://media.tenor.com/kblBg1Kxv9YAAAAC/guilty-gear-anime.gif`);
    } 
};