module.exports = (client, message) => {
    const thugCH = client.channels.cache.get(process.env.THUG_ID);
    const genCH = client.channels.cache.get(process.env.GENERAL_ID);

    if(message.author.bot || message.channel.id !== thugCH.id || message.attachments.size === 0) return;
    genCH.send(`~~New thugshaker video/s just dropped off at <#${thugCH.id}>, feel free to use it to get banned on social media platforms!~~`);
    

    /*
    const genCH = client.channels.cache.get(process.env.GENERAL_ID);
    if(message.channel.id === genCH) {
        const translated = await translate(message.content, {to: "en"}, {from: "ja"});
        genCH.send(translated);
    }
    */
};