# Test helpers

Shared fixtures and assertion helpers. Reach for these before writing a local `makePersona`,
`makeInteraction`, or row literal: a local copy drifts from the production shape, and nothing notices.

| Helper | Use it for |
|---|---|
| `fixtures.ts` | `createPersona` (a complete `TomoriState`), `createUserRow`, `createLlmRow`, `createServerConfig`, `createCustomExpression` (a validated registry row) |
| `routeInteraction.ts` | `createRouteInteraction`: a button, select, or modal interaction for one route dispatch, recording acknowledgements, edits, and replies |
| `fakeInteraction.ts` | `makeFakeInteraction`: a slash-command interaction for acknowledgement-timing tests |
| `localeCases.ts` | `localizedCopy` and `localizedProse` for copy assertions; `RUNTIME_LOCALES` and `expectForEveryLocale` for locale sweeps |
| `panelLimits.ts` | `expectSafePanelPayload` and `collectTextDisplays` for Components V2 budget tests |
| `configMcpPage.ts` | the real `/config` > Plugins > MCP Servers payload, the only surface that renders MCP components |
| `transferPanelFixture.ts` | `findTransferAction`: locate one routed transfer action in a panel payload |
| `mockSurface.ts` | `createScopedModuleMocker`, `overrideMembers`, `stubLogMembers` for the few suites that must mock a module |
| `env.ts` | `useEnvSandbox`: restores named `process.env` variables after each test and after the enclosing scope; `useFullEnvSandbox` restores the whole environment |

## Rules the helpers depend on

- **Overrides replace, except `config`.** `createPersona({ config: { ... } })` merges onto the declared column
  defaults; every other key replaces the default outright.
- **Keep a derived default when you migrate a local helper.** If the old helper computed a field (a nickname from
  the id, `is_alter` from the id, a non-default `server_id`), wrap the factory and compute it there. The factory's
  fixed default otherwise changes what the suite asserts while it stays green.
- **Unknown option keys throw.** A spread-built options object escapes TypeScript's excess-property check, so the
  runtime check is what catches a misplaced `user:` or `guildId:`. Keep that check when adding an option.
- **A fixture is a value production can produce.** It type-checks against the real row or union, and a limits
  test builds the payload the user actually receives.
- **Assert copy by key**, never by quoting English. `localizedCopy` throws on an unknown key; `localizer()` echoes
  it, so a deleted key would pass. For a per-locale presence check use `hasLocaleKey`, because `localizer` falls
  back to en-US.
- **Prefer `spyOn(singleton, ...)` or constructor injection over `mock.module`.** Bun cannot unregister a module
  mock. When one is unavoidable, go through `createScopedModuleMocker` with an `@/` specifier: Bun resolves a
  relative specifier from `mockSurface.ts`, not from the test file, so it mocks nothing.
- **Change env only inside a `useEnvSandbox` scope.** A hand-written `process.env.X = original` stores the string
  `"undefined"` when `X` was unset. List every name the file writes: the isolation check accepts a dot-form write
  only when its name is a string literal in the call, and trusts the list for a computed `process.env[name]` or an
  `Object.assign(process.env, ...)`. Reach for `useFullEnvSandbox` only when the code under test writes names you
  cannot list, as `loadSecrets()` does.

Add a factory here once a third suite needs the same row shape (memory, document, and chunk rows are the next
candidates), and give it a contract test under `tests/unit/helpers/`.
