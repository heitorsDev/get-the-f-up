# Get The F Up — Specification

An Omarchy plugin that turns the machine into an alarm clock instead of a computer.
Arm it with a time and a challenge; the screen goes black with a clock, the display
dims, and at the ring time an alarm sounds that only stops when you complete the
challenge. You can also leave early by completing it.

- **Plugin id:** `io.github.heitorsdev.get-the-f-up`
- **Repo:** `heitorsDev/get-the-f-up`
- **License:** MIT
- **Target:** Omarchy 4.0.4 (Quattro / Quickshell) on Hyprland
- **Status:** Spec approved by the author. Not yet implemented.

---

## 1. What it does

1. You click the bar widget (or run the CLI) and arm the mode with:
   - **when** it rings — a wall-clock time (`07:30`) *or* a duration (`45m`)
   - **a challenge** — an ordered list of steps you must solve to exit
   - **N** — how many complete challenges are required to exit
2. The screen is covered by a fullscreen overlay on every monitor: black background,
   a large ticking clock, the ring time beneath it, and a live countdown.
3. The display dims (hyprsunset gamma) and the sound is prepared.
4. At the ring time an alarm loops until the challenge is solved.
5. You solve the challenge — before or after the ring — and the mode ends.
   **N** full challenges are required. A challenge is a *complete* pass of all its steps.
6. Everything is restored: brightness, audio volume/mute, idle behavior.

### Non-goals for v1

- No auto-arming on a nightly schedule. Get The F Up is turned on deliberately.
- No free "abandon" escape hatch. The only exits are **N** completed challenges or the
  crash watchdog.
- No Waybar UI. Waybar is not installed on Omarchy 4 (see `docs/environment.md`), but
  the headless CLI means any external bar can drive the plugin.
- No face detection, no ML. Presence is inferred from motion and light level only.

---

## 2. Architecture

Three plugin kinds in one package, per the Omarchy 4 plugin contract
(`/usr/share/omarchy/shell/README.md`):

| Kind | Entry point | Role |
| --- | --- | --- |
| `service` | `Service.qml` | Owns state, the timer, display/audio control, the challenge engine, the CLI IPC target. Headless. `keepLoaded: true`. |
| `bar-widget` | `BarWidget.qml` | The bar toggle + countdown. Reads service state via IPC. |
| `overlay` | `Overlay.qml` | The fullscreen sleep screen. One `PanelWindow` per output. |

Plus `Panel.qml` for the settings/arming surfaces (summoned as a `panel`), and plain
JS modules for logic that must be unit-testable outside QML.

```
manifest.json
Service.qml          # state machine, timer, display, audio, challenge engine, IPC
BarWidget.qml        # bar icon + countdown
Overlay.qml          # fullscreen sleep screen (per monitor)
Panel.qml            # arming panel + settings panel
Dialog.qml           # arming form (time, challenge, N)
Settings.qml         # full settings (challenges, display, audio, lockdown, palette)
Challenge.js         # step types, generation, evaluation (pure)
Steps.js             # math / string / memory / camera step generators (pure)
Palette.js           # Claude Code palette + theme integration
Config.js            # read/write ~/.config/omarchy/get-the-f-up/config.json
History.js           # read/write ~/.local/state/omarchy/get-the-f-up/history.json
Display.js           # hyprsunset / brightness control
Audio.js             # mpv loop, sink + volume control
Camera.js            # ffmpeg single-frame luminance
```

### IPC surface

The service registers a Quickshell `IpcHandler`:

```qml
IpcHandler {
  target: "get-the-f-up"
  function status(): string { /* JSON: state, ringAt, remaining, progress */ }
  function arm(payloadJson: string): string { /* {"time":"07:30"} | {"duration":"45m"}, "challenge":"default", "reps":3 */ }
  function disarm(): string { /* rejected unless the challenge is solved */ }
  function open(payloadJson: string): string { /* open the challenge overlay */ }
  function history(): string { /* JSON array */ }
  function preview(): string { /* preview screen, no side effects */ }
  function dryrun(): string { /* full fidelity, accelerated timer */ }
}
```

