//import Midjourney from "mj-reforged";
//const {Midjourney} = require("../../node_modules/mj-reforged/script/src/Midjourney.js");
const { Midjourney } = require("midjourney");
const { ApplicationCommandOptionType } = require("discord.js");

module.exports = {
    name: 'waifu',
    description: 'Quickly generate a waifu image from a prompt using Midjourney!',
    // devOnly: Boolean,
    // testOnly: Boolean,
    // options: Object[],
    // deleted: Boolean,
    options:
    [
        {
            name: 'prompt',
            description: 'Please enter the prompt you want to be generated!',
            type: ApplicationCommandOptionType.String,
            required: true,
        },
        {
            name: 'aspect-ratio',
            description: 'Please choose an aspect ratio!',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices:[
                {
                    name:'wide',
                    value:"16:9",
                },
                {
                    name:'square',
                    value:"1:1",
                },
            ]
        },
    ],

    callback: async (client, interaction) =>{
        const Midj = new Midjourney({
            ServerId: process.env.JACKO_ID,
            ChannelId: process.env.GENERAL_ID,
            SalaiToken: process.env.MJ_TOKEN,
            Debug: true,
            Ws: true,
        });
    
    
    try{
        await interaction.deferReply();
        await Midj.Connect();
        const userquery = "anime girl " + interaction.options.getString('prompt') + ` --ar ${interaction.options.getString('aspect-ratio')} --upbeta --niji 5`;
        
        const result = await Midj.Imagine(userquery);

        console.log({result});

        /*
        var uploads = [];

        uploads.push(
            {
                attachment: result.attachments[0].url,
                name: "result.jpg"
            }
        )

        interaction.editReply(
            {content:"Here's what I generated for `"+userquery.trim()+"` (b ᵔ▽ᵔ)b", 
            files: uploads}); */

    }catch(err){
        console.log("(─‿‿─) I ran into a slash command error: "+err)
    }

    }}
