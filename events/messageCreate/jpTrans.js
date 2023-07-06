const {translate} = require('bing-translate-api');

module.exports = (client, message) => {
    const genCH = client.channels.cache.get(process.env.GENERAL_ID);

    if(message.author.bot || message.channel.id !== genCH.id || message.attachments.size > 0) return;

        translate(message.content, null, 'en').then(res=>{
            if(res.language.from ==='ja' )
            message.reply("> "+res.translation);
        }).catch(err=>{
        });

    /*
    const genCH = client.channels.cache.get(process.env.GENERAL_ID);
    if(message.channel.id === genCH) {
        const translated = await translate(message.content, {to: "en"}, {from: "ja"});
        genCH.send(translated);
    }
    */
};