export const RESPONSE_REVIEW_ITEM_VALUES = ["persona", "examples", "history", "context", "tools"] as const;
export type ResponseReviewItem = (typeof RESPONSE_REVIEW_ITEM_VALUES)[number];

export const DEFAULT_RESPONSE_REVIEW_ITEMS: ResponseReviewItem[] = ["persona", "examples", "history"];

export const RESPONSE_REVIEW_ITEMS: ReadonlyArray<{ value: ResponseReviewItem; labelKey: string }> = [
  { value: "persona", labelKey: "commands.config.drafting.review_persona" },
  { value: "examples", labelKey: "commands.config.drafting.review_examples" },
  { value: "history", labelKey: "commands.config.drafting.review_history" },
  { value: "context", labelKey: "commands.config.drafting.review_context" },
  { value: "tools", labelKey: "commands.config.drafting.review_tools" },
];
