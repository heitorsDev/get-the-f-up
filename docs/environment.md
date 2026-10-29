# Environment facts

Everything below was verified against this machine (Arch Linux, Omarchy 4.0.4,
Hyprland 0.56.2 with the **Lua** config provider, PipeWire 1.6.8, Quickshell 0.3.0)
by reading installed files and running commands. Dates: October 2026.

---

## Omarchy plugin system

| Fact | Detail |
| --- | --- |
| Omarchy version | `4.0.0.alpha` file / `omarchy 4.0.4-1` package |
| Installed tree | `/usr/share/omarchy` (`$OMARCHY_PATH`) |
| Shell | Quickshell 0.3.0, one long-running `omarchy-shell` instance |
| Plugin author docs | `/usr/share/omarchy/shell/README.md` |
| Validator | `/usr/bin/omarchy-plugin-validate` |
| Plugin kinds | `bar-widget`, `panel`, `overlay`, `menu`, `service`, `bar` |
| CLI | `omarchy plugin add\|clone\|catalog\|disable\|enable\|list\|remove\|update\|validate` |

### Manifest contract

`schemaVersion` must be the JSON number `1`. Required: `id`, `name`, `version`,
`kinds`, `entryPoints`. The id must match `^[A-Za-z0-9][A-Za-z0-9._-]*$`, contain no
`..`, and must not start with `omarchy.` (reserved; rejected at scan time by
`PluginRegistry.qml`). Entry point paths are relative, may not contain `..`, and the
file must exist. **No symlinks anywhere in the plugin directory** except inside `.git`.

### Two important gotchas

**1. `barWidget.schema` is inert.** `shell.qml:1400` copies the manifest's
`barWidget` block (including `schema`) into widget metadata and **nothing ever reads
`metadata.schema`**. There is no `plugins/settings/` directory. Any plugin that
relies on the manifest schema for a settings UI is shipping a dead config. Ship a
panel.

**2. `shell.shellConfig` is `undefined` for third-party plugins.** First-party
plugins get the real `ShellRoot`; third-party plugins get a `PluginShellApi` facade
whose properties are `pluginId`, `appLibrary`, `bar`, `barConfig`, `idleConfig` — and
no `shellConfig`. `wmfeht.border-fx` and `io.github.jcarcinogen.rice-bar` both read
`shell.shellConfig` and therefore silently operate on defaults today. The working
paths are:

- read: the injected `settings` property (the `shell.json` entry minus `id`), or
- read: your own config file on disk.

### Third-party scope rules

From `shell.qml:627-656`, a third-party plugin may only summon/hide/toggle:

- its **own** id (`pluginOwnsTarget`), or
- a plugin it may control via `barPluginMayControl`, which requires the caller to
  declare the **`bar`** kind, or
- a hardcoded clone allowlist (`pluginCloneMaySummon`): `omarchy.audio`/`media`/
  `monitor` → `omarchy.osd`; `omarchy.network` → `omarchy.speedtest`/`wifiqr`.

**Consequence:** a `service`/`overlay`/`bar-widget` plugin cannot summon
`omarchy.osd`. Send notifications with `omarchy-notification-send` via
`Quickshell.Io.Process` instead.

### Service vs. panel vs. overlay

- A **service** is a headless singleton. `shell.callIfLoaded` resolves **only**
  `panelLoaders[id]` — so `omarchy-shell shell call` cannot invoke a service. Services
  expose their own IPC target instead: `IpcHandler { target: "sleep-mode" }`, invoked
  as `omarchy-shell sleep-mode <method> [args]`.
