# composer-meter

A Claude Code mod that puts the session cost and the prompt-cache expiry in the composer footer:

```
$1.23 · TTL ends 11:19 AM
```

- **Cost** is `$.session.usage().cost`, refreshed after each prompt, tool call and model response (`session.measure`).
- **Cache expiry** is the start of the last main-thread request (`turn.step`, no `agentId`) plus the TTL. It turns `warning` at 4 minutes left and `error` at 2, then becomes `cold ~$X.XX` in `error`: the estimated cost of re-writing the cache, i.e. the last request's input + cache read + cache write + output tokens × input price × write multiplier (1.25× for 5m, 2× for 1h).
- Subagent requests use their own caches and don't reset the timer.
- On `/resume`, `--resume`/`--continue`, a fork, or any reset of the mod's state (the desktop app letting an idle conversation's process go), the timer starts from the conversation's last main-thread request: the time its prompt or tool result was written to the transcript. The mod reads the transcript file for this, since `$.session.messages()` carries no timestamps, and finds it by session id under `$CLAUDE_CONFIG_DIR` (or `~/.claude`)`/projects/`. It reads the last 3 MiB with `tail -c` (`$.process.run`), whatever the file's size; on Windows (`OS=Windows_NT`), where there is no `tail`, Windows PowerShell seeks and copies the same bytes. Where no process runs (a managed plugin denies it), it uses `$.fs.read`, which takes files up to 4 MiB; past that, resume falls back to the engine's `seconds_since_last_response`, which is when the response finished, a little after the send.
- Nothing polls. The cache piece changes only at 4 minutes left, 2 left and expiry, so a timer is set for the next of those. A reset is caught from `session.end` (`clear` or `resume`: the mod watches for the new session id for up to 5 seconds) and from the footer's next drawing (a session id the view wasn't refreshed for). So the mod doesn't need the `classic.*` events, which a managed plugin above it (such as `cc-plugin-sec-default` on a Team or Enterprise plan) can stop reaching user plugins. Without `classic.SessionStart`, the fallback to `seconds_since_last_response` is lost. Without `CwdChanged`, the directory and branch refresh at the next turn or `Bash` call. Without `PostModelSwitch`, prices come from `INPUT_PRICES`, and the model refreshes on `config.set` or the next request.

## Install

```
/plugin install composer-meter --marketplace ioctlLR/composer-meter
```

On the terminal it draws differently (see below): a usage band above the prompt, and the directory and branch in the footer.

```
▰▰▰▱▱▱▱▱ 37% context   $1.23 session   Opus 5.5 · high   TTL ends 11:19 AM
                                                                        focus & …   ~/src/app ⎇ main
```

## Options

Set in `/config`, and stored in `~/.claude/settings.json` under `pluginConfigs["composer-meter@<source>"].options`: `composer-meter@inline` when loaded with `--plugin-dir`, `composer-meter@<marketplace>` when installed. A value saved there overrides the defaults below.

- `cacheTtl`: `auto` (default), `5m` or `1h`. The engine doesn't expose the session's cache TTL, so `auto` assumes 1h when the API reports rate-limit windows (a subscription) and 5m otherwise.
- `bandUsage` (terminal band): `cost` (default) shows the session's cost beside the context meter; `limits` shows the 5h and 7d plan meters in its place.

## Prices

Claude Code's own price catalog is compiled into the binary (the `/model` picker's `$X/$Y per Mtok`) and reaches a mod only through `PostModelSwitch`'s `estimated_cache_write_usd`. After a switch the mod divides that back to the new model's base input price and prefers it (managed `modelPricing` included). Otherwise it falls back to `INPUT_PRICES` in `hooks/register.tsx`, list prices as of 2026-10, maintained by hand: the Models API (`GET /v1/models`) carries no pricing and needs credentials. The switch's `cache_ttl` is not used for the countdown. Fast mode and organisation-configured pricing aren't modelled.

## Where it draws, and what each surface allows

The mod hooks `ui.render` on `SessionMode`, the mode-label slot in the composer footer.

**Desktop app.** The slot sits between the permission mode and the model name. The app runs the returned tree through a text-only flattener (`shapeTree` in the Code tab's bundle):

- kept: `Text`, `span`, `b` (a `Text`'s props only when every value is a primitive), and `Button`s with `key`, `label` and a press handler
- collapsed: `Box` and `div` become inline runs joined with spaces
- dropped: `Svg` and every other element, which reduce to their `label`/`text`/`source` string or nothing; this applies with or without `isInteractive`
- drawn with CSS `white-space: nowrap; text-overflow: ellipsis` and a fixed width, so long text is cut off with an ellipsis
- colors must be a theme key (`warning`, `error`, …), `#hex`, or `rgb()`/`hsl()`; anything else becomes `currentColor`, so CSS gradients can't sneak in

The desktop renders `Svg` only in `AbovePrompt` and `Pane`.

**Terminal (TUI).** Ported from skins-plus, my fork of [hellosverre's skins](https://github.com/hellosverre/claude-skins): its band and footer, without the Compact button.

- `AbovePrompt`: one row of block meters (`▰▱`, eighths) for context fill (warning from 80%, error from 95%) and the session cost (or, under `bandUsage: limits`, a meter per plan limit in its place); then the main loop's model by name (`Opus 5.5`, derived from the id: the engine exposes only the id, and the `/config` model row only aliases) and effort, and the cache expiry piece above. Colors are skins-plus's Dracula (accent `#bd93f9`, text `#f8f8f2`, muted `#6272a4`), with a deepened variant on a light Claude Code theme. Another plugin's band, and a survey, keep their place. The desktop keeps the engine's band, since it shows its own context and model.
- `SessionMode`: the engine's mode labels, then `~/path ⎇ branch` (or `detached <hash>`), read from `.git/HEAD` (worktrees and submodules followed) with no git process. The branch shows whole; the path gives way from its left, down to its last directory, within half the terminal's width. Refreshed at each turn's start and end, after main-thread `Bash` calls and on `CwdChanged`.
- Effort is what `/config` holds until the next main-thread request reports what it really sent (`turn.step`'s `effort`), so a downgrade for the model shows.

If `skins-plus` is also enabled, both draw a band; turn its band off with `/skin band off`.

## Development

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

```bash
claude --plugin-dir .
```

`tsc -p .` type-checks once the engine has loaded the mod and written `.claude-plugin/types/` (git-ignored).