Third-party plugins **cannot** summon `omarchy.osd` — the shell's scope gate
(`pluginOwnsTarget` / `barPluginMayControl` / `pluginCloneMaySummon` in `shell.qml`)
allows a third-party plugin to control only its own id, unless it declares the `bar`
kind. So the exit-summary toast goes through `omarchy-notification-send` invoked via
`Quickshell.Io.Process`, not through the OSD plugin.

### State machine

```
idle ──arm()──> armed ──timer fires──> ringing ──challenge passed (xN)──> idle
                 │                        │
                 └────challenge passed────┘   (voluntary early exit, same exit path)
```

`armed` and `ringing` are the only states with a visible overlay. Every transition
into `idle` runs the same **restore sequence** (see §6), which is idempotent.

---

## 3. The sleep screen

### Layout (per monitor)

Centered stack, Claude Code TUI aesthetic:

```
                      07:14:22            <- large, ticking, foreground color
                   rings at 07:30        <- medium, dim
                   in 6h 15m             <- small, dimmer
```

- Big clock ticks every second.
- The ring time is absolute; the countdown beneath it ticks live.
- Both are configurable in the settings panel: 24h/12h, show/hide seconds,
  show/hide the relative countdown, show/hide the date.

### Style

Claude Code's warm-dark palette, but every color is **configurable** and defaults to
the live Omarchy theme so the plugin looks native in any theme. A "Claude Code"
preset is shipped as a selectable option.

| Token | Claude Code preset | Notes |
| --- | --- | --- |
| background | `#000000` | pure black per the request |
| foreground | `#f0eee6` | warm off-white |
| dim | `#8f8f88` | secondary text |
| accent | `#d97757` | Claude orange |
| border | `#3a3a37` | |
| error | `#cc6666` | used for the ring state and failures |
| success | `#6a9bcc` | used for a solved step |

- Font: **JetBrainsMono Nerd Font** (already the system monospace; `fc-match monospace`
  resolves to it).
- **Borders are QML-drawn rounded rectangles** (radius from `Style.cornerRadius`,
  1px border), never unicode box-drawing characters. The two monitors run different
  scale factors (eDP-1 at 1.2, HDMI-A-2 at 1.0) and unicode box glyphs break apart
  across that gap; QML shapes scale cleanly.
- All sizing goes through `Style.space()` / `Style.font.*` so it tracks the user's
  font-scale settings.

### Ring state

At the ring time the overlay changes to the error color and the large clock is
replaced by the alarm's **title**, drawn in the palette's error color. The title is
set per alarm (the arming form's optional `title` field, a day alarm's title) and
defaults to **WAKE UP** (**ALARM** for a day alarm). It is shown as typed, at most
40 characters, and a title wider than the screen is scaled down to fit. The relative countdown
line is replaced by elapsed-since-alarm. The clock itself keeps ticking — a clock is
useful at 6am.

A slow border pulse (2s cycle) is available as a toggle, **default off**.

---

## 4. Challenges

### Composition

A **challenge** is an ordered list of **steps**. All steps must pass (AND semantics).
A step is one of:

| Type | What it does | Parameters |
| --- | --- | --- |
| `math` | Solve an arithmetic expression, type the answer | operators (`+ - ×`, optionally `÷`), operand range, decimals, difficulty tier |
| `string` | Retype a displayed random string | charset (alphanumeric / symbols), length |
| `memory` | Repeat a flashed sequence | sequence length |
| `camera` | Prove the room light is on | luminance threshold |

Challenges are stored as **presets** — named, hand-authored step lists — and each
preset carries a `shuffle` flag. When `shuffle` is on, the steps are drawn at random
from the configured pool instead of using the fixed list. Both modes coexist.

**N counts whole challenges.** To exit you must complete N challenges, each one a
full pass of all its steps. A preset of "camera + 3 math" completed with N=2 means
eight steps total.

Default presets:

- `standard` — 3 × math
- `thorough` — camera + 3 × math
- `quick` — 1 × string

