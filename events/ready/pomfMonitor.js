

const schedule = require('node-schedule');


module.exports = (client) => {

    const pomfCH = client.channels.cache.get(process.env.POMF_ID)
    const pomfAPI = 'https://pomf.tv/api/streams/getinfo.php?data=onlinestreams'


    let active = true;

    if(active){

        const repeat = schedule.scheduleJob('*/10 * * * *', function() {
        fetch(pomfAPI)
        .then(response => {
            if (!response.ok) {
                console.log("Response is bad!")
            }
            return response.json();
        })
        .then(data => {

                  pomfCH.bulkDelete(99).then(()=>{
                    var pomfMessage = '';
                    //console.log(data.count)
                    //console.log(data.onlinelist)
                    let streams = Object.keys(data.onlinelist)
                    streams.forEach((stream) =>{ // euforia : { }
                        let streaminfo = data.onlinelist[stream];
                        pomfCH.send(`**=====================================**\n# [${stream}](https://pomf.tv/stream/${stream})\n**${streaminfo.streamtitle}**\n**${streaminfo.streaminfo}**\n${streaminfo.viewers} viewers since ${streaminfo.starttime}\nhttps://eu1.pomf.tv/img/${stream}.png`)
                    })
                  });
                

            /*
            pomfCH.messages.fetch(`1191922314032468108`).then(message => {
                message.edit(pomfMessage);
            }).catch(err=> {
                pomfCH.send("An API error occured! =w=")
            })*/
            
            /*for (var stream in data.onlinelist) {
                pomfCH.send(stream)
            }*/
            
        })
        .catch(error => {
            console.log("Error message: "+ error)
        });
        });
        

    }





};