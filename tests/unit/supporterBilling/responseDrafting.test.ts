import { afterEach, expect, it, spyOn } from "bun:test";
import * as configModelOperations from "@/utils/discord/interactions/configModelOperations";
import { loadStructuredOutputModelGroups } from "@/utils/discord/interactions/configModelOperations";
import { createPersona } from "../../helpers/fixtures";

const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

it("keeps subscription reviewer choices while requiring structured output", async () => {
  const providers = spyOn(configModelOperations, "loadConfigModelProviders").mockResolvedValue(["supporter"]);
  const models = [{ id: 76, name: "~deepseek/deepseek-v4-flash-latest", description: null }];
  const choices = spyOn(configModelOperations, "loadConfigModelChoices").mockResolvedValue(models);
  restores.push(
    () => providers.mockRestore(),
    () => choices.mockRestore(),
  );
  const groups = await loadStructuredOutputModelGroups(1, "en-US");
  expect(groups).toEqual([{ provider: "supporter", models }]);
  const filter = choices.mock.calls[0]?.[4];
  expect(filter?.({ ...createPersona().llm, supports_structoutput: true })).toBe(true);
  expect(filter?.({ ...createPersona().llm, supports_structoutput: false })).toBe(false);
});
