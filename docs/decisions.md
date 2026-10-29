# Decision log

Every decision, who made it, and why. Defaults applied where the author chose to
"go with defaults" are marked.

## Session shape

Three rounds of interviews (12 + 9 + 5 questions), then a final consolidation. The
author answered most questions tersely; several rounds ended with "go with defaults
for the ones I didn't respond."

---

## Rendering & architecture

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| A1 | Rendering technology | **QML layer-shell overlay** with `WlrKeyboardFocus.Exclusive` | A terminal cannot grab the keyboard — Hyprland binds stay live, so "blocks my PC" would be porous. Layer-shell gives real exclusive focus and renders identically across the two monitors (eDP-1 at scale 1.2, HDMI-A-2 at scale 1.0). |
| A2 | Lock strength | Layer-shell now; `WlSessionLock` (ext-session-lock-v1) noted as possible later hardening | The compositor-enforced lock is stronger but may blank custom UI during transitions. |
| A3 | Bar control surface | **Both** a headless CLI and a QML bar widget | Waybar no longer exists on Omarchy 4. The CLI is the real interface; the widget is one front end. Makes the plugin publishable to non-Quattro setups. |
| A4 | Plugin shape | `service` + `bar-widget` + `overlay` kinds | The service owns state; the overlay is the sleep screen; the widget is the toggle. |
| A5 | Settings surface | Plugin's own panel | Omarchy 4 ships **no** renderer for `barWidget.schema` — it is inert metadata. Confirmed in `shell.qml:1400`. |
| A6 | Config storage | Plugin-owned `~/.config/omarchy/sleep-mode/config.json` | `shell.shellConfig` is `undefined` for third-party plugins (the `PluginShellApi` facade lacks it), so the `shell.json` inline read path is broken — `border-fx` and `rice-bar` are silently running on defaults today. |

## Challenges

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| C1 | Challenge types | **All** of them, combinable: math, type-a-string, memory sequence, camera light-state | A single fixed type is guessable half-asleep; a pool forces attention. |
| C2 | Composition | Ordered step lists (AND semantics), hand-written presets **and** a shuffle-from-pool mode per preset | Presets let you script a routine; shuffle defeats pre-solving. Both, layered. |
| C3 | What N counts | **N counts whole challenges** | A challenge is a complete pass of all its steps. "camera + 3 math" with N=2 is eight steps. |
| C4 | Exit timing | Allowed **before or after** the timer expires | One exit path for both. |
| C5 | Retries | **Unlimited** | A sleep tool that punishes a half-awake arithmetic slip gets uninstalled by Thursday. |
| C6 | Failure effect | A wrong answer **never discards completed steps**; error counter is informational only; no escalation | Progress is preserved; only the failed step retries. A failed math step re-randomizes. |
| C7 | Camera assertion | **Brightness threshold** — the light must be ON, luma ≥ a configurable threshold | Author's explicit instruction: "I just want to force the user to have the light turned on. Don't overcomplicate it." No baseline comparison, no motion analysis. |
| C8 | Blocked-lens case | Near-black ⇒ camera unusable ⇒ **step is skipped**; plus an arm-time pre-check that warns and offers removal | A closed ThinkShutter produces a permanently black frame. Without this the screen bricks. |
| C9 | Camera degradation | Config toggle: auto-skip the camera step after N consecutive failures (default 3) | A camera that fails mid-session must not strand the user. |

## Display

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| D1 | Dim method | **hyprsunset gamma only** | HDMI-A-2 has no DDC/CI, so `brightnessctl` cannot reach it. Gamma applies a CTM to every output — the only software dim covering both monitors. |
| D2 | Backlight floor | **None** (laptop backlight stays at 100%) | Author's choice. Accepted consequence: the panel glows faintly grey in a dark room rather than going truly black. One config line to change later. |
| D3 | Restore | Exact previous `intel_backlight` value + `hyprctl hyprsunset identity` + stop hyprsunset if the plugin started it | This machine's `hyprsunset.conf` is `identity = true` all day, so identity is exactly the right restore state. hyprsunset is not running by default. |
| D4 | Idle suppression | `stay-awake` state file + `systemd-inhibit --what=idle` | The state file is the same mechanism as `omarchy-toggle-idle stay-awake` and is watched by the shell's idle service. |

