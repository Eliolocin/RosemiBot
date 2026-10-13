import { z } from "zod";

export const MAX_CUSTOM_EXPRESSIONS_PER_SERVER = z.coerce
  .number()
  .int()
  .positive()
  .catch(20)
  .parse(process.env.MAX_CUSTOM_EXPRESSIONS_PER_SERVER ?? 20);