### Retries and failure

- **Unlimited retries.** A wrong answer never ends the challenge.
- **A wrong answer never discards completed steps.** Progress within a challenge is
  kept; only the failed step is retried.
- A failed attempt shows an inline "not quite" flash on the step and increments an
  error counter displayed in the corner. The counter has **no effect** on the
  challenge — it is informational only. No escalating difficulty, no lockout, no
  penalty. This is a sleep tool; punishing a half-awake arithmetic slip gets it
  uninstalled.
- A failed math step re-randomizes its problem on retry.

### The camera step

**Purpose:** force the user to physically get up and turn the room light on.

**Mechanism:** one frame from `/dev/video0` via ffmpeg, reduced to a single mean
luminance number.

```bash
ffmpeg -hide_banner -f v4l2 -input_format mjpeg -video_size 640x480 \
  -i /dev/video0 -frames:v 1 \
  -vf "signalstats,metadata=print:key=lavfi.signalstats.YAVG" \
  -f null - 2>&1 | grep -oE 'YAVG=[0-9.]+' | cut -d= -f2
```

- YAVG is BT.601 limited-range Y: **16 = black, 235 = white**.
- The pass condition is **`luma >= threshold`**, with the threshold configurable in
  the UI. The light must be **ON**. There is no baseline comparison and no motion
  analysis — the user explicitly chose the simple threshold rule.
- **No image is ever written to disk.** Only the luminance number is kept, in memory.

**Blocked-lens fallback (the brick case).** A closed ThinkShutter yields a permanently
black frame: the camera opens fine, the threshold is never met, and a required camera
step can never be satisfied. Two defenses:

1. **Near-black ⇒ camera unusable ⇒ the step is skipped** (counts as passed). This
   matches the standing decision that an unusable camera must never brick the screen.
   Near-black is detected as luma below a low cutoff (below ~24) *and* no measurable
   variance across the frame.
2. **Arm-time pre-check.** When arming, one test frame is taken. If it reads
   near-black, the arming panel warns *"camera appears blocked — the camera step will
   be skipped"* and offers a one-click removal of the camera step. This is the only
   mechanism that distinguishes a blocked lens from a genuinely dark room, and it
   costs nothing when the lens is open.

Additionally, a config toggle **"auto-skip camera after N consecutive failures"**
(default 3) demotes a camera step that starts failing mid-session, so a camera that
degrades (lens covered mid-night, device grabbed by another app) cannot strand the
user either.

**Constraints discovered in the environment:**

- There is **no XDG Camera portal** on this machine (`xdg-desktop-portal-camera` is not
  installed and is not in Arch's repos; `xdg-desktop-portal-hyprland` implements only
  ScreenCast/Screenshot/GlobalShortcuts/InputCapture). Direct V4L2 is the only path.
  PipeWire does publish the camera as `v4l2:/dev/video0` with `media.role = "Camera"`.
- Access to `/dev/video0` is granted by an ACL to the active logind seat user
  (`70-uaccess.rules`), not by group membership. The `video` group exists but
  `heitor` is not in it. Handle `EACCES` gracefully.
- The ThinkPad T490's ThinkShutter state **cannot be detected from software** — no
  camera LED, no ACPI attribute, no fwupd entry. Only the near-black heuristic works.
- No camera activity indicator exists on this machine.

### The light gate (optional, parallel to the challenges)

The camera is not a step in a preset. With `camera.requireLight` on (default
off) it runs **alongside** the challenges as a gate:

- The challenges are **locked** until the room light has been on for a moment
  (3 steady samples, about a second), and **lock again** after about two
  seconds below the threshold. Progress already made is kept.
- The camera is open only while the challenge is on screen, never while just
  the clock is up. A live view and a bar showing the light against the
  threshold are shown; the threshold is the one global `camera.lightThreshold`.
- Enforced in the service (`submit` refuses while locked), not only the UI.
- Released for the rest of the session if the camera cannot be used: a lens
  that stays black and flat for about five seconds, or a stream that dies.
  A broken camera must never strand anyone.

