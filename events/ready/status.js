const { ActivityType } = require('discord.js');

module.exports = async (client) => {
    
// .on is a Listener (if ___ occurs, do ___)
    console.log(`${client.user.tag} up and growing!`)
    setInterval(()=>{
        let random = Math.floor(Math.random()*status.length);
        client.user.setActivity(status[random]);
    }, 600000 );

// Possible statuses for Rosemi
let status = [
    {
    name: 'Kawaii Future Bass music',
    type: ActivityType.Listening ,
    },
    {
        name: '=help',
        type: ActivityType.Listening ,
        },
    {
    name: 'birds chirping',
    type: ActivityType.Listening ,
    },
    {
    name: 'cute marmot videos',
    type: ActivityType.Watching ,
    },
    {
        name: 'out for =help',
        type: ActivityType.Watching ,
        },
    {
    name: 'over Jack-Oᶠᶠ',
    type: ActivityType.Watching ,
    },
]

    client.user.setActivity(status[1]);
};

/*
    {
    name: 'birds chirping',
    type: ActivityType.Listening ,
    },
    {
        name: '=help',
        type: ActivityType.Listening ,
        },
    {
    name: 'funny podcasts',
    type: ActivityType.Listening ,
    },
    {
    name: 'over rosebuds',
    type: ActivityType.Watching ,
    },
    {
        name: 'out for =help',
        type: ActivityType.Watching ,
        },
    {
    name: 'hamsters run around',
    type: ActivityType.Watching ,
    },


*/