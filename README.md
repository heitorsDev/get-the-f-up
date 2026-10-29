# Sleep Mode

An Omarchy plugin that turns your machine into an **alarm clock instead of a
computer**.

Arm it with a time and a challenge. The screen goes black with a clock, the display
dims, and at the ring time an alarm sounds that only stops when you complete the
challenge. You can also leave early by completing it.

> **Status:** specification complete, not yet implemented. See
> [`SPEC.md`](./SPEC.md) for the full design.

---

## What it will do

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

## Install (once implemented)

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

## License

MIT
