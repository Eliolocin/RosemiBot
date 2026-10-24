import { expect } from "bun:test";
import type { RawDiscordComponent } from "@/types/discord/rawApiTypes";
import type { RawModalPayload } from "@/utils/discord/ui/configModals";
import {
  DISCORD_CHECKBOX_GROUP_OPTIONS_MAX,
  DISCORD_CHECKBOX_GROUP_OPTIONS_MIN,
  DISCORD_CUSTOM_ID_MAX,
  DISCORD_CUSTOM_ID_MIN,
  DISCORD_MODAL_COMPONENTS_MAX,
  DISCORD_MODAL_COMPONENTS_MIN,
  DISCORD_MODAL_FIELD_DESCRIPTION_MAX,
  DISCORD_MODAL_FIELD_LABEL_MAX,
  DISCORD_MODAL_TITLE_MAX,
  DISCORD_RADIO_GROUP_OPTIONS_MAX,
  DISCORD_RADIO_GROUP_OPTIONS_MIN,
  DISCORD_SELECT_OPTION_DESCRIPTION_MAX,
  DISCORD_SELECT_OPTION_LABEL_MAX,
  DISCORD_SELECT_OPTION_VALUE_MAX,
  DISCORD_SELECT_OPTIONS_MAX,
  DISCORD_SELECT_OPTIONS_MIN,
  getDiscordTextLength,
  validateRawModalLimits,
} from "@/utils/discord/ui/componentsV2Limits";

const STRING_SELECT = 3;
const LABEL = 18;
const RADIO_GROUP = 21;
const CHECKBOX_GROUP = 22;

export function eachComponent(
  components: readonly RawDiscordComponent[],
  visit: (c: RawDiscordComponent) => void,
): void {
  for (const component of components) {
    visit(component);
    if (component.component) eachComponent([component.component], visit);
    if (component.components) eachComponent(component.components, visit);
  }
}

export function assertWithinDiscordLimits(payload: RawModalPayload, label: string): void {
  expect(validateRawModalLimits(payload).violations, `${label}: validator violations`).toEqual([]);

  expect(getDiscordTextLength(payload.title), `${label}: title length`).toBeLessThanOrEqual(DISCORD_MODAL_TITLE_MAX);
  expect(payload.components.length, `${label}: component count`).toBeGreaterThanOrEqual(DISCORD_MODAL_COMPONENTS_MIN);
  expect(payload.components.length, `${label}: component count`).toBeLessThanOrEqual(DISCORD_MODAL_COMPONENTS_MAX);

  const customIds = new Set<string>();
  eachComponent(payload.components, (component) => {
    if (component.custom_id !== undefined) {
      const cidLen = getDiscordTextLength(component.custom_id);
      expect(cidLen, `${label}: custom_id min length`).toBeGreaterThanOrEqual(DISCORD_CUSTOM_ID_MIN);
      expect(cidLen, `${label}: custom_id max length`).toBeLessThanOrEqual(DISCORD_CUSTOM_ID_MAX);
      expect(customIds.has(component.custom_id), `${label}: duplicate custom_id ${component.custom_id}`).toBe(false);
      customIds.add(component.custom_id);
    }

    if (component.type === LABEL) {
      if (component.label !== undefined) {
        expect(getDiscordTextLength(component.label), `${label}: label length`).toBeLessThanOrEqual(
          DISCORD_MODAL_FIELD_LABEL_MAX,
        );
      }
      if (component.description !== undefined) {
        expect(getDiscordTextLength(component.description), `${label}: description length`).toBeLessThanOrEqual(
          DISCORD_MODAL_FIELD_DESCRIPTION_MAX,
        );
      }
    }

    if (component.type === STRING_SELECT) {
      const options = component.options ?? [];
      expect(options.length, `${label}: ${component.custom_id} option count`).toBeGreaterThanOrEqual(
        DISCORD_SELECT_OPTIONS_MIN,
      );
      expect(options.length, `${label}: ${component.custom_id} option count`).toBeLessThanOrEqual(
        DISCORD_SELECT_OPTIONS_MAX,
      );
      for (const option of options) {
        expect(getDiscordTextLength(option.label), `${label}: option label`).toBeLessThanOrEqual(
          DISCORD_SELECT_OPTION_LABEL_MAX,
        );
        expect(getDiscordTextLength(option.value), `${label}: option value`).toBeLessThanOrEqual(
          DISCORD_SELECT_OPTION_VALUE_MAX,
        );
        expect(getDiscordTextLength(option.description ?? ""), `${label}: option description`).toBeLessThanOrEqual(
          DISCORD_SELECT_OPTION_DESCRIPTION_MAX,
        );
      }
    }

    if (component.type === CHECKBOX_GROUP) {
      const options = component.options ?? [];
      expect(options.length, `${label}: ${component.custom_id} checkbox count`).toBeGreaterThanOrEqual(
        DISCORD_CHECKBOX_GROUP_OPTIONS_MIN,
      );
      expect(options.length, `${label}: ${component.custom_id} checkbox count`).toBeLessThanOrEqual(
        DISCORD_CHECKBOX_GROUP_OPTIONS_MAX,
      );
      for (const option of options) {
        expect(getDiscordTextLength(option.label), `${label}: checkbox label`).toBeLessThanOrEqual(
          DISCORD_SELECT_OPTION_LABEL_MAX,
        );
        expect(getDiscordTextLength(option.value), `${label}: checkbox value`).toBeLessThanOrEqual(
          DISCORD_SELECT_OPTION_VALUE_MAX,
        );
      }
    }

    if (component.type === RADIO_GROUP) {
      const options = component.options ?? [];
      expect(options.length, `${label}: ${component.custom_id} radio count`).toBeGreaterThanOrEqual(
        DISCORD_RADIO_GROUP_OPTIONS_MIN,
      );
      expect(options.length, `${label}: ${component.custom_id} radio count`).toBeLessThanOrEqual(
        DISCORD_RADIO_GROUP_OPTIONS_MAX,
      );
      for (const option of options) {
        expect(getDiscordTextLength(option.label), `${label}: radio label`).toBeLessThanOrEqual(
          DISCORD_SELECT_OPTION_LABEL_MAX,
        );
        expect(getDiscordTextLength(option.value), `${label}: radio value`).toBeLessThanOrEqual(
          DISCORD_SELECT_OPTION_VALUE_MAX,
        );
      }
    }
  });
}
