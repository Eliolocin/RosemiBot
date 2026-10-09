// locales/zh-CN/commands.ts
// Assembler: edit the individual files in commands/ instead.
//
// Only the command slices translated so far are imported here. Add each remaining
// `./commands/<name>` import and its spread alongside its translation: an import of a file
// that does not exist yet fails TypeScript resolution for the whole project, and the other
// locale slices already cover `commands/` in the meantime.

import transfer from "./commands/transfer";
import memories from "./commands/memories";
import providers from "./commands/providers";
import moderation from "./commands/moderation";
import learn from "./commands/learn";
import tool from "./commands/tool";
import status from "./commands/status";
import persona from "./commands/persona";
import help from "./commands/help";
import novelai from "./commands/novelai";
import config from "./commands/config";
import server from "./commands/server";
import personal from "./commands/personal";
import generate from "./commands/generate";
import stats from "./commands/stats";
import setup from "./commands/setup";
import compact from "./commands/compact";
import context from "./commands/context";
import choices from "./commands/choices";
import stPreset from "./commands/st-preset";
import stPresets from "./commands/st-presets";
import data from "./commands/data";
import legal from "./commands/legal";
import impersonate from "./commands/impersonate";
import conditioning from "./commands/conditioning";
import reward from "./commands/reward";
import punish from "./commands/punish";
import support from "./commands/support";
import troubleshoot from "./commands/troubleshoot";
import contribute from "./commands/contribute";
import donate from "./commands/donate";
import nsfw from "./commands/nsfw";
import optionalKey from "./commands/optional-key";
import scheduledTask from "./commands/scheduled-task";
import memory from "./commands/memory";
import teach from "./commands/teach";
import forget from "./commands/forget";
import model from "./commands/model";
import mcps from "./commands/mcps";
import capabilities from "./commands/capabilities";
import provider from "./commands/provider";
import update from "./commands/update";
import ping from "./commands/ping";
import comment from "./commands/comment";
import kill from "./commands/kill";
import refresh from "./commands/refresh";
import expressions from "./commands/expressions";
import matrix from "./commands/matrix";
import respond from "./commands/respond";
import shared from "./commands/shared";
import nuke from "./commands/nuke";
import quota from "./commands/quota";
import reset from "./commands/reset";
import exportCommands from "./commands/export";
import importCommands from "./commands/import";

export default {
  commands: {
    ...transfer,
    ...memories,
    ...providers,
    ...moderation,
    ...learn,
    ...tool,
    ...status,
    ...persona,
    ...help,
    ...novelai,
    ...config,
    ...server,
    ...personal,
    ...generate,
    ...stats,
    ...setup,
    ...compact,
    ...context,
    ...choices,
    ...stPreset,
    ...stPresets,
    ...data,
    ...legal,
    ...impersonate,
    ...conditioning,
    ...reward,
    ...punish,
    ...support,
    ...troubleshoot,
    ...contribute,
    ...donate,
    ...nsfw,
    ...optionalKey,
    ...scheduledTask,
    ...memory,
    ...teach,
    ...forget,
    ...model,
    ...mcps,
    ...capabilities,
    ...provider,
    ...update,
    ...ping,
    ...comment,
    ...kill,
    ...refresh,
    ...expressions,
    ...matrix,
    ...respond,
    ...shared,
    ...nuke,
    ...quota,
    ...reset,
    ...exportCommands,
    ...importCommands,
  },
};
