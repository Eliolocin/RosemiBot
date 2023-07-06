module.exports = (client, message) => {
    
    const genCH = client.channels.cache.get(process.env.GENERAL_ID)
    const patchCH = client.channels.cache.get(process.env.PATCHES_ID)

    if(message.guild) return;

    else if(message.content.startsWith("=patch")){
        patchCH.send(message.content.slice(3));
    }
    else{
        genCH.send(message.content);
        //genCH.send(message.content);
    }

    /*
    if ( message.channel.id !== process.env.ROSEDMS ) return;

    if (message.content.startsWith("!p")){
        patchCH.send(message.content.slice(3));
    }

    if (message.content.startsWith("!g")){

    }
    */
};