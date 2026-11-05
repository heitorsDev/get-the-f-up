# Module contracts

The interfaces between the three implementation tracks. Each track codes against
these signatures; nothing here is optional. If a track needs to change a contract,
it documents the change in its final report instead of silently diverging.

`SPEC.md` is the source of truth for behavior. This file only fixes the seams.

---

## Ownership

| Track | Owns (creates/edits only these) |
| --- | --- |
| **logic** | `Config.js`, `History.js`, `Steps.js`, `Challenge.js`, `Time.js`, `Palette.js`, `package.json`, `tests/config.test.js`, `tests/history.test.js`, `tests/steps.test.js`, `tests/challenge.test.js`, `tests/time.test.js`, `tests/palette.test.js`, `.github/workflows/test.yml` |
| **service** | `Service.qml`, `Display.js`, `Audio.js`, `Camera.js`, `Lockdown.js`, `bin/get-the-f-up-watchdog`, `bin/get-the-f-up-restore`, `assets/alarm.oga`, `tests/display.test.js`, `tests/audio.test.js`, `tests/camera.test.js`, `tests/lockdown.test.js` |
| **ui** | `Overlay.qml`, `BarWidget.qml`, `Panel.qml`, `Dialog.qml`, `Settings.qml`, everything under `ui/` (shared QML components: sleep screen, challenge view, step editor, buttons, inputs …) |
| **lead** | `manifest.json`, `README.md`, `docs/*`, `preview.png`, `LICENSE` |

Never edit a file owned by another track. Never edit `manifest.json`.

---

## JS module conventions

