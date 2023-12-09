
module.exports = (client, oldVoiceState, newVoiceState) => {

    const joinMemID = newVoiceState.member.id
    const jackOFF = client.guilds.cache.get(process.env.JACKO_ID)

    if( joinMemID === process.env.ME_ID ) return;

    const member = jackOFF.members.cache.get(joinMemID)
    

        if ( oldVoiceState.channelId === process.env.LEAGUEVC_ID ) {
            member.setNickname(NaN);
        }


        if( newVoiceState.channelId === process.env.LEAGUEVC_ID ) {

            switch(joinMemID){
                case "368798741156593664":
                    member.setNickname("Bladesurger");
                    break;
                case "205013067170316288":
                    member.setNickname("Rosefeather");
                    break;
                case "304584891063074816":
                    member.setNickname("Basted Turkey");
                    break;
                case "631742515141279754":
                    member.setNickname("I NEVER MISS");
                    break;
                case "730411908636868729":
                    member.setNickname("HAWG RIDAAAAAAH");
                    break;
                case "276082866436177932":
                    member.setNickname("Chickenjoy Solo");
                    break;
            }
            
        }






};