- A **panel**/**overlay** must implement `open(payloadJson)`, `close()`, and expose
  `opened` as a bool. `toggle()` and `closeForPopoutSwitch()` are conventions, not
  host requirements.
- Declaring both `panel` and `overlay` makes it a panel (`panel > overlay > menu`
  precedence in `shell.qml:1298`).

### CLI

```bash
omarchy-shell <target> <method> [args...]
omarchy-shell shell summon <id> '{}'      # {} is auto-appended for summon/toggle
omarchy-shell shell hide <id>
omarchy-shell shell toggle <id> '{}'
omarchy-shell shell listPlugins
omarchy-shell shell rescanPlugins
```

---

## Fullscreen overlay

Per-monitor pattern, from `plugins/background/Background.qml` and
`plugins/notifications/Service.qml`:

```qml
import Quickshell
import Quickshell.Wayland

Variants {
  model: Quickshell.screens
  delegate: Component {
    PanelWindow {
      required property var modelData
      screen: modelData
      visible: root.opened
      color: "transparent"
      exclusionMode: ExclusionMode.Ignore
      WlrLayershell.namespace: "omarchy-sleep-mode"
      WlrLayershell.layer: WlrLayer.Overlay
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
      anchors { top: true; bottom: true; left: true; right: true }
    }
  }
}
```

- `Variants` comes from `Quickshell` (core), `PanelWindow` from `Quickshell`, and
  `WlrLayershell` / `WlrLayer` / `WlrKeyboardFocus` from `Quickshell.Wayland`.
- `WlrLayershell.namespace` must be unique per surface role.
- `exclusionMode: ExclusionMode.Ignore` on every overlay.
- `mask: Region {}` makes a surface click-through; `mask: Region { item: x }` limits
  clickability to that item.
- Live layer surfaces: `omarchy-background` (0), `omarchy-rice-bar` (1),
  `omarchy-bar` (2). Level 3 (overlay) is free.

**Note:** Omarchy's own lock uses `WlSessionLock` (ext-session-lock-v1), not
layer-shell — a strictly stronger mechanism. Its preview window does use layer-shell
with `Exclusive` focus, which is the pattern copied here.

---

## Displays

```
eDP-1    1920x1080@60.008  scale 1.2   variable brightness (intel_backlight)
HDMI-A-2 1440x900@59.887   scale 1.0   NO DDC/CI
```

- `ddcutil detect` → "This monitor does not support DDC/CI" on HDMI-A-2. The laptop
  panel is also not DDC-capable ("Laptop displays do not support DDC/CI").
- `brightnessctl -l` lists 26 devices; only `intel_backlight` is a real backlight.
  The other 25 are keyboard/indicator LEDs.
- `brightnessctl -d intel_backlight -m` → `intel_backlight,backlight,12363,51%,24242`
- Hyprland's `sdrBrightness` is a **config-time** monitor rule, not runtime-adjustable
  (`hyprctl keyword` is unusable here — the Lua config provider rejects it; use
  `hyprctl eval`).

---

## hyprsunset

- Installed: `hyprsunset v0.4.0`. **Not running by default**; the systemd user unit
  `hyprsunset.service` exists but is `disabled`.
- `~/.config/hypr/hyprsunset.conf` has one profile active all day with
  `identity = true` → no color change by default. **So `identity` is the correct
  restore state.**
- CLI: `hyprsunset --gamma`, `--temperature`, `--identity`, `--gamma_max`. No
  `--list`.
- `hyprctl hyprsunset` supports exactly three requests: `temperature <K>`,
  `identity`, `gamma <percent>`.
- Socket (undocumented but working): `$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.hyprsunset.sock`
  — plain-text commands, **no trailing newline**. Supports `temperature`, `gamma`,
  `identity`, `reset`, `reset temperature|gamma|identity`, `profile`.
- **Only one instance may run** — a second exits with "A CTM manager is already
  running on the current compositor."
- A freshly started instance applies its profile at boot and can clobber values set
  before it finished starting. Omarchy's `omarchy-toggle-nightlight` works around
  this by re-sending the temperature up to 10 times at 0.2s intervals — do the same
  for gamma.
- `temperature` forces `identity = false`; `gamma` does not.
- Valid ranges: temperature 1000–20000 K; gamma 0–`max-gamma` (default 100%).
- Start it the way Omarchy does: `setsid uwsm-app -- hyprsunset &`.

---

## Audio

- PipeWire 1.6.8 + WirePlumber 1.6.8.
- Sinks: `alsa_output.pci-0000_00_1f.3.analog-stereo` (built-in, id 55) and
  `bluez_output.88_92_CC_B9_18_5C.1` (JBL Tune 770NC, id 69, **the default**).
- `playerctl` is **not** installed. `wpctl`, `pactl`, `pw-cli`, `pw-play`, `paplay`,
  `mpv` (0.41.0) are.
- **`pw-play` and `paplay` have no `--loop`.** `pw-play --properties node.loop=true`
  was tested and played exactly once. Use `mpv --loop=inf` or a shell loop.
- Target a sink: `pw-play --target <id|name>`, `paplay -d <sink>`, or
  `mpv --audio-device=<sink>`.
- Volume/mute: `wpctl set-volume <id> <pct>`, `wpctl set-mute <id> 1|0|toggle`.
- From QML: `Quickshell.Services.Pipewire` exposes `PwNode` (`id`, `name`,
  `description`, `isSink`, `properties`, `audio`) and `PwNodeAudio` (`muted`,
  `volume`, `channels`).

---

## Camera

- Device: `/dev/video0` — "Integrated Camera: Integrated C (usb-0000:00:14.0-8)",
  Azurewave/IMC Networks, UVC, `uvcvideo` 7.2.3 bound.
- `/dev/video1` is the metadata node (no formats). `/dev/media0` is the V4L2 topology.
- Formats: MJPG 1280x720@30 (and smaller), YUYV 1280x720@10.
- Access: ACL grants `heitor` rw (via `70-uaccess.rules` `TAG+="uaccess"` on an
  active logind seat). **`heitor` is not in the `video` group.** Handle `EACCES`.
- **No XDG Camera portal**: `xdg-desktop-portal-camera` is not installed and is not
  in Arch's repos. `xdg-desktop-portal-hyprland` implements only ScreenCast,
  Screenshot, GlobalShortcuts, InputCapture. → **direct V4L2 only**; no
  browser/WebRTC path.
- PipeWire does publish the camera: node `v4l2:/dev/video0`, `media.class =
  "Video/Source"`, `media.role = "Camera"`.
- Machine is a **ThinkPad T490** (`20N3SF5M01`). The ThinkShutter state is
  **undetectable from software**: no camera LED, no ACPI camera attribute, no fwupd,
  no hwdb entry for `13d3:56a6`.
- No camera activity indicator LED exists on this machine.
- Omarchy ships `omarchy-capture-webcam-list` and `omarchy-hw-webcam` (both detect
  the webcam); no standalone camera app is installed.

### Luminance

```bash
ffmpeg -hide_banner -f v4l2 -input_format mjpeg -video_size 640x480 \
  -i /dev/video0 -frames:v 1 \
  -vf "signalstats,metadata=print:key=lavfi.signalstats.YAVG" \
  -f null - 2>&1 | grep -oE 'YAVG=[0-9.]+' | cut -d= -f2
```

- `signalstats` + `metadata=print` verified working on synthetic sources:
  black → 16, gray → 126, white → 235 (BT.601 limited-range Y).
- `metadata=print` logs at INFO level — do **not** pass `-loglevel error`, or the
  line is suppressed.
- Zero-dependency fallback (no PIL/numpy/cv2 installed — ImageMagick `magick` is):

  ```bash
  ffmpeg -hide_banner -loglevel error -f v4l2 -i /dev/video0 -frames:v 1 \
    -pix_fmt gray -f rawvideo - 2>/dev/null |
    python3 -c "import sys;d=sys.stdin.buffer.read();print(sum(d)/len(d))"
  ```

- Motion alternative (not used in the spec, kept for reference):
  `tblend=all_mode=difference` before `signalstats` turns YAVG into a motion score.

---

## Idle / screensaver

- Config lives in `shell.json` → `idle: { "lock": 300, "screensaver": 150 }`.
- The shell's idle service lives at `plugins/services/idle/Service.qml`.
- **Suppression mechanism:** the service probes and watches the state file
  `~/.local/state/omarchy/indicators/stay-awake`. If present, `idleEnabled` is false
  and neither the screensaver nor the lock fires. This is exactly what
  `omarchy-toggle-idle stay-awake` does.
- The screensaver is `omarchy-launch-screensaver` (needs `ttfx` and a supported
  terminal: Alacritty, Foot, Ghostty, Kitty).
- `systemd-inhibit` is available at `/usr/bin/systemd-inhibit`; Omarchy already uses
  it (`--what=sleep`). `--what=idle` blocks idle inhibitors.
- `hypridle` is **not** installed.

---

## Fonts

`fc-match monospace` → `JetBrainsMonoNerdFont-Regular.ttf`. Present: JetBrainsMono
Nerd Font, Adwaita Mono, DejaVu Sans Mono, Liberation Mono, Nimbus Mono PS, iA Writer
Mono S, Material Symbols, `omarchy`. Absent: Berkeley Mono, Iosevka, Cascadia, Fira,
Hack, Source Code Pro.

---

## Shell style API

`qs.Commons` exports:

- `Color`: `foreground`, `background`, `accent`, `urgent`, `muted`, and nested
  `bar.*`, `popups.*`, `tooltip.*`, `notifications.*` groups.
- `Style`: `cornerRadius`, `gapsOut`, `spacingScale`, `spacing` (with `Style.space(n)`),
  `font.*`, border/fill alpha tokens.
- `Util`: `execDetached`, `fileUrl`, and helpers.

---

## Not available here

`waybar` · `hyprlock` · `hypridle` · `playerctl` · `light` · `gammastep` ·
`wlr-randr` · `xbacklight` · `eww` · `ags` · `tofi` · `mako` · `swayidle` · `pw-loop` ·
`ghostty` · `wezterm` · `st` · `sox` · `cheese` · `guvc` · `libcamera` ·
`xdg-desktop-portal-camera` · `PIL` / `numpy` / `cv2` (ImageMagick is present)

---

## Hyprland Lua config provider

This machine runs Hyprland with `configProvider: lua`. Consequences:

- `hyprctl keyword ...` fails: *"keyword can't work with non-legacy parsers. Use eval."*
- Live config lives in `~/.config/hypr/*.lua` (`hyprland.lua`, `bindings.lua`,
  `monitors.lua`, …) with `.conf` files as the legacy layer.
- Dispatchers are available as `hl.dsp.*` via `hyprctl eval`.
- **Runtime keybind registration is unverified.** `hyprctl eval` with the Lua config
  API may be able to register a bind; this needs investigation. Until then, no
  hotkey in v1.
