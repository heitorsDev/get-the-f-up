# Sleep Mode

An Omarchy plugin that turns your machine into an **alarm clock instead of a
computer**.

Arm it with a time and a challenge. The screen goes black with a clock, the display
dims, and at the ring time an alarm sounds that only stops when you complete the
challenge. You can also leave early by completing it.

> **Status:** in development. See [`SPEC.md`](./SPEC.md) for the full design and
> [`docs/implementation-plan.md`](./docs/implementation-plan.md) for the phases.

---

## What it does

- **Fullscreen sleep screen** on every monitor — black background, a large ticking
  clock, the ring time, and a live countdown. Claude Code TUI styling.
- **Dims the display** via hyprsunset gamma, which reaches both your laptop panel and
  an external monitor (the external one has no DDC/CI, so backlight control can't).
- **Forces the alarm volume up** to a level you configure, on a sink you configure.
- **A challenge you cannot skip** — math, typing, memory, or a camera check that
  forces you to get up and turn the light on. N complete challenges to exit, before
  or after the ring.
- **Locks the machine down** while active — every behavior (notifications, media,
  bar, window switching, all monitors) is individually toggleable.
- **Restores everything** on exit: brightness, gamma, volume, mute, idle behavior.
- **Test modes** — a zero-side-effect preview, and a full-fidelity dry run with an
  accelerated timer so you can see (and hear) the alarm state without waiting.

---

## Install

```bash
omarchy plugin add https://github.com/heitorsDev/omarchy-sleep-mode.git --enable
```

## Remove

```bash
omarchy plugin remove io.github.heitorsdev.sleep-mode
```

Your settings (`~/.config/omarchy/sleep-mode/`) and history
(`~/.local/state/omarchy/sleep-mode/`) are left in place; delete them by hand.

---

## CLI

The plugin exposes a headless IPC target, so external bars and scripts can drive it:

```bash
omarchy-shell sleep-mode status
omarchy-shell sleep-mode arm   '{"time":"07:30","challenge":"standard","reps":3}'
omarchy-shell sleep-mode arm   '{"duration":"45m","challenge":"thorough","reps":2}'
omarchy-shell sleep-mode open  '{}'
omarchy-shell sleep-mode history
omarchy-shell sleep-mode preview
omarchy-shell sleep-mode dryrun
```

`disarm` is rejected unless the challenge is done — the point of the mode is that
the only exits are N completed challenges or the crash watchdog.

---

## Configuration

`~/.config/omarchy/sleep-mode/config.json` — every key has a default, so a partial
file is valid. See [`SPEC.md`](./SPEC.md#16-configuration-reference) for the full
reference.

---

## Development

```bash
npm test                # node --test tests/*.test.js
omarchy plugin validate .
```

---

## License

MIT
