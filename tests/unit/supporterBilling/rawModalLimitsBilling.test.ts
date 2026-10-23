import { beforeAll, expect, it } from "bun:test";
import { buildConfigModelSelectModal } from "@/utils/discord/ui/configModelModals";
import { buildModelSelectModal } from "@/utils/discord/ui/personalConfigModals";
import { assertWithinDiscordLimits } from "../../helpers/rawModalLimits";
import { hasLocaleKey, initializeLocalizer } from "@/utils/text/localizer";
import { expectForEveryLocale, localizedCopy } from "../../helpers/localeCases";

beforeAll(async () => initializeLocalizer());

it("preserves model descriptions and subscription funding context across locales", () => {
  expectForEveryLocale((locale) => {
    const models = [
      { id: 12, name: "example/model", description: "m".repeat(90) },
      { id: 13, name: "example/no-description", description: null },
    ] as const;
    for (const payload of [
      buildConfigModelSelectModal(locale, "text", "supporter", "nonce", models, 12),
      buildModelSelectModal(
        locale,
        "nonce",
        "text",
        "supporter",
        models.map((model) => ({ ...model, description: model.description ?? undefined })),
        12,
      ),
    ]) {
      const field = payload.components[0];
      const option = field?.component?.options?.[0];
      expect(option?.description).toBe(models[0]?.description);
      expect(field?.component?.options?.[1]?.description).toBe(
        localizedCopy(
          hasLocaleKey(locale, "commands.providers.subscription_model_description") ? locale : "en-US",
          "commands.providers.subscription_model_description",
        ),
      );
      expect(field?.description).toContain(localizedCopy(locale, "commands.providers.subscription_label"));
      expect(option?.value).toBe("12");
      expect(option?.default).toBe(true);
      assertWithinDiscordLimits(payload, locale);
    }
  });
});
