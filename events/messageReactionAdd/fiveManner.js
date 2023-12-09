const consoleLog = require("../ready/consoleLog");

module.exports = async (client, reaction) => {
    const channel = client.channels.cache.get(reaction.message.channel.id);
    var reactcount = reaction.count;
    var mancount = 5;
    //var emojiname = reaction.emoji.name

    if(reactcount === mancount+1) {

        reaction.users.remove()

        setTimeout(async () => {

            var users = await reaction.users.fetch()
            channel.send(`***A team has been formed from the following players!***`)
            for(let user of users.values() ) {
                channel.send(`${user}`)
            }
            channel.send(`https://walfiegif.files.wordpress.com/2023/07/out-transparent-129.gif?w=850`)

        }, 3000);
        //channel.send("Reaction detected!")
    }

};