---
title: "Adding a Feature Flag-Controlled Tool"
sidebar:
  order: 10
---

How to let server admins turn a built-in tool on and off. Build the tool first with
[Adding a Built-In Tool](/contributing/extending/builtin-tool/).

1. Map the config field to a flag in `configToFeatureFlags` (`src/utils/tools/featureFlagMapper.ts`):

   ```ts
   my_config_field: [FeatureFlag.MY_TOOL],
   ```

2. Set the flag on the tool class:

   ```ts
   override requiresFeatureFlag = FeatureFlag.MY_TOOL;
   ```

3. Make sure a config command can change the field.

Run `bun run check` and `bun run lint`. With the setting off, the tool must be missing from the
model's tool list; with it on, the tool must appear and run.
