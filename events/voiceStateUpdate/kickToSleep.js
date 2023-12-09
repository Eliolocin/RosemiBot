
module.exports = (client, oldVoiceState, newVoiceState) => {
    const genCH = client.channels.cache.get(process.env.GENERAL_ID)
        
        let active = false;
    
        const date = new Date()

        if (!active) return;

        if ( newVoiceState.channelId === null || !newVoiceState.member.roles.cache.has(process.env.SLEEP_ID) || (date.getHours() < 22 && date.getHours() > 5 )) return;

        const tryReact = [
                `It's no use trying to join a VC, <@!${newVoiceState.member.id}>.`,
                `'*tugs on <@!${newVoiceState.member.id}>'s leash*' Bad Dog! Stop trying to join a VC! `,
                `Just masturbate and go to sleep <@!${newVoiceState.member.id}>!`,
                `Stop trying to spend time here and spend time in bed <@!${newVoiceState.member.id}>.`,
                `You signed up for this <@!${newVoiceState.member.id}>, now stop struggling to join a VC!`,
                `Sorry <@!${newVoiceState.member.id}>, but detainment is absolute! `,
                `No more playing <@!${newVoiceState.member.id}>!`,
                `Why are you so stubborn <@!${newVoiceState.member.id}>! Calm down and sleep!`,
        ]

        const hideReact = [
            `So you want to go down a "one last game" spiral in the <#${process.env.DEPRIVE_ID}> <@!${newVoiceState.member.id}>? Suit yourself.`,
            `Trying to bypass my detainment through the <#${process.env.DEPRIVE_ID}>, <@!${newVoiceState.member.id}>? You'll regret that (more specifically, your body will)`,
            `Why even sign up for early sleep when you avoid it in the <#${process.env.DEPRIVE_ID}> anyways <@!${newVoiceState.member.id}>?`,
            `<@!${newVoiceState.member.id}>, no cookies for you if you don't get out of the <#${process.env.DEPRIVE_ID}> right this instant!`,
            `<@!${newVoiceState.member.id}>, have fun getting 4 hours of sleep from the <#${process.env.DEPRIVE_ID}> you Dingus.`,
            `You're lucky I can't touch you in the <#${process.env.DEPRIVE_ID}> <@!${newVoiceState.member.id}>, don't stay there too long! `,
            `Going into the <#${process.env.DEPRIVE_ID}> <@!${newVoiceState.member.id}>? You spineless coward.`,
        ]


        if( newVoiceState.channelId !== process.env.DEPRIVE_ID ) {
            //if(date.getHours() >= 21 || date.getHours() <= 5) {
            newVoiceState.disconnect();
            let random = Math.floor(Math.random()*tryReact.length);
            genCH.send(tryReact[random]);

            //genCH.send(`Atatata! As part of the Early Sleep Gang you cannot join back in a VC <@${newVoiceState.member.id}>, go to sleep!`);
        }

        else {
            //if(date.getHours() >= 21 || date.getHours() <= 5) {
            if (oldVoiceState.channelId === null){
                let random = Math.floor(Math.random()*hideReact.length);
                genCH.send(hideReact[random]);
            }


            //genCH.send(`Atatata! As part of the Early Sleep Gang you cannot join back in a VC <@${newVoiceState.member.id}>, go to sleep!`);
        }





};