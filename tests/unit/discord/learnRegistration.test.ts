import { beforeAll, describe, expect, it } from "bun:test";
import { ApplicationCommandOptionType } from "discord.js";
import { loadCommandData } from "@/utils/discord/commandLoader";
import { initializeLocalizer } from "@/utils/text/localizer";

type RegistrationPayload = {
  name: string;
  type?: number;
  description?: string;
  contexts?: number[];
  default_member_permissions?: string;
  autocomplete?: boolean;
  options?: RegistrationPayload[];
};

beforeAll(async () => {
  await initializeLocalizer();
}, 30000);

describe("/learn registration", () => {
  it("registers /learn as an unrestricted root with exactly one history subcommand", async () => {
    const { registrationData, executionMap } = await loadCommandData();

    const learnCommand = registrationData.find((cmd) => cmd.name === "learn") as unknown as RegistrationPayload;
    expect(learnCommand).toBeDefined();

    expect(learnCommand.contexts).toBeUndefined();
    expect(learnCommand.default_member_permissions).toBeUndefined();

    const learnOptions = learnCommand.options ?? [];
    expect(learnOptions.length).toBe(1);
    const historySubcommand = learnOptions[0];
    expect(historySubcommand.name).toBe("history");
    expect(historySubcommand.type).toBe(ApplicationCommandOptionType.Subcommand);

    // The six options are the command's whole input surface, so a relocation that dropped
    // one would still register and still pass every other check here.
    const options = historySubcommand.options ?? [];
    expect(options.length).toBe(6);
    const optionNames = options.map((opt: RegistrationPayload) => opt.name);
    expect(optionNames).toContain("name");
    expect(optionNames).toContain("learner");
    expect(optionNames).toContain("start_message_id");
    expect(optionNames).toContain("end_message_id");
    expect(optionNames).toContain("prompt");
    expect(optionNames).toContain("limit");
    expect(options.find((opt) => opt.name === "learner")?.autocomplete).toBe(true);

    expect(executionMap.get("learn")?.has("history")).toBe(true);
  }, 30000);

  // The former "/memory history is gone" check here is gone: /memory is listed in
  // configRegistration.test.ts's DISSOLVED_ROOTS, which asserts it is absent from both the execution
  // map and the registration data.
});
