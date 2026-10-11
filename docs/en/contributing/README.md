---
title: "Contributing"
sidebar:
  label: "Overview"
  groupLabel: "Contributing"
  order: 4
aiGenerated: true
---

Guides for changing TomoriBot's code. Set up with [`getting-started.md`](./getting-started), read
the conventions and gates in [`development-tasks.md`](./development-tasks), then open the guide for
your task.

### Extending the bot (`extending/`)

| Task | Guide |
|---|---|
| Add a slash command | [`slash-command.md`](./extending/slash-command) |
| Add a panel, or a button to one | [`panel.md`](./extending/panel) |
| Add an event handler | [`event-handler.md`](./extending/event-handler) |
| Add a built-in tool | [`builtin-tool.md`](./extending/builtin-tool) |
| Add a feature-flagged tool | [`feature-flag-tool.md`](./extending/feature-flag-tool) |
| Add a DB column or table | [`db-column.md`](./extending/db-column) |
| Add a Full Install setup module | [`setup-module.md`](./extending/setup-module) |
| Add an AI provider | [`new-provider.md`](./extending/new-provider) |
| Add a persona preset | [`persona-preset.md`](./extending/persona-preset) |
| Add a participant field | [`participant-extension.md`](./extending/participant-extension) |
| Add an environment variable | [`env-variable.md`](./extending/env-variable) |

### Localization and docs (`localization/`)

| Task | Guide |
|---|---|
| Add a locale | [`new-locale.md`](./localization/new-locale) |
| Publish translated docs or READMEs | [`docs-site.md`](./localization/docs-site) |
| Add or move docs pages | [`docs-authoring.md`](./localization/docs-authoring) |

### Testing (`testing/`)

| Task | Guide |
|---|---|
| Test database code | [`db-changes.md`](./testing/db-changes) |
| Test chat pipeline code | [`chat-changes.md`](./testing/chat-changes) |
| Mock a module in tests | [`module-mocks.md`](./testing/module-mocks) |
| Keep tests small, fast, and honest | [`maintainable-tests.md`](./testing/maintainable-tests) |

### Policies (`policies/`)

- [`comments.md`](./policies/comments): what a comment may say, dashes, and the comment and prose audits
- [`command-archetypes.md`](./policies/command-archetypes): which kind of command or panel to build, with reference commands
- [`panel-prose-and-layout.md`](./policies/panel-prose-and-layout): text and components inside a panel
- [`raw-sql.md`](./policies/raw-sql): raw SQL stays in the repository layer
- [`dependency-security.md`](./policies/dependency-security): overrides, patches, and audit exceptions
