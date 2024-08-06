const {EmbedBuilder, ApplicationCommandOptionType,ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType} = require('discord.js');
const NanaAPI = require("nana-api");
const nana = new NanaAPI();
const left = new ButtonBuilder()
    .setLabel('Previous')
    .setStyle(ButtonStyle.Primary)
    .setCustomId('prev-page')
    .setDisabled(true);
const right = new ButtonBuilder()
    .setLabel('Next')
    .setStyle(ButtonStyle.Primary)
    .setCustomId('next-page')
const buttonRow = new ActionRowBuilder().addComponents(left, right);


module.exports = {
    name: 'doujin',
    description: 'Doujin functionality sourcing from Nhentai! (WIP)',
    // devOnly: Boolean,
    // testOnly: Boolean,
    // options: Object[],
    // deleted: Boolean,

    options:
    [
        {
            name:'random',
            description:'I return 4 random doujins from Nhentai.',
            type: 1, // Type 1 for subcommand
        },
        {
            name:'popular',
            description:'I return 4 popular doujins from Nhentai. (given a time period)',
            type: 1, // Type 1 for subcommand
                options:
                [
                    {
                        name: 'period',
                        description: 'Popular doujins of this day, week, or all-time?',
                        type: ApplicationCommandOptionType.String,
                        required:true,
                        choices:[
                            {
                                name:'today',
                                value:"today",
                            },
                            {
                                name:'thisweek',
                                value:"week",
                            },
                            {
                                name:'alltime',
                                value:"all",
                            },
                        ]
                    }
                ]
        },
        {
            name:'search',
            description:'I search for 4 doujins matching your query.',
            type: 1, // Type 1 for subcommand
        },
    ], 

    callback: async (client, interaction) =>{

        try{
            await interaction.deferReply();
        const doujin = interaction.options.getSubcommand();
        const results=[];
        const taglist= [];
        var idx = 0;

        switch(doujin){

            case 'random':

                for(i=0;i<4;i++){
                    results[i] = await nana.g(Math.floor(Math.random()*462120));
                    let templist = [];
                    for(j=0;j<results[i].tags.length;j++){
                        templist[j] = ' '+results[i].tags[j].name;
                    }
                    taglist[i] = templist.toString();
                }
                

                //var tags = getTags(results);

                var embed = new EmbedBuilder()
                .setColor('#DE3163')  
                .setTitle(results[idx].title.pretty + " ("+(idx+1)+"/"+results.length+")")
                .setURL(`https://nhentai.net/g/${results[idx].id}/`)
                .setImage(`https://t.nhentai.net/galleries/${results[idx].media_id}/thumb.jpg`)

                var tagbed = new EmbedBuilder()
                .setColor('#DE3163')  
                .setTitle("Tags for Doujin ID "+results[idx].id)
                .setFooter({
                text: taglist[idx],
                });


                    const reply = await interaction.editReply({
                        content:"*Here are some random Doujins...変態!*",
                        components:[buttonRow],
                        embeds:[embed, tagbed]
                    });

                    const collector = reply.createMessageComponentCollector({
                        componentType: ComponentType.Button,
                        time: 15000,
                    });
                    
                    collector.on('collect', (onpress)=>{

                        if(idx<results.length-2) right.setDisabled(false);
                            else right.setDisabled(true);

                        if(onpress.customId === 'prev-page'){
                            idx--;
                            if(idx===0) left.setDisabled(true);
                                else left.setDisabled(false);
                            if(idx===results.length-1) right.setDisabled(true);
                                else right.setDisabled(false);
                            embed.setTitle(results[idx].title.pretty + " ("+(idx+1)+"/"+results.length+")")
                            embed.setURL(`https://nhentai.net/g/${results[idx].id}/`)
                            embed.setImage(`https://t.nhentai.net/galleries/${results[idx].media_id}/thumb.jpg`)
                            tagbed.setTitle("Tags for Doujin ID "+results[idx].id)
                            tagbed.setFooter({
                                text: taglist[idx],
                            })
                            onpress.update({
                                embeds:[embed, tagbed],
                                components:[buttonRow],
                            });

                            return;
                        }
                        if(onpress.customId === 'next-page'){
                            idx++;
                            if(idx===0) left.setDisabled(true);
                                else left.setDisabled(false);
                            if(idx===results.length-1) right.setDisabled(true);
                                else right.setDisabled(false);
                            embed.setTitle(results[idx].title.pretty + " ("+(idx+1)+"/"+results.length+")")
                            embed.setURL(`https://nhentai.net/g/${results[idx].id}/`)
                            embed.setImage(`https://t.nhentai.net/galleries/${results[idx].media_id}/thumb.jpg`)
                            tagbed.setTitle("Tags for Doujin ID "+results[idx].id)
                            tagbed.setFooter({
                                text: taglist[idx],
                            })
                            onpress.update({
                                embeds:[embed,tagbed],
                                components:[buttonRow]
                            });

                            return;
                        }
                    })

                    collector.on('end', ()=>{
                        left.setDisabled(true);
                        right.setDisabled(true);
                    })







                break;
            
        }

        }catch(err){
            console.log("(─‿‿─) I ran into a slash command error: "+err);
        }
        }
        











        /*
        // https://t.nhentai.net/galleries/14634/thumb.jpg
        // https://nhentai.net/g/4501/

        
        nana.g("https://nhentai.net/g/4501").then((g) => {
        console.log(typeof(g.images.pages));
        console.log(typeof(g.images.pages[0].t));

        });
        */

        /*
        interaction.editReply(
            {content:"Result test", 
            files: g.images.pages});*/

    }