## Audio

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| S1 | Sink | Configurable; default = built-in ALSA sink, fallback to the current default | The machine's default sink is a Bluetooth headset that may be off at 6am. |
| S2 | Volume | **Forced** to a configurable level (default 80%), mute cleared | The stated requirement: force the volume up. |
| S3 | Restore | Previous volume/mute restored on exit | Leave the machine as you found it. |
| S4 | Loop | `mpv --loop=inf`; `while` shell loop as fallback | Verified: `pw-play` and `paplay` have no `--loop`, and `node.loop=true` does not loop. |
| S5 | Sound asset | Bundled alarm + user-supplied path | The plugin must not depend on freedesktop sounds being installed. |

## UI

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| U1 | Style reference | Claude Code TUI | Stated in the original brief. |
| U2 | Borders | **QML rounded rectangles**, never unicode box-drawing characters | Mixed DPI (1.2 vs 1.0) breaks unicode box glyphs apart. |
| U3 | Palette | **Configurable**; defaults to the live Omarchy theme, with a Claude Code preset available | Author: "the palette is configurable." Looks native in any theme and still matches the reference. |
| U4 | Sleep screen content | Big ticking clock / `rings at 07:30` / `in 6h 15m` — all configurable | Big clock ticks; ring time absolute; live relative countdown beneath. |
| U5 | Ring state | Accent flips to error color, large text becomes **WAKE UP** in the palette's error color | Author picked "B, but the text in the palette" — the error color comes from the palette, not hardcoded. |
| U6 | Ring pulse | Off by default | Available as a toggle; strobing is nauseating at 6am. |
| U7 | Bar widget states | idle = icon only; armed = icon + countdown; ringing = error-colored pulsing icon | The armed countdown is the only glanceable answer to "when do I need to be up?" while the overlay covers the screen. |
| U8 | Multi-monitor challenge | Same content on every monitor, keyboard focus on the focused one | Removes "wrong monitor" confusion. |

## Lockdown & safety

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| L1 | Lockdown scope | **All of it, each independently toggleable** | Author's answer. "Block everything" is right at 6am and wrong at 11pm. |
| L2 | Emergency exit | **None by default**; a config toggle exists, default OFF | The only exits are N completed challenges or the crash watchdog. A free override defeats the purpose. |
| L3 | Abandon option | **Not offered** in the menus | Would be a free override, undermining L2. |
| L4 | Crash watchdog | `systemd-run --user` transient unit restores display state and kills audio if the shell dies | A crash is the real lockout risk, not stubbornness. Restore is idempotent so the crash and normal paths can race safely. |
| L5 | Max duration | None by default; optional off-by-default cap | An auto-exit undermines the purpose. |

## Timer

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| T1 | Input format | **Both** wall-clock (`07:30`) and duration (`45m`) | A sleep alarm is naturally one or the other. |
| T2 | Nightly auto-arm | **Out of scope for v1** | Sleep mode is turned on deliberately. |

## Test modes

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| M1 | Modes | **Preview** (no side effects) and **Dry run** (real dim, real overlay, accelerated timer, real sound) | The alarm state is the screen you most need to see and can never see while asleep. Preview alone under-serves. |
| M2 | Guards | Both behind an explicit confirm | A dry run dims the screen and blasts audio. |

## Packaging

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| P1 | Identity | `io.github.heitorsdev.sleep-mode` · repo `heitorsDev/omarchy-sleep-mode` · display name "Sleep Mode" · author "Heitor Santos" | Marketplace ids are permanent — chosen now, before publication. |
| P2 | License | MIT | — |
| P3 | Marketplace | Publish to omarchyplugins.com (Productivity; tags `bar`, `quickshell`, `power-management`) | Needs root `preview.png`, root README, license file, unique id. |

---

## Defaults applied (author declined to answer)

| Question | Default applied |
| --- | --- |
| Multi-monitor challenge surface | Same content on all monitors, focus on the focused one |
| Idle screensaver + lock during the mode | Suppressed |
| Max-duration cap | None, but available off-by-default |
| History and post-exit summary | Local `history.json` + a toast summary |
| Global hotkey | None in v1; investigate `hyprctl eval` runtime binds during implementation |
| Challenge builder UI | Preset list beside a step builder, plus per-step preview |
