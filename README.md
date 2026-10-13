# composer-meter

A Claude Code mod that puts the session cost and the prompt-cache expiry in the composer footer:

```
$1.23 · TTL ends 11:19 AM
```

- **Cost** is `$.session.usage().cost`, refreshed after each prompt, tool call and model response (`session.measure`).
- **Cache expiry** is the start of the last main-thread request (`turn.step`, no `agentId`) plus the TTL. It turns `warning` at 4 minutes left and `error` at 2, then becomes `cold ~$X.XX` in `error`: the estimated cost of re-writing the cache, i.e. the last request's input + cache read + cache write + output tokens × input price × write multiplier (1.25× for 5m, 2× for 1h).
- Subagent requests use their own caches and don't reset the timer.

## Options

`cacheTtl` (`userConfig`): `auto` (default), `5m` or `1h`. The engine doesn't expose the session's cache TTL, so `auto` assumes 1h when the API reports rate-limit windows (a subscription) and 5m otherwise. Stored in `~/.claude/settings.json` under `pluginConfigs["composer-meter"].options`.

## Prices

`INPUT_PRICES` in `hooks/register.tsx` holds list input prices per model as of 2026-10. The Models API (`GET /v1/models`) carries no pricing and needs credentials, so the table is maintained by hand. Fast mode and organisation-configured pricing aren't modelled.

## Where it draws, and what each surface allows

The mod hooks `ui.render` on `SessionMode`, the mode-label slot in the composer footer.

**Desktop app.** The slot sits between the permission mode and the model name. The app runs the returned tree through a text-only flattener (`shapeTree` in the Code tab's bundle):

- kept: `Text`, `span`, `b` (a `Text`'s props only when every value is a primitive), and `Button`s with `key`, `label` and a press handler
- collapsed: `Box` and `div` become inline runs joined with spaces
- dropped: `Svg` and every other element, which reduce to their `label`/`text`/`source` string or nothing; this applies with or without `isInteractive`
- drawn with CSS `white-space: nowrap; text-overflow: ellipsis` and a fixed width, so long text is cut off with an ellipsis
- colors must be a theme key (`warning`, `error`, …), `#hex`, or `rgb()`/`hsl()`; anything else becomes `currentColor`, so CSS gradients can't sneak in

The desktop renders `Svg` only in `AbovePrompt` and `Pane`.

**Terminal (TUI).** Not built yet. `SessionMode` is raised on the terminal too (the dim labels at the right of the prompt footer), and `PromptHint` takes a `tail` string the terminal appends to its hint line. Check `.claude-plugin/types/claude-code/index.d.ts` for what each terminal site accepts.

## Development

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

```bash
claude --plugin-dir ~/src/composer-meter
```

`tsc -p .` type-checks once the engine has loaded the mod and written `.claude-plugin/types/` (git-ignored).