Camera steps in custom presets still run as before, but the camera is no
longer offered as a step type and is not in the default presets or pool.

---

## 5. Display

**Method: hyprsunset gamma only.** The laptop's backlight is left at 100%; gamma is
applied to the color transform, which reaches both monitors.

Why gamma and not backlight: HDMI-A-2 has no DDC/CI (`ddcutil detect` → "This monitor
does not support DDC/CI"), so `brightnessctl` cannot dim it. Only `intel_backlight`
(eDP-1) is dimmable. hyprsunset applies its CTM to every output, so gamma is the only
software dim that covers both.

> **Known consequence, accepted:** with gamma-only dimming the laptop panel's
> backlight stays lit, so the panel glows faintly grey in a dark room rather than
> going truly black. A configurable laptop backlight floor is a one-line config
> change if this becomes annoying later.

**Control:**

```bash
# start (hyprsunset is NOT running by default on this machine)
setsid uwsm-app -- hyprsunset &

# set dim level, e.g. 50%
hyprctl hyprsunset gamma 50

# restore
hyprctl hyprsunset identity
```

**Restore sequence** (runs on every exit path):

1. Restore the exact previous `intel_backlight` value (read at arm time via
   `brightnessctl -d intel_backlight -m`).
2. `hyprctl hyprsunset identity` — the correct restore state, because this machine's
   `~/.config/hypr/hyprsunset.conf` is `identity = true` all day.
3. If the plugin started hyprsunset, stop it. If it was already running (nightlight
   toggle active), leave it running.

**Gotchas, from the installed source and live probing:**

- Only **one** hyprsunset may run — a second instance exits with "A CTM manager is
  already running on the current compositor."
- `hyprctl hyprsunset` fails with exit 3 if hyprsunset is not running; the plugin must
  ensure the process is up before setting values.
- A freshly started hyprsunset applies its profile at boot and can clobber a value set
  before it finished starting. Omarchy's own nightlight toggle works around this by
  re-sending the temperature up to 10 times at 0.2s intervals; the plugin does the
  same for gamma.
- `temperature` forces `identity = false`; `gamma` does not. Restoring with `identity`
  after a gamma-only change is therefore correct.

---

## 6. Audio

**Alarm:** an audio file, looped until the challenge is solved.

```bash
mpv --loop=inf --no-video --really-quiet --audio-device=<sink> /path/to/alarm.oga
```

`mpv --loop=inf` is the loop mechanism. Neither `pw-play` nor `paplay` has a `--loop`
flag (`pw-play --properties node.loop=true` was verified not to loop), so a shell
`while` loop is the fallback.

**Sink:** configurable. Default is the built-in ALSA sink
(`alsa_output.pci-0000_00_1f.3.analog-stereo`), because the machine's *default* sink
is a Bluetooth headset (`bluez_output.88_92_CC_B9_18_5C.1` — a JBL Tune 770NC) that
may be powered off at 6am. If the configured sink is unavailable at ring time, fall
back to the current default sink.

**Volume:** the alarm **forces the sink to a configured volume** (default 80%) and
clears mute. This is the point of the feature: the alarm must be audible.

**Restore:** the previous volume and mute state of the affected sink are captured
before the change and restored on exit.

**Sound asset:** the plugin ships a short alarm sound of its own and also accepts a
user-supplied path. `/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga`
exists on this machine as a free fallback, but the plugin should not depend on
freedesktop sounds being installed.

---

## 7. Lockdown

While the mode is active, each of these is **independently toggleable** in the
settings panel, defaulting as shown:

| Behavior | Default | Mechanism |
| --- | --- | --- |
| Cover all monitors | on | one `PanelWindow` per output via `Variants { model: Quickshell.screens }` |
| Exclusive keyboard focus | on | `WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive` |
| Suppress notifications | on | shell's notification service, muted for the session |
| Pause other media | on | MPRIS via `Quickshell.Services.Mpris` |
| Hide the bar | on | `bar.barHidden` |
| Block window/workspace switching | on | follows from exclusive focus |

**The overlay structure** (per the shell's own `background`/`notifications` patterns):

```qml
Variants {
  model: Quickshell.screens
  delegate: Component {
    PanelWindow {
      required property var modelData
      screen: modelData
      visible: root.opened
      color: "transparent"
      exclusionMode: ExclusionMode.Ignore
      WlrLayershell.namespace: "omarchy-get-the-f-up"
      WlrLayershell.layer: WlrLayer.Overlay
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
      anchors { top: true; bottom: true; left: true; right: true }
    }
  }
}
```

The same challenge content renders on **every** monitor; only the focused monitor's
surface holds the keyboard. Rendering identical content everywhere removes the
"wrong monitor" confusion.

**Idle suppression.** Omarchy's idle service fires the screensaver at 150s and the
lock at 300s. Both are suppressed while the mode is active:

- Touch `~/.local/state/omarchy/indicators/stay-awake` — the exact state file the
  shell's idle service probes and watches (`plugins/services/idle/Service.qml`). This
  is the same mechanism as `omarchy-toggle-idle stay-awake`, and it is the
  supported path rather than patching the shell's config.
- Also hold a `systemd-inhibit --what=idle` inhibitor for the session's duration.

**Max duration:** none by default. An auto-exit undermines the purpose. An optional
cap (e.g. 8h) is available as an **off-by-default** config option.

---

## 8. The bar widget

`BarWidget.qml` extends `qs.Ui.BarWidget`. The host injects `bar`, `moduleName`, and
`settings` (the `shell.json` entry minus `id`).

| State | Display | Left click | Right click |
| --- | --- | --- | --- |
| idle | icon only, no label | open the arming panel | Settings · Preview · Dry run |
| armed | icon + compact countdown (`6h18m`) | open the challenge overlay | same menu |
| ringing | icon in the error color, pulsing | open the challenge overlay | same menu |

- Tooltip in `armed`/`ringing` shows the ring time, the countdown, and the challenge
  name.
- The armed countdown is the one glanceable answer to "when do I need to be up?"
  while the overlay covers the screen.
- `broadcast(method)` fans state changes out to every monitor's instance.

The bar widget does **not** own the state. It renders what the service reports and
forwards clicks to it. Because `shell.shellConfig` is `undefined` for third-party
plugins (the `PluginShellApi` facade does not expose it), the widget reads the
plugin's own config file rather than `shell.json`.

---

## 9. Settings and configuration

### Storage

`~/.config/omarchy/get-the-f-up/config.json` — the plugin's own file, outside the
plugin directory.

**Why not the `shell.json` inline entry** (the Omarchy idiom): the read path is
broken for third-party plugins. `shell.shellConfig` is only the real `ShellRoot` for
first-party plugins; a third-party plugin gets a `PluginShellApi` facade with no
`shellConfig` property. `wmfeht.border-fx` and `io.github.jcarcinogen.rice-bar` both
read `shell.shellConfig` and therefore silently run on defaults today. The plugin
reads and writes its own file so that the panel, the bar widget, and the service all
agree on one source of truth.

**Why not `barWidget.schema`:** Omarchy 4 ships no renderer for it. `shell.qml`
copies the manifest's `barWidget` block into widget metadata and nothing ever reads
`metadata.schema`. The schema block is inert. The plugin therefore ships its own
settings panel.

Runtime state lives in `~/.local/state/omarchy/get-the-f-up/history.json` (matching the
shell's own `~/.local/state/omarchy/` convention).

### Settings surface

The plugin ships its own panels. Omarchy 4 has no native plugin settings form.

- **Arming dialog** — when (wall-clock *or* duration), challenge preset, N, a live
  preview of the sleep screen, and the arm button. Shows the challenge's *pool and
  difficulty*, not the literal problems, for shuffled presets.
- **Settings panel** — a preset list beside a step builder (add step → pick type →
  set parameters → reorder), plus display, audio, lockdown, and palette sections.
  Each step row gets a **"preview this step"** button that runs a single sample of
  that step (math renders an example, string renders the target) without touching
  the camera or the real challenge.
- The panels use the same Claude Code styling as the sleep screen.

---

## 10. Test modes

Two distinct modes, both behind an explicit confirm, since a dry run dims the screen
and plays audio at real volume.

| Mode | Behavior |
| --- | --- |
| **Preview** | Renders the sleep screen with a fake countdown. No dimming, no audio, no lock, no input capture. Zero side effects. For tuning typography, colors, and layout. |
| **Dry run** | Full fidelity: real dimming, real overlay, real sound at real volume, timer accelerated (e.g. 10s), and the alarm and challenge states are playable. Does not modify history. |

---

## 11. Safety

- **No override by default.** The only exits are N completed challenges or the crash
  watchdog. A config toggle enables a hidden emergency exit (hold `Esc` for 3s, then
  type a confirmation); it is **default OFF**.
- **The watchdog.** If the Quickshell process dies mid-sleep, the overlay disappears
  but the display would stay dimmed and the alarm would keep playing. A
  `systemd-run --user` transient unit holds the restore state: it restores brightness
  and gamma, kills the audio process, and clears the `stay-awake` file. It must be
  armed at mode start and disarmed at every normal exit.
- **Idempotent restore.** The restore sequence is safe to run twice, since the crash
  path and the normal path can race.

---

## 12. History

`~/.local/state/omarchy/get-the-f-up/history.json` — local only, never networked.

Each session records: arm time, ring time, exit time, challenges required, challenges
completed, error count, camera demotions, and whether the exit happened before or
after the ring.

The settings panel shows the last 10 sessions plus totals (total time slept, times
exited *before* the alarm). The number of early exits is the honest measure of
whether the tool is working.

On exit, a brief toast summary via `omarchy-notification-send`
(e.g. *"Slept 6h 12m — 3 challenges, 1 error"*).

---

## 13. CLI

The headless surface, for external bars, scripting, and testing.

```
omarchy-shell get-the-f-up status
omarchy-shell get-the-f-up arm   '{"time":"07:30","challenge":"default","reps":3}'
omarchy-shell get-the-f-up arm   '{"duration":"45m","challenge":"thorough","reps":2}'
omarchy-shell get-the-f-up open  '{}'            # open the challenge overlay
omarchy-shell get-the-f-up disarm                # rejected unless the challenge is solved
omarchy-shell get-the-f-up history
omarchy-shell get-the-f-up preview
omarchy-shell get-the-f-up dryrun

# day alarms (§17)
omarchy-shell get-the-f-up alarms
omarchy-shell get-the-f-up addalarm    '{"time":"14:00","title":"standup","days":[1,2,3,4,5],"preset":"quick","reps":1}'
omarchy-shell get-the-f-up updatealarm '{"id":"<id>","enabled":false}'
omarchy-shell get-the-f-up removealarm <id>
omarchy-shell get-the-f-up testalarm   <id>   # ring it now, no history entry
```

`arm` also takes an optional `"title"`: the headline of the ring screen.

---

## 14. Packaging

- `manifest.json` with `schemaVersion: 1`, kinds `["service", "bar-widget", "overlay"]`,
  `keepLoaded: true`, entry points `Service.qml` / `BarWidget.qml` / `Overlay.qml`.
- No symlinks anywhere in the plugin directory — `omarchy-plugin-validate` rejects them.
- `install.sh` is **not** a convention in Omarchy 4; `omarchy plugin add` only clones
  and validates. Any side effects must happen from `Service.qml` or a documented
  manual script.
- Install: `omarchy plugin add https://github.com/heitorsDev/get-the-f-up.git --enable`
- Publish to `omarchyplugins.com` (category *Productivity*; tags `bar`, `quickshell`,
  `power-management`). Marketplace ids are permanent — the id is fixed now.
- A root `preview.png` is required for marketplace submission.

---

## 15. Open items

1. **ThinkShutter test (blocking for the camera step).** Open the lens and run:

   ```bash
   ffmpeg -hide_banner -f v4l2 -input_format mjpeg -video_size 640x480 \
     -i /dev/video0 -frames:v 1 \
     -vf "signalstats,metadata=print:key=lavfi.signalstats.YAVG" \
     -f null - 2>&1 | grep -oE 'YAVG=[0-9.]+' | cut -d= -f2
   ```

   If it prints ~16 the lens is blocked and the near-black auto-skip is load-bearing.
   If it prints a sane value, the camera step works as specified.
2. **Runtime keybind.** This machine's Hyprland uses the Lua config provider, so
   `hyprctl keyword` cannot add binds. Investigate whether `hyprctl eval` with the
   Lua config API can register a bind at runtime; if yes, add an arm/disarm hotkey.
   If not, document a paste-in snippet for `~/.config/hypr/bindings.lua` and do not
   have the plugin write into the user's hypr config unasked. **v1 ships without a
   hotkey.**
3. **Exact Claude Code colors.** The palette above is a hand-written approximation.
   Verify against a real Claude Code session and adjust the preset.

---

## 16. Configuration reference

`~/.config/omarchy/get-the-f-up/config.json`. Every key has a sane default; a partial
file is valid and missing keys fall back to defaults.

```jsonc
{
  "version": 1,

  // ---- display ----------------------------------------------------------
  "display": {
    "dimMethod": "gamma",          // "gamma" (only supported v1)
    "gammaPercent": 50,            // hyprsunset gamma while active
    "laptopBacklightPercent": 100, // backlight left at 100% under gamma-only dimming
    "restoreBrightness": true
  },

  // ---- audio ------------------------------------------------------------
  "audio": {
    "soundPath": null,              // null = bundled alarm
    "sink": "alsa_output.pci-0000_00_1f.3.analog-stereo", // null = current default
    "volumePercent": 80,           // forced volume at ring time
    "unmute": true,
    "restoreVolume": true
  },

  // ---- camera -----------------------------------------------------------
  "camera": {
    "enabled": true,
    "device": "/dev/video0",
    "lightThreshold": 60,          // mean luma (16=black, 235=white) that counts as "on"
    "nearBlackCutoff": 24,         // below this the camera is treated as unusable
    "autoSkipAfterFailures": 3,    // 0 = never auto-skip on failure
    "warnOnArm": true,             // arm-time blocked-lens pre-check
    "requireLight": false          // the light gate: challenges locked unless the light is on
  },

  // ---- challenges -------------------------------------------------------
  "challenge": {
    "defaultPreset": "standard",
    "reps": 1,                     // N: complete challenges required to exit
    "presets": {
      "standard": {
        "shuffle": false,
        "steps": [
          { "type": "math", "operators": "+-", "maxOperand": 20, "tier": "easy" }
        ]
      },
      "thorough": {
        "shuffle": false,
        "steps": [
          { "type": "camera" },
          { "type": "math", "operators": "+-x", "maxOperand": 20, "tier": "easy" },
          { "type": "math", "operators": "+-x", "maxOperand": 20, "tier": "easy" },
          { "type": "math", "operators": "+-x", "maxOperand": 20, "tier": "easy" }
        ]
      },
      "quick": {
        "shuffle": false,
        "steps": [ { "type": "string", "charset": "alnum", "length": 8 } ]
      }
    },
    "pool": {                       // used when a preset has "shuffle": true
      "math":   { "weight": 3, "operators": "+-x", "maxOperand": 20 },
      "string": { "weight": 2, "charset": "alnum", "length": 8 },
      "memory": { "weight": 1, "length": 4 },
      "camera": { "weight": 1 }
    }
  },

  // ---- lockdown ---------------------------------------------------------
  "lockdown": {
    "coverAllMonitors": true,
    "exclusiveKeyboard": true,
    "suppressNotifications": true,
    "pauseMedia": true,
    "hideBar": true,
    "blockWindowSwitching": true,
    "suppressIdle": true,           // stay-awake state file + systemd-inhibit
    "maxDurationMinutes": 0         // 0 = no cap
  },

  // ---- ui ---------------------------------------------------------------
  "ui": {
    "palette": "theme",             // "theme" (live Omarchy) or "claude"
    "claudePalette": {
      "background": "#000000",
      "foreground": "#f0eee6",
      "dim": "#8f8f88",
      "accent": "#d97757",
      "border": "#3a3a37",
      "error": "#cc6666",
      "success": "#6a9bcc"
    },
    "fontFamily": "JetBrainsMono Nerd Font",
    "clock24h": true,
    "showSeconds": true,
    "showRingTime": true,
    "showCountdown": true,
    "showDate": false,
    "pulseOnRing": false
  },

  // ---- safety -----------------------------------------------------------
  "safety": {
    "emergencyExit": false,         // default OFF
    "watchdog": true
  }
}
```

---

## 17. Day alarms

Alarms for the rest of the day, not for waking up: a meeting, a break, a reminder.
They are managed from the popout's **alarms** tab (or the CLI) and live in
`~/.config/omarchy/get-the-f-up/alarms.json`, apart from `config.json` so a settings
save never races the service marking an alarm as rung. The pure logic is
`Alarms.js`.

```jsonc
{ "version": 1, "alarms": [ {
  "id": "a…", "title": "standup", "time": "14:00",
  "days": [1, 2, 3, 4, 5],     // 0 = Sunday; [] = once
  "enabled": true,
  "preset": "",                // "" = challenge.defaultPreset
  "reps": 1,
  "anchorAt": 0,               // created or last edited (ms)
  "handledAt": 0               // the last occurrence that rang or was missed (ms)
} ] }
```

**Scheduling.** An alarm waits for its first occurrence after both `anchorAt` and
`handledAt`, so editing an alarm never fires a time already past, and no occurrence
is handled twice. A one-off alarm switches itself off once handled and stays in the
list to be switched on again. Times are local wall-clock times (DST keeps 14:00 at
14:00).

**Ringing.** The service checks the alarms every tick while idle. A due alarm goes
straight to `ringing` with `session.kind = "alarm"`: the fullscreen overlay with the
alarm's title, the alarm sound at the configured volume, and the alarm's challenge.
Nothing is dimmed and no lockdown toggle is applied, though the overlay still
follows `lockdown.coverAllMonitors` and `lockdown.exclusiveKeyboard`, and idle/sleep
is inhibited while it rings. The light gate (§4) never applies to a day alarm. The
restore record and the watchdog work as for a sleep session, so a crash silences
the alarm. The history entry has `"kind": "alarm"` and the title, and is left out
of the time-asleep totals.

**Missed alarms.** An occurrence that passed while the machine was suspended or the
shell was not running still rings if it is at most an hour late. An older one is
reported with a "Missed alarm" notification and skipped. A repeating alarm that
missed several occurrences is handled once, for the latest.

**Sleep sessions.** A day alarm that comes due during a sleep session waits until
the session ends, and is reported missed if that is more than an hour later.

---

## 18. Verification checklist

Before the plugin is considered done:

- [ ] `omarchy plugin validate .` passes
- [ ] `omarchy-shell shell rescanPlugins` picks it up; `omarchy plugin list` shows it enabled
- [ ] Arming from the bar widget dims both monitors
- [ ] The overlay covers both monitors at their different scale factors without artifacts
- [ ] Exit before the ring works; exit after the ring works
- [ ] N is honored (N=2 on a 4-step challenge requires 8 steps)
- [ ] A wrong answer keeps completed steps and does not escalate
- [ ] The camera step passes with the light on and skips when the lens is blocked
- [ ] The alarm forces the configured volume on the configured sink and restores it after
- [ ] Killing the Quickshell process triggers the watchdog and restores the display
- [ ] Idle screensaver does not fire during the mode
- [ ] Preview has no side effects; dry run dims and plays audio as expected
- [ ] The exit toast appears and the history file gains an entry
- [ ] A day alarm rings at its time without dimming, shows its title, and stops only
      when its challenge is solved
- [ ] A day alarm missed by under an hour (suspend) rings on wake; an older one
      shows a missed notification
