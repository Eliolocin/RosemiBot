const { ApplicationCommandOptionType } = require("discord.js");
const Booru = require('booru');
const { Eiyuu } = require('eiyuu');
const resolve = new Eiyuu();
const postfiltering = " score:>=3 -nude -rating:explicit -nipples -pubic_hair"; // Filtering out posts with these tags

module.exports = {
    name: 'booru',
    description: 'Quickly get up to 4 random "SFW" HQ post results of a query with multiple tags from gelbooru!',
    // devOnly: Boolean,
    // testOnly: Boolean,
    // options: Object[],
    // deleted: Boolean,
    options:
    [
        {
            name: 'tags',
            description: 'Please enter multiple tags, each separated with a space (tags do not have to be exact!)',
            type: ApplicationCommandOptionType.String,
            required: true,
        }
    ],

    callback: async (client, interaction) =>{
        try{
            await interaction.deferReply();

            const userquery = interaction.options.getString('tags');
            const userinput = interaction.options.getString('tags').split(" ");
            //console.log(userinput)
            let queries = [];
             
            let finalquery = "";
     
     
            for(i=0; i<userinput.length; i++){
     
             queries.push(await resolve.gelbooru(userinput[i].trim().replace(/\s/g, "_")));
             if(userinput[i] === 'armpits') finalquery+=" "+queries[i][1];
             else finalquery+=" "+queries[i][0];
             //console.log(queries)
     
            }
     
            var tempquery = finalquery;
            finalquery+= postfiltering;
     
            const gel = Booru.forSite('gelbooru');
     
            var postcontainer = [];
     
            gel.search(finalquery, {limit: 4, random:true}).then(posts=>{
     
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
                 interaction.editReply("*Sowwy, I didn't find any post for: `"+userquery.trim()+"`\nTry a different prompt or try `/rule34` instead!*");
             }
             else{
                 interaction.editReply(
                     {content:"*You typed: `"+userquery.trim()+"`*\n*I searched for: `"+tempquery.trim()+"`*", 
                     files: uploads});
                 interaction.editReply(`*Downloading posts then uploading them in random...*`);
             }
             
         })
        }catch(err){
            console.log("(─‿‿─) I ran into a slash command error: "+err);
        }

    }
}
