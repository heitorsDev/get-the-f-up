# Implementation plan

Ordered so that every phase is independently verifiable and nothing depends on
unfinished work.

---

## Phase 0 — Scaffolding

**Goal:** an installable plugin that validates and appears in `omarchy plugin list`.

- `manifest.json` — `schemaVersion: 1`, id `io.github.heitorsdev.sleep-mode`,
  kinds `["service", "bar-widget", "overlay"]`, `keepLoaded: true`, entry points
  `Service.qml` / `BarWidget.qml` / `Overlay.qml`.
- Stub `Service.qml` with an `IpcHandler { target: "sleep-mode" }` returning
  `status()` → `"{}"`.
- Stub `BarWidget.qml` extending `qs.Ui.BarWidget` with a `BarIconButton`.
- Stub `Overlay.qml` with the `Variants` + `PanelWindow` skeleton, black background,
  a visible clock.

**Verify:** `omarchy plugin validate .` passes; `omarchy-shell shell rescanPlugins`;
the plugin shows enabled in `omarchy plugin list`; the widget appears in the bar and
clicking it opens the overlay.

---

## Phase 1 — Config and state plumbing

**Goal:** the widget and the overlay agree on state, driven by the service.

- `Config.js` — read/write `~/.config/omarchy/sleep-mode/config.json`, with defaults
  merged in for missing keys, and a `version` field.
- `Service.qml` — the state machine (`idle` / `armed` / `ringing`), a `Timer` for the
  countdown, and the `IpcHandler` methods from the spec.
- `BarWidget.qml` — poll or subscribe to `status()`, render the icon, the armed
  countdown, and the ringing state. Use `broadcast(method)` to fan out to every
  monitor's instance.
- `Overlay.qml` — the clock, ring time, and countdown from the service.

**Verify:** arming from the CLI reflects in the bar widget and the overlay within a
second; the countdown ticks; the overlay opens on every monitor.

---

## Phase 2 — Arming UI

**Goal:** a complete arming flow with no side effects.

- `Panel.qml` + `Dialog.qml` — wall-clock **or** duration input, challenge preset
  picker, N (reps), a live preview of the sleep screen, and the arm button.
- The preview renders the real overlay content with a fake countdown, no dimming, no
  audio, no input capture.

**Verify:** arming with a time and a challenge enters `armed`; the preview matches the
real screen visually.

---

## Phase 3 — Challenge engine

**Goal:** solvable challenges with no side effects.

- `Steps.js` — generators for `math`, `string`, `memory`. Each returns
  `{ prompt, expected, check(input) }`. Pure functions, unit-testable.
- `Challenge.js` — preset resolution, shuffle-from-pool, step sequencing, progress
  tracking, retry semantics (a wrong answer keeps completed steps), error counting.
- `Camera.js` — the single-frame luminance read.
- A challenge UI panel: shows the current step, accepts input, flashes "not quite" on
  failure, shows the error counter, shows step progress.

**Verify:** every step type is solvable; a wrong answer preserves progress; N is
honored (N=2 on a 4-step challenge requires 8 steps); a failed math step re-randomizes.

---

## Phase 4 — Display control

**Goal:** dim on arm, restore on exit.

- `Display.js` — read the current `intel_backlight` value; ensure hyprsunset is
  running (`setsid uwsm-app -- hyprsunset &`); set gamma with the 10×/0.2s retry
  loop; restore brightness + `hyprctl hyprsunset identity`; stop hyprsunset if the
  plugin started it.

**Verify:** both monitors dim on arm; the exact previous brightness returns on exit;
gamma returns to identity; hyprsunset is left running iff it was running before.

---

## Phase 5 — Audio

**Goal:** an alarm you can actually hear, that cleans up after itself.

- `Audio.js` — capture the sink's volume/mute; set the configured volume and unmute;
  spawn `mpv --loop=inf --no-video --really-quiet --audio-device=<sink> <file>`;
  capture the process for killing; restore volume/mute on exit.
- The alarm starts at the ring time and loops until the challenge is solved.
- Sink fallback: if the configured sink is missing, use the current default.