- Plain ES5-compatible JS (QML's JS engine), `.pragma library` on line 1.
- No QML imports, no file or process I/O inside JS modules. They are pure: data in,
  data out. I/O lives in `Service.qml` (`Quickshell.Io.FileView`, `Process`).
- Every module ends with a Node export shim so `node --test` can load it:

  ```js
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { defaults: defaults, merge: merge /* … */ }
  }
  ```

- QML imports them as `import "Config.js" as Config` (files sit at the plugin root).
- Randomness is injected: every generator takes an `rng` function returning a float in
  `[0, 1)` (default `Math.random`), so tests are deterministic.
- All values that cross into QML are plain JSON (no functions, no class instances,
  no `Date` objects — timestamps are epoch **milliseconds** as numbers).

---

## `Config.js`

```
defaults()                       -> config object exactly as SPEC.md §16
merge(partial)                   -> deep-merge partial over defaults(); arrays and
                                    `challenge.presets` entries replace, never merge
parse(text)                      -> { config, error }  // bad/empty JSON -> defaults + error string
serialize(config)                -> pretty JSON string (2-space indent, trailing newline)
configPath(home)                 -> home + "/.config/omarchy/get-the-f-up/config.json"
alarmsPath(home)                 -> home + "/.config/omarchy/get-the-f-up/alarms.json"
stateDir(home)                   -> home + "/.local/state/omarchy/get-the-f-up"
historyPath(home)                -> stateDir(home) + "/history.json"
activePath(home)                 -> stateDir(home) + "/active.json"   // watchdog restore record
presetNames(config)              -> array of preset names
```

`challenge.defaultPreset` is `"standard"`. The CLI payload's `"challenge":"default"`
means "use `challenge.defaultPreset`".

## `Time.js`

```
parseWhen(payload, nowMs)        -> { ringAt, error }
                                    payload.time "07:30" | "7:30" | "19:05" -> next future occurrence
                                    payload.duration "45m" | "1h30m" | "90" (minutes) | "2h" | "30s"
formatClock(ms, opts)            -> "07:14:22"; opts { h24: bool, seconds: bool }; 12h adds " AM"/" PM"
formatDate(ms)                   -> "Thu 29 Oct"
formatCountdown(remainingMs)     -> "6h 15m" | "15m" | "42s"   (overlay)
formatCompact(remainingMs)       -> "6h18m" | "15m" | "42s"    (bar widget)
formatElapsed(elapsedMs)         -> "+3m 12s"                   (ring state)
formatDuration(ms)               -> "6h 12m"                    (history / toast)
```

## `Steps.js`

A step **spec** is the config object (`{ "type": "math", "operators": "+-x", … }`).
A step **instance** is a generated, plain-JSON problem.

```
TYPES                            -> ["math", "string", "memory", "camera"]
generate(spec, rng)              -> instance
check(instance, input)           -> bool   (input is the user's string; trims; math accepts "12", "12.0")
describe(spec)                   -> short human text, e.g. "math · + − × · up to 20 · easy"
sample(spec, rng)                -> instance for the settings "preview this step" button
```

Instance shapes:

```
math    { type, prompt: "7 × 8 + 3", expected: "59" }
string  { type, prompt: "k3Qz9pLm", expected: "k3Qz9pLm" }
memory  { type, sequence: [3,1,4,1], prompt: "3 1 4 1", expected: "3141", flashMs: 3000 }
camera  { type, threshold: 60 }          // checked by Challenge.submitCamera, not check()
```

Math rules: operators from the spec string (`+`, `-`, `x` or `×`, `/` or `÷`); results
are integers unless `decimals` is set; subtraction never goes negative on `easy`;
division always divides evenly. Tiers `easy` (2 operands) / `medium` (3) / `hard`
(4, wider range).

## `Challenge.js`

The engine state is a plain object; every function returns a **new** state.

```
resolvePreset(config, name, rng) -> { name, steps: [spec…], shuffled: bool }
                                    shuffle:true -> draws len(steps) specs from config.challenge.pool by weight
                                    (camera dropped from the draw when config.camera.enabled is false)
create(resolved, reps, rng)      -> state
view(state)                      -> { type, instance, rep, reps, stepIndex, stepCount,
                                      completedSteps, totalSteps, errors, done, presetName }
submit(state, input, rng)        -> { state, correct }      // non-camera steps
submitCamera(state, reading, cameraConfig, rng)
                                 -> { state, correct, skipped, reason }
                                    reading: { luma: number|null, variance: number|null, error: string|null }
                                    error or luma == null           -> skipped (camera unusable)
                                    luma < nearBlackCutoff && variance ~ 0 -> skipped (blocked lens)
                                    luma >= lightThreshold         -> correct
                                    otherwise wrong; after autoSkipAfterFailures consecutive wrongs -> skipped (demoted)
removeCameraSteps(resolved)      -> resolved without camera steps (arm-time "remove camera step")
```

State fields (readable): `rep` (0-based), `reps`, `stepIndex`, `steps` (specs),
`current` (instance), `errors`, `completedSteps`, `cameraFailures`,
`cameraDemotions`, `done`, `presetName`.

Semantics: AND over steps; N=`reps` whole passes; a wrong answer keeps progress and
re-generates the current instance for `math`; `errors` is informational only. A
skipped camera step counts as passed. When a rep completes and more reps remain, a
shuffled preset re-draws its steps for the next rep.

## `History.js`

```
parse(text)                      -> array (bad/empty -> [])
serialize(list)                  -> JSON string
makeRecord(session, exitAt)      -> { kind, title, armedAt, ringAt, exitAt, preset, challengesRequired,
                                      challengesCompleted, errors, cameraDemotions, exitedBeforeRing }
                                    // kind "sleep" | "alarm" (a day alarm)
append(list, record, max)        -> new list, oldest dropped past max (default 500)
recent(list, n)                  -> last n, newest first
totals(list)                     -> { sessions, sleptMs, earlyExits, alarms }  // sessions: sleep only
summary(record)                  -> "Slept 6h 12m — 3 challenges, 1 error"
                                    "standup: dismissed after 2m — 1 challenge, 0 errors"
isAlarm(record)                  -> bool
```

## `Alarms.js`

Day alarms (SPEC.md §17). All times are epoch ms, local wall-clock.

```
parse(text)                      -> { alarms, error }   // bare array or { version, alarms }
serialize(alarms)                -> JSON string
validate(fields)                 -> "" | reason
create(fields, nowMs, makeId?)   -> alarm | null       // anchored at nowMs
update(alarms, id, fields, nowMs)-> new list           // re-anchors, clears handledAt
setEnabled(alarms, id, on, nowMs)-> new list
remove(alarms, id) / find(alarms, id) / add(alarms, alarm)
pending(alarm)                   -> next occurrence after anchorAt and handledAt, 0 if off
check(alarms, nowMs, windowMs)   -> { ring: { id, occurrence } | null, missed: [{ id, occurrence }] }
markHandled(alarms, id, occ)     -> new list; a one-off is switched off
upcoming(alarms, nowMs)          -> { alarm, at } | null
describeDays(days)               -> "once" | "weekdays" | "Mon Wed Fri" …
displayTitle(alarm)              -> title, or "ALARM"
normalizeTitle(text)             -> trimmed, at most TITLE_MAX (40) characters
```

`session` is the service's `session` object (below).

## `Palette.js`

```
TOKENS                           -> ["background","foreground","dim","accent","border","error","success"]
claudePreset()                   -> the SPEC.md §3 hex map
fromTheme(theme)                 -> token map from an Omarchy theme object
                                    (keys the shell's qs.Commons color singleton exposes; missing -> claude preset)
resolve(uiConfig, theme)         -> token map; uiConfig.palette "claude" -> uiConfig.claudePalette over the preset,
                                    "theme" -> fromTheme(theme); background is always "#000000" unless
                                    uiConfig.claudePalette.background overrides it under "claude"
```

## `Display.js`, `Audio.js`, `Camera.js`, `Lockdown.js`

Pure command builders and output parsers only; `Service.qml` runs them via `Process`.
Shapes are the service track's call, but keep them testable with `node --test`
(e.g. `Display.parseBrightness("intel_backlight,backlight,12363,51%,24242") ->
{ device, raw: 12363, percent: 51, max: 24242 }`, `Camera.parseYavg(stderrText)`).

---

## `Service.qml` (the live object)

Reached from the bar widget and the overlay with
`shell.serviceFor("io.github.heitorsdev.get-the-f-up")` (the injected `shell` facade;
see `/usr/share/omarchy/shell/services/PluginShellApi.qml`). It may be `null`
briefly at startup — UI must tolerate that and rebind.

### Properties (read-only to the UI)

```
string  state            "idle" | "armed" | "ringing"
bool    previewing       preview mode is showing (no side effects, state stays "idle")
bool    dryRun           the active session is a dry run
real    now              epoch ms, ticks every 1000 ms (UI binds clocks to this)
var     config           merged config (Config.merge result); replaced wholesale on change
var     palette          Palette.resolve(config.ui, theme) token map
var     session          null when idle, else
                         { kind, title, armedAt, ringAt, ringingSince, preset, reps, dryRun }
                         kind "sleep" | "alarm" (+ alarmId); title "" = WAKE UP
string  previewTitle     the ringing preview's headline
var     alarms           the day alarms (Alarms.parse result)
var     nextAlarm        Alarms.upcoming(alarms, now): { alarm, at } | null
var     challenge        Challenge.view(engineState) or null
string  cameraPrecheck   "unknown" | "checking" | "ok" | "blocked" | "unavailable"
string  cameraStatus     "idle" | "capturing"   (during a camera step)
var     lastResult       { correct, skipped, reason, at } of the most recent submission, or null
var     historyList      History.parse result
string  lastError        human message of the last rejected call, "" otherwise
```

### Methods (callable from QML)

```
arm(payload)             -> { ok, error }   payload { time | duration, challenge, reps, title?, removeCamera? }
startPreview(variant, title) -> { ok }      shows the overlay in preview, no side effects
stopPreview()            -> { ok }
startDryRun(payload)     -> { ok, error }   real dim/overlay/sound, ring after 10 s, no history
submit(input)            -> { ok, correct, finished }
captureCamera()          -> { ok }          async; result lands in `challenge` + `lastResult`
precheckCamera()         -> { ok }          async; result lands in `cameraPrecheck`
emergencyExit(confirmation) -> { ok, error } only when config.safety.emergencyExit
saveConfig(config)       -> { ok, error }   writes config.json, updates `config`
reloadConfig()           -> { ok }
openOverlay()            -> { ok }          summon the overlay (shell.summon(pluginId, "{}"))
addAlarm(fields)         -> { ok, alarm, error }   fields { title, time, days, enabled, preset, reps }
updateAlarm(id, fields)  -> { ok, alarm, error }
setAlarmEnabled(id, on)  -> { ok, error }
removeAlarm(id)          -> { ok, error }
testAlarm(id)            -> { ok, error }   ring it now as a dry run (no history)
```

Signals: `ringing()`, `finished(record)` — the UI may use them for animation only.

### IPC

`IpcHandler { target: "get-the-f-up" }` with the SPEC.md §2 methods, each taking and
returning JSON strings that wrap the methods above (`status`, `arm`, `disarm`,
`open`, `history`, `preview`, `dryrun`, and for day alarms `alarms`, `addalarm`,
`updatealarm`, `removealarm`, `testalarm`). `disarm` succeeds only if the challenge is
done.

---

## `Overlay.qml` (the overlay entry point)

Implements the host overlay contract: `property bool opened`, `open(payloadJson)`,
`close()`. The service summons it on arm/preview/dry run and closes it on exit. The
overlay must never close itself while `service.state !== "idle"` — closing with the
mode active is refused (re-open) so the screen cannot be escaped.

Payload keys the service passes to `open()`: `{ "mode": "sleep" | "preview" }`.

## Panels

The manifest declares `service`, `bar-widget`, `overlay` only (declaring `panel`
would turn the whole plugin into a panel). The arming dialog and settings are
therefore popouts owned by `BarWidget.qml` (the pattern
`~/.config/omarchy/plugins/io.github.jcarcinogen.rice-bar/BarWidget.qml` uses with
`RicePanel.qml`), with `Panel.qml` as the popout container hosting `Dialog.qml`
(arm), `AlarmList.qml` (day alarms) and `Settings.qml`.
