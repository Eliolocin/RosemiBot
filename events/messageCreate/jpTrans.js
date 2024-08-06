const {translate} = require('bing-translate-api');
//const LanguageDetect = require('languagedetect');
//const lngDetector = new LanguageDetect();
//const detectLang = require("@haileybot/language-detector");
const deepltrans = require("deepl");
const googleT = require('google-translate-api-x');

const Kuroshiro = require("kuroshiro");
const KuromojiAnalyzer = require("kuroshiro-analyzer-kuromoji");


const {EmbedBuilder, ApplicationCommandOptionType,ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType} = require('discord.js');


module.exports = async (client, message) => {
    //const genCH = client.channels.cache.get(process.env.GENERAL_ID);\

   
    //const ress = kuroshiro.Util.hasJapanese(message.content);
    //console.log(ress);

    if(  !message.content.includes("><") && !message.author.bot && message.channel.id !== process.env.COMMANDS_ID && message.attachments.size === 0) {
        
        //const kuroshiro = new Kuroshiro.default();
        //await kuroshiro.init(new KuromojiAnalyzer());
        //message.reply(await kuroshiro.convert(message.content, { to: "hiragana" }));
        //console.log(kuroshiro.Util.hasJapanese(message.content));


        //var dlTranslation = ''; // DeepL translation
        //var ggTranslation = ''; // Google translation
        //var jpDetected = false;
        //var furiText; // Text with furigana

        translate(message.content, null, 'en').then(res=>{
            if(!(res.language.from ==='ja')) return;

            deepltrans({
                free_api: true,
                text: message.content,
                target_lang: 'EN',
                auth_key: process.env.DEEPL_KEY,
              }).then(async result => {

                //if(result.data.translations[0].detected_source_language === "JA")
                //jpDetected = true;

                //console.log(result.data.translations[0].text);
                var dlTranslation = result.data.translations[0].text;
                var ggTranslation = await googleT(message.content, {to:'en', forceBatch:false});
                var biTranslation = res.translation;

                var embed = new EmbedBuilder()
                .setColor('#DE3163')  
                .setDescription(ggTranslation.text)
                //.setFooter({ text: '*Translated by Google*' });
                
                //const sentmsg = message.reply("```bash\n"+ggTranslation.text+"\n"+dlTranslation+"\n```");
                const ggButton = new ButtonBuilder()
                    .setLabel('Google')
                    .setStyle(ButtonStyle.Danger)
                    .setCustomId('google-trans')
                    .setDisabled(true);
                const dlButton = new ButtonBuilder()
                    .setLabel('DeepL')
                    .setStyle(ButtonStyle.Primary)
                    .setCustomId('deepl-trans')
                const biButton = new ButtonBuilder()
                    .setLabel('Bing')
                    .setStyle(ButtonStyle.Success)
                    .setCustomId('bing-trans')
                const buttonRow = new ActionRowBuilder().addComponents(ggButton, dlButton, biButton);
                
                const sentmsg = await message.reply({embeds:[embed], components:[buttonRow]});

                const collector = sentmsg.createMessageComponentCollector({
                    componentType: ComponentType.Button,
                    time: 90000,
                });

                //message.reply(sentmsg)
                collector.on('collect', (onpress)=>{
                    if(onpress.customId === 'google-trans'){
                        ggButton.setDisabled(true);
                        dlButton.setDisabled(false);
                        biButton.setDisabled(false);
                        embed.setColor('#DE3163');  
                        embed.setDescription(ggTranslation.text);
                        onpress.update({
                            embeds:[embed],
                            components:[buttonRow],
                        });
                        return;
                    }
                    if(onpress.customId === 'deepl-trans'){
                        ggButton.setDisabled(false);
                        dlButton.setDisabled(true);
                        biButton.setDisabled(false);
                        embed.setColor('#09B1CE');  
                        embed.setDescription(dlTranslation);
                        onpress.update({
                            embeds:[embed],
                            components:[buttonRow],
                        });
                        return;
                    }
                    if(onpress.customId === 'bing-trans'){
                        ggButton.setDisabled(false);
                        dlButton.setDisabled(false);
                        biButton.setDisabled(true);
                        embed.setColor('#7DDA58');  
                        embed.setDescription(biTranslation);
                        onpress.update({
                            embeds:[embed],
                            components:[buttonRow],
                        });
                        return;
                    }



                })

                collector.on('end', ()=>{
                    ggButton.setDisabled(true);
                    dlButton.setDisabled(true);
                    bingButton.setDisabled(true);
                })
            
                
            
            
            
            })
            }).catch(err=>{
                console.error(err);
            });
            }
    }





    
    /*
    const genCH = client.channels.cache.get(process.env.GENERAL_ID);
    if(message.channel.id === genCH) {
        const translated = await translate(message.content, {to: "en"}, {from: "ja"});
        genCH.send(translated);
    }
    */


/*
translate(message.content, null, 'en').then(async res=>{
    if(res.language.from ==='ja' ){
        deepltrans({
            free_api: true,
            text: message.content,
            target_lang: 'EN',
            auth_key: process.env.DEEPL_KEY,
          }).then(result => {
            console.log(result.data.translations[0].text);
            dlTranslation = result.data.translations[0].text;
            //message.reply("```bash\n"+result.data.translations[0].text+"\n```");
            console.log(dlTranslation);
            message.reply("```bash\n"+ggTranslation+"\n"+dlTranslation+"\n```");
        })

        ggTranslation = await googleT(message.content, {to:'en', forceBatch:false});

        message.reply("```bash\n"+ggTranslation+"\n"+dlTranslation+"\n```");
    }

    
}).catch(err=>{
    console.error(err);
});
*/