**Verify:** the alarm plays on the configured sink at the configured volume; the
previous volume/mute return afterward; killing the process stops the sound instantly.

---

## Phase 6 — Ring state and lockdown

**Goal:** the full behavior at the ring time, and the lockdown toggles.

- Ring transition: accent → error color, large text → "WAKE UP" in the palette's
  error color, countdown line → elapsed since alarm. Pulse is an off-by-default
  toggle.
- Lockdown: cover all monitors, exclusive focus, suppress notifications, pause
  media via MPRIS, hide the bar, block window switching — each independently
  toggleable.
- Idle suppression: touch `~/.local/state/omarchy/indicators/stay-awake` and hold a
  `systemd-inhibit --what=idle` inhibitor; clear both on exit.

**Verify:** the ring state renders as specified; the screensaver never fires during
the mode; every toggle independently changes behavior.

---

## Phase 7 — Safety and history

**Goal:** no way to be permanently locked out; a record of what happened.

- Watchdog: `systemd-run --user --unit=sleep-mode-watchdog ...` armed at mode start,
  disarmed at every normal exit. It restores display state, kills audio, and clears
  the `stay-awake` file.
- `History.js` — append a session record on exit; read the last N for the panel.
- Exit toast via `omarchy-notification-send`.
- Emergency exit: hidden hold (`Esc` for 3s) → typed confirmation. **Default OFF.**

**Verify:** killing the Quickshell process restores the display and silences the
alarm; the toast appears; a history entry is written with the correct fields.

---

## Phase 8 — Settings panel

**Goal:** everything configurable in the UI.

- Settings panel sections: challenges (preset list + step builder + per-step
  preview), display, audio, camera, lockdown, UI/palette.
- The step builder: add step → pick type → set parameters → reorder.
- The palette editor: every color in the Claude Code preset is editable; a "theme"
  option follows the live Omarchy theme.
- All writes go to `~/.config/omarchy/sleep-mode/config.json`.

**Verify:** changing any setting takes effect without a shell restart; the config
file round-trips; a partial config file still loads.

---

## Phase 9 — Test modes and polish

- **Preview** — zero side effects.
- **Dry run** — real dim, real overlay, accelerated timer (10s), real sound; no
  history entry. Both behind an explicit confirm.
- Notifications during the mode, toasts, and the armed-countdown polish in the bar.

**Verify:** preview changes nothing observable; dry run exercises every state.

---

## Phase 10 — Packaging

- Root `README.md` with install, usage, configuration, and removal.
- `preview.png` at the repo root (marketplace requirement, ≤50MB, ≤40MP).
- `LICENSE` (MIT).
- A `.desktop` entry? Only if a standalone launcher is wanted — the `omarchy-shell`
  CLI is sufficient.
- GitHub Actions: a CI job running `omarchy plugin validate .` and any JS unit tests.
- Submit to `omarchyplugins.com` via an issue on
  `omacom/omarchy-plugin-marketplace`.

---

## Unit testing

The pure logic lives in JS modules (`Config.js`, `Challenge.js`, `Steps.js`,
`History.js`) specifically so it can be tested without QML — the same pattern
`io.github.jcarcinogen.rice-bar` uses with `node --test`.

```bash
node --test tests/*.test.js
omarchy plugin validate .
```

Worth covering: math generation and evaluation, string generation and comparison,
shuffle-from-pool distribution, progress preservation on failure, N accounting,
config default merging, and history record shape.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Camera step unpassable (ThinkShutter closed) | Near-black auto-skip + arm-time pre-check + failure-count demotion |
| Camera busy or ACL revoked | `EACCES`/`EBUSY` → treat as unavailable → skip |
| hyprsunset already running | Detect and reuse; never start a second instance |
| Gamma restore drift | Restore `identity` explicitly; capture prior brightness exactly |
| The user is locked out by a crash | Watchdog restores everything |
| The mode fights Omarchy's own idle/lock | `stay-awake` state file + `systemd-inhibit` |
| Marketplace id collision | The id is fixed before publication |
