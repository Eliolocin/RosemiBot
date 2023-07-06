const CharacterAI = require('node_characterai');
const characterAI = new CharacterAI();
const api = process.env.CHRAI_API_KEY;
const persona = process.env.CHRAI_ROSEID;

module.exports = async (client) => {

    // Character AI Initialization
    try{
        await characterAI.authenticateWithToken(api);
        var Rosemi = {
            bot : await characterAI.createOrContinueChat(persona)
        }; 
        module.exports = { Rosemi };
    } catch(err){
        console.log("(─‿‿─) Character AI Cloudflare blocked, please restart me manually!"+err);
    }
}
