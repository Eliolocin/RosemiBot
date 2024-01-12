const { ApplicationCommandOptionType } = require("discord.js");
const Booru = require('booru');
const { Eiyuu } = require('eiyuu');
const resolve = new Eiyuu();
const postfiltering = "score:>=3";

module.exports = {
    name: 'rule34',
    description: 'Quickly get up to 4 random NSFW HQ post results of a query with multiple tags from rule34!',
    // devOnly: Boolean,
    // testOnly: Boolean,
    // options: Object[],
    // deleted: Boolean,
    options:
    [
        {
            name: 'tags',
            description: 'Please enter multiple tags, each separated with a / slash (tags do not have to be exact!)',
            type: ApplicationCommandOptionType.String,
            required: true,
        }
    ],

    callback: async (client, interaction) =>{
       try{
        await interaction.deferReply();

       if(!interaction.channel.nsfw) {
        interaction.editReply("Sorry, you can only use this command in NSFW channels!");
        return;
        }
    
       const userquery = interaction.options.getString('tags');
       const userinput = interaction.options.getString('tags').split("/");
       let queries = [];
        
       let finalquery = "";


       for(i=0; i<userinput.length; i++){

        queries.push(await resolve.rule34(userinput[i].trim().replace(/\s/g, "_")));
        finalquery+=" "+queries[i][0];

       }

       var tempquery = finalquery;
       finalquery+= " "+postfiltering;

       const r34 = Booru.forSite('rule34');
       var postcontainer = [];

       r34.search(finalquery, {limit: 4, random:true}).then(posts=>{

        for(i=0;i<4;i++){
            if(!posts[i]) break;
                postcontainer.push(`${posts[i].fileUrl}`);
        }

        var uploads = [];
        var postCount = postcontainer.length

        for(i=0;i<postCount;i++){

            uploads.push(
                {
                    attachment: postcontainer[i],
                    name: `result.${postcontainer[i].split(/[#?]/)[0].split('.').pop().trim()}`
                }
            )
        }
   

        if(postCount === 0){
            interaction.editReply("Sowwy, I didn't find any post for: `"+userquery.trim()+"`\nTry a different prompt or try `/booru` instead!");
        }
        else{
            interaction.editReply(
                {content:"You typed: `"+userquery.trim()+"`\nI searched for: `"+tempquery.trim()+"`", 
                files: uploads});
                interaction.editReply(`*Downloading posts then uploading them in random...*`);
        }

    }) 
       }catch(err){
        console.log("(─‿‿─) I ran into a slash command error: "+err);
       }
    }
}
