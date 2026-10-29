import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Services.Mpris
import qs.Commons

import "Audio.js" as Audio
import "Camera.js" as Camera
import "Challenge.js" as Challenge
import "Config.js" as Config
import "Display.js" as Display
import "History.js" as History
import "Lockdown.js" as Lockdown
import "Palette.js" as Palette
import "Steps.js" as Steps
import "Time.js" as Time

// The Sleep Mode service (SPEC.md §2).
//
// Owns the state machine (idle / armed / ringing), the one-second clock, the
// challenge engine and every side effect: display dimming, the alarm, the
// camera check, the lockdown toggles, the crash watchdog and the CLI IPC
// target.
//
// The JS modules stay pure — they only build commands and parse output. Every
// command that touches the machine is run through a Quickshell Process.
Scope {
  id: root

  // ---- host injection -------------------------------------------------------
  property var shell: null
  property var manifest: null
  property string omarchyPath: ""

  readonly property string pluginId: manifest && manifest.id
    ? String(manifest.id) : "io.github.heitorsdev.sleep-mode"
  readonly property string home: Quickshell.env("HOME")
  // The plugin's own directory, resolved from this file's URL. Used to find
  // bin/sleep-mode-restore, bin/sleep-mode-watchdog and assets/.
  readonly property string pluginDir: Lockdown.urlToPath(Qt.resolvedUrl("."))
  readonly property string configPath: Config.configPath(home)
  readonly property string historyPath: Config.historyPath(home)
  readonly property string activePath: Config.activePath(home)
  readonly property string emergencyPhrase: Lockdown.EMERGENCY_PHRASE
  // The crash watchdog waits on this pid.
  readonly property int shellPid: Quickshell.processId

  // ---- live state (the UI contract, docs/contracts.md) ----------------------
  readonly property string state: _state
  property string _state: "idle"
  property bool previewing: false
  // Which screen the preview shows: "armed" or "ringing".
  property string previewVariant: "armed"
  property bool dryRun: false
  property real now: 0
  property var config: Config.defaults()
  property var palette: Palette.resolve(config.ui, themeSnapshot)
  property var session: null
  property var challenge: null
  property string cameraPrecheck: "unknown"
  property string cameraStatus: "idle"
  property var lastResult: null
  property var historyList: []
  property string lastError: ""

  // The challenge engine state (Challenge.create) and the resolved preset.
  property var _engine: null
  property var _resolved: null
  // The restore record mirrored to active.json (Lockdown.makeRecord).
  property var _record: null
  property string _exitReason: ""
  // True once the challenge of the last session was completed; the CLI
  // `disarm` command is only allowed after that.
  property bool _lastChallengeDone: false

  signal ringing()
  signal finished(var record)

  // The live Omarchy theme, in the shape Palette.fromTheme expects.
  readonly property var themeSnapshot: ({
    background: Color.background,
    foreground: Color.foreground,
    muted: Color.muted,
    accent: Color.accent,
    urgent: Color.urgent,
    popups: ({ border: Color.popups.border }),
    menu: ({ border: Color.menu.border })
  })

  // ---- the clock ------------------------------------------------------------
  Timer {
    id: tickTimer
    interval: 1000
    repeat: true
    running: true
    triggeredOnStart: true
    onTriggered: root.tick()
  }

  // ---- configuration and history -------------------------------------------
  FileView {
    id: configFile
    path: root.configPath
    watchChanges: true
    printErrors: false
    onLoaded: root.applyConfigText(text())
    onLoadFailed: root.config = Config.defaults()
    onFileChanged: configFile.reload()
  }

  FileView {
    id: historyFile
    path: root.historyPath
    watchChanges: true
    printErrors: false
    onLoaded: root.historyList = History.parse(text())
    onLoadFailed: root.historyList = []
    onFileChanged: historyFile.reload()
  }

  // ---- the one-shot command runner -----------------------------------------
  // A single Process runs every short-lived command in order. Each step is
  // { cmd: [argv], done: function(exitCode, output) }.
  //
  // Every command runs inside a small wrapper that merges stderr into stdout
  // and prints its exit code as a last line. The step finishes when that one
  // stream ends, never from the Process `exited` signal: `exited` can fire
  // before the collector has been drained, which handed callers an empty
  // string and silently broke the state capture, the sink probe and the
  // sound pick.
  property var _queue: []
  property var _current: null
  property bool _stepStarted: false
  property int _stepExit: 1

  Process {
    id: runner
    stdout: StdioCollector {
      id: runnerOut
      onStreamFinished: root.finishStep(runnerOut.text)
    }

    onStarted: root._stepStarted = true
    // The stream normally ends first; if a command left a grandchild holding
    // the pipe open, fall back to what has been read after a short wait.
    onExited: function(exitCode) {
      root._stepExit = exitCode
      stepSettle.restart()
    }
    onRunningChanged: {
      // A command that cannot even start never emits `exited`; treat it as a
      // failed step so the queue keeps moving.
      if (runner.running) {
        root._stepStarted = true
      } else if (root._current !== null && !root._stepStarted) {
        root.finishStep("@@exit=127")
      }
    }
  }

  Timer {
    id: stepSettle
    interval: 1500
    onTriggered: root.finishStep(runnerOut.text)
  }

  function enqueue(steps) {
    if (!steps) return
    for (var i = 0; i < steps.length; i++) root._queue.push(steps[i])
    root.pump()
  }

  function run(command, done) {
    root.enqueue([{ cmd: command, done: done }])
  }

  function pump() {
    if (root._current !== null) return
    if (root._queue.length === 0) return
    root._current = root._queue.shift()
    root._stepStarted = false
    root._stepExit = 1
    runner.command = Camera.wrapCommand(root._current.cmd, "sleep-mode-step")
    runner.running = true
  }

  function finishStep(text) {
    stepSettle.stop()
    var step = root._current
    if (step === null) return
    root._current = null
    var framed = Camera.unwrap(text)
    var exitCode = framed.exit === null ? root._stepExit : framed.exit
    var output = framed.output
    if (step.done) {
      try {
        step.done(exitCode, output)
      } catch (e) {
        console.warn("sleep-mode: step failed: " + e)
      }
    }
    root.pump()
  }

  // ---- result helpers -------------------------------------------------------
  function ok(extra) {
    root.lastError = ""
    var out = { ok: true }
    if (extra) {
      for (var key in extra) out[key] = extra[key]
    }
    return out
  }

  function fail(message) {
    root.lastError = String(message || "unknown error")
    return { ok: false, error: root.lastError }
  }

  // A CLI payload is a JSON object; anything else is an error the caller
  // sees instead of a silent default.
  function parsePayload(text) {
    var raw = text === undefined || text === null ? "" : String(text).trim()
    if (raw === "") return { value: {}, error: "" }
    var data
    try {
      data = JSON.parse(raw)
    } catch (e) {
      return { value: {}, error: "the payload is not valid JSON: " + e.message }
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return { value: {}, error: "the payload must be a JSON object" }
    }
    return { value: data, error: "" }
  }

  // ---- the clock ------------------------------------------------------------
  function tick() {
    var t = Date.now()
    root.now = t
    if (root.state === "armed" && root.session && t >= Number(root.session.ringAt)) {
      root.enterRinging(t)
      return
    }
    if (root.state !== "idle" && root.session) {
      if (Lockdown.maxDurationReached(root.config.lockdown, root.session.armedAt, t)) {
        root.exitSession("the maximum duration was reached")
      }
    }
  }

  // ---- configuration --------------------------------------------------------
  function applyConfigText(raw) {
    var parsed = Config.parse(raw)
    root.config = parsed.config
    if (parsed.error) root.lastError = parsed.error
  }

  function saveConfig(config) {
    var merged = Config.merge(config)
    root.config = merged
    root.run(Lockdown.writeFileCommand(root.configPath, Config.serialize(merged)), function() {
      console.log("sleep-mode: config written")
    })
    return root.ok()
  }

  function reloadConfig() {
    configFile.reload()
    return root.ok()
  }

  // ---- the overlay ----------------------------------------------------------
  function openOverlay(mode) {
    if (!root.shell || typeof root.shell.summon !== "function") {
      return root.fail("the shell is not available")
    }
    var payload = JSON.stringify({ mode: mode === "preview" ? "preview" : "sleep" })
    if (root.shell.summon(root.pluginId, payload) !== true) {
      return root.fail("could not open the overlay")
    }
    return root.ok()
  }

  // variant: "armed" (the idle sleep screen, the default) or "ringing" (the
  // alarm screen). Either way nothing is dimmed, played or locked.
  function startPreview(variant) {
    if (root.state !== "idle") return root.fail("sleep mode is already active")
    root.previewVariant = variant === "ringing" ? "ringing" : "armed"
    root.previewing = true
    root.openOverlay("preview")
    return root.ok()
  }

  function stopPreview() {
    root.previewing = false
    if (root.state === "idle" && root.shell && typeof root.shell.hide === "function") {
      root.shell.hide(root.pluginId)
    }
    return root.ok()
  }

  // ---- arming ---------------------------------------------------------------
  function arm(payload) {
    return root.beginSession(payload, false)
  }

  function startDryRun(payload) {
    return root.beginSession(payload, true)
  }

  function beginSession(payload, dry) {
    if (root.state !== "idle") return root.fail("sleep mode is already active")
    if (root.previewing) root.stopPreview()
    root.stopCameraLive()

    var request = payload || {}
    var when = { ringAt: 0, error: "" }
    if (dry === true) {
      // A dry run always rings after ten seconds, whatever the payload says.
      when.ringAt = Date.now() + 10000
    } else {
      when = Time.parseWhen(request, Date.now())
      if (when.error) return root.fail(when.error)
    }

    var presetName = request.challenge === undefined || request.challenge === null
      || request.challenge === "" ? "default" : String(request.challenge)
    var resolved = Challenge.resolvePreset(root.config, presetName)
    if (!resolved) return root.fail("unknown challenge preset \"" + presetName + "\"")
    if (request.removeCamera === true) resolved = Challenge.removeCameraSteps(resolved)

    var reps = request.reps === undefined || request.reps === null
      ? Number(root.config.challenge.reps)
      : Number(request.reps)
    reps = Math.max(1, Math.floor(reps || 1))

    var armedAt = Date.now()
    root.dryRun = dry === true
    root._resolved = resolved
    root._engine = Challenge.create(resolved, reps)
    root.session = {
      armedAt: armedAt,
      ringAt: when.ringAt,
      ringingSince: 0,
      preset: resolved.name,
      reps: reps,
      dryRun: dry === true
    }
    root.challenge = Challenge.view(root._engine)
    root._state = "armed"
    root.setupSession()
    return root.ok()
  }

  // Everything that touches the machine happens after the pre-state capture,
  // and the restore record is on disk before the first change is made, so a
  // crash at any point leaves the watchdog something to undo.
  function setupSession() {
    var session = root.session
    root.run(Lockdown.captureCommand(root.home, Display.BACKLIGHT_DEVICE), function(code, out) {
      // The session can end while the capture runs (emergency exit, cap).
      if (root.session !== session) return
      var cap = Lockdown.parseCapture(out)
      var brightness = Display.parseBrightness(cap.brightnessText)
      var displayPlan = Display.plan(root.config.display,
        { brightness: brightness, hyprsunsetRunning: cap.hyprsunsetRunning })
      var lockdownPlan = Lockdown.plan(root.config.lockdown, cap)

      root._record = Lockdown.makeRecord({
        pid: root.shellPid,
        startedAt: session.armedAt,
        dryRun: session.dryRun,
        display: root.config.display,
        brightness: brightness,
        hyprsunsetRunning: cap.hyprsunsetRunning,
        previousGamma: Display.parseGamma(cap.gammaText),
        displayPlan: displayPlan,
        lockdownPlan: lockdownPlan
      })
      root.writeRecord()
      if (!root.config.safety || root.config.safety.watchdog !== false) {
        root.run(Lockdown.watchdogStartCommand(root.pluginDir, root.shellPid), function(exitCode) {
          if (exitCode !== 0) console.warn("sleep-mode: the crash watchdog did not start")
        })
      }
      root.applyLockdown(lockdownPlan)
      root.applyDisplay(displayPlan)
      root.openOverlay("sleep")
    })
  }

  // The restore record bin/sleep-mode-restore acts on.
  function writeRecord() {
    if (!root._record) return
    root.run(Lockdown.writeFileCommand(root.activePath, JSON.stringify(root._record, null, 2) + "\n"))
  }

  // ---- display ----------------------------------------------------------------
  function applyDisplay(plan) {
    var steps = []
    if (plan.startHyprsunset) steps.push({ cmd: Display.hyprsunsetStartCommand() })
    if (plan.setBacklight) {
      steps.push({ cmd: Display.brightnessSetPercentCommand(Display.BACKLIGHT_DEVICE, plan.backlightPercent) })
    }
    if (plan.dim) {
      // A freshly started hyprsunset can clobber a value set before it
      // finished booting, so the gamma command re-sends it several times.
      steps.push({ cmd: Display.gammaApplyCommand(plan.gammaPercent, Display.GAMMA_TRIES, Display.GAMMA_INTERVAL_S) })
    }
    root.enqueue(steps)
  }

  // ---- lockdown ---------------------------------------------------------------
  function applyLockdown(plan) {
    root.enqueue([{ cmd: Lockdown.applyCommand(root.home, plan) }])
    inhibitor.running = plan.holdInhibitor === true
    if (plan.pauseMedia) root.pauseMedia()
  }

  function pauseMedia() {
    var players = Mpris.players ? Mpris.players.values : []
    var targets = Lockdown.pauseTargets(players)
    for (var i = 0; i < targets.length; i++) {
      var player = players[targets[i]]
      if (player.canPause) player.pause()
      else player.togglePlaying()
    }
  }

  // Blocks the system idle action (screensaver, lock, suspend) for as long as
  // it runs; the child also exits on its own when the shell dies.
  Process {
    id: inhibitor
    command: Lockdown.inhibitCommand(root.shellPid)
  }

  // ---- the ring -------------------------------------------------------------
  function enterRinging(at) {
    if (root.state !== "armed" || !root.session) return
    if (root.session.ringingSince) return
    // Replace the object: a nested write would not notify the UI bindings.
    var next = {}
    for (var key in root.session) next[key] = root.session[key]
    next.ringingSince = at
    root.session = next
    root._state = "ringing"
    root.ringing()
    root.startAlarm()
  }

  // Resolve the sink, remember its volume and mute, force them, then loop the
  // alarm. Each stage re-checks the state so an exit mid-chain stops it.
  function startAlarm() {
    root.run(Audio.sinkProbeCommand(), function(code, out) {
      if (root.state !== "ringing") return
      var sections = Lockdown.splitSections(out)
      var picked = Audio.resolveSink(root.config.audio.sink,
        Audio.parseSinkList(sections.sinks), Audio.parseDefaultSink(sections["default"]))
      if (picked.reason) console.warn("sleep-mode: " + picked.reason)
      var sink = picked.sink

      root.run(Audio.captureCommand(sink), function(code2, out2) {
        if (root.state !== "ringing") return
        var captured = Lockdown.splitSections(out2)
        // Record the sink's previous volume and mute before changing them, so
        // the restore script (and the watchdog) can put them back.
        root._record = Lockdown.withAudio(root._record || Lockdown.makeRecord({}), sink,
          Audio.parseVolume(captured.volume), Audio.parseMute(captured.mute), root.config.audio)
        root.writeRecord()
        root.run(Audio.forceCommand(sink, root.config.audio))

        var candidates = Audio.soundCandidates(root.config.audio, root.pluginDir)
        root.run(Audio.pickSoundCommand(candidates), function(code3, out3) {
          if (root.state !== "ringing") return
          var file = Audio.parsePickedSound(out3)
          if (!file) {
            root.lastError = "no alarm sound could be found"
            return
          }
          alarm.command = Audio.playerCommand(sink, file)
          alarm.running = true
        })
      })
    })
  }

  function stopAlarm() {
    alarm.running = false
  }

  // The looping alarm. Its own Process, not the shared runner, because it
  // never exits on its own.
  Process {
    id: alarm
    onStarted: {
      if (!root._record) return
      root._record = Lockdown.withPlayerPid(root._record, alarm.processId)
      root.writeRecord()
    }
  }

  // ---- the challenge --------------------------------------------------------
  function submit(input) {
    if (root.state === "idle") return root.fail("sleep mode is not active")
    if (!root._engine) return root.fail("no challenge is running")
    if (root._engine.current && root._engine.current.type === "camera") {
      return root.fail("this is a camera step: capture a frame")
    }
    var text = input === undefined || input === null ? "" : String(input)
    var result = Challenge.submit(root._engine, text)
    root._engine = result.state
    root.challenge = Challenge.view(root._engine)
    var correct = result.correct === true
    root.lastResult = {
      correct: correct,
      skipped: false,
      reason: correct ? "ok" : "wrong",
      at: Date.now()
    }
    var done = !!(root._engine && root._engine.done)
    if (done) root.exitSession("the challenge was solved")
    return root.ok({ correct: correct, finished: done })
  }

  // ---- the camera -----------------------------------------------------------
  // A dedicated Process: a capture can take ten seconds and must never hold
  // up the restore commands queued behind it on the shared runner. Nothing is
  // written anywhere; ffmpeg prints luminance statistics and discards the
  // frame. Like the runner, it finishes when its single output stream ends.
  property var _cameraDone: null
  property bool _cameraStarted: false
  property int _cameraExit: 1

  Process {
    id: cameraProc
    stdout: StdioCollector {
      id: cameraOut
      onStreamFinished: root.finishCamera(cameraOut.text)
    }
    onStarted: root._cameraStarted = true
    onExited: function(exitCode) {
      root._cameraExit = exitCode
      cameraSettle.restart()
    }
    onRunningChanged: {
      // A command that cannot start never emits `exited`.
      if (!cameraProc.running && root._cameraDone !== null && !root._cameraStarted) {
        root.finishCamera("@@exit=127")
      }
    }
  }

  Timer {
    id: cameraSettle
    interval: 1500
    onTriggered: root.finishCamera(cameraOut.text)
  }

  function runCamera(done) {
    // One open of the device at a time: a live preview holds it.
    if (cameraProc.running || root._cameraDone !== null || root.cameraLive) return false
    root._cameraDone = done
    root._cameraStarted = false
    root._cameraExit = 1
    cameraProc.command = Camera.captureShellCommand(root.config.camera.device, Camera.SETTLE_FRAMES)
    cameraProc.running = true
    return true
  }

  function finishCamera(text) {
    cameraSettle.stop()
    var done = root._cameraDone
    if (done === null) return
    root._cameraDone = null
    var framed = Camera.unwrap(text)
    done(Camera.reading(framed.output, framed.exit === null ? root._cameraExit : framed.exit))
  }

  // ---- the live preview (settings panel) -------------------------------------
  // Off until startCameraLive() is called from an explicit button, and stopped
  // when the panel closes, a session begins or the shell goes away. Frames go
  // to a file in the runtime dir (tmpfs) for the panel to show; it is removed
  // on stop. See Camera.liveCommand.
  readonly property string runtimeDir: Quickshell.env("XDG_RUNTIME_DIR") || "/tmp"
  property bool cameraLive: false
  property real cameraLuma: -1
  property real cameraSpread: -1
  property string cameraLiveError: ""
  property string cameraFrame: ""
  property int cameraFrameSeq: 0
  property real _liveLow: -1

  Process {
    id: liveProc
    stderr: SplitParser {
      onRead: function(line) { root.onLiveLine(line) }
    }
    onExited: function(exitCode) {
      var wanted = root.cameraLive
      console.log("sleep-mode: camera preview process exited with " + exitCode
        + (root.cameraLiveError ? " (" + root.cameraLiveError + ")" : ""))
      root.cameraLive = false
      root.cameraFrame = ""
      if (wanted && root.cameraLiveError === "") {
        root.cameraLiveError = exitCode === 124 ? "stopped after ten minutes" : "EIO"
      }
    }
  }

  function onLiveLine(line) {
    var stat = Camera.parseLiveLine(line)
    if (stat) {
      if (stat.key === "YLOW") {
        root._liveLow = stat.value
      } else if (stat.key === "YHIGH") {
        if (root._liveLow >= 0) root.cameraSpread = Math.max(0, stat.value - root._liveLow)
      } else {
        if (root.cameraFrameSeq === 0) console.log("sleep-mode: camera preview first frame, luma " + stat.value)
        root.cameraLuma = stat.value
        root.cameraLiveError = ""
        // The frame is written just after its statistics are printed.
        root.cameraFrame = "file://" + Camera.previewFile(root.runtimeDir)
        root.cameraFrameSeq = root.cameraFrameSeq + 1
      }
      return
    }
    var code = Camera.liveErrorCode(line)
    if (code) {
      console.log("sleep-mode: camera preview error " + code + ": " + line)
      root.cameraLiveError = code
    }
  }

  // device is optional: the settings panel passes the draft's, so a device
  // typed but not yet saved can be tried.
  function startCameraLive(device) {
    if (root.state !== "idle") return root.fail("sleep mode is active")
    if (root.cameraLive) return root.ok()
    if (cameraProc.running || root._cameraDone !== null) return root.fail("the camera is busy")
    root.cameraLuma = -1
    root.cameraSpread = -1
    root._liveLow = -1
    root.cameraLiveError = ""
    root.cameraFrame = ""
    root.cameraFrameSeq = 0
    root.cameraLive = true
    console.log("sleep-mode: camera preview starting on " + (device || root.config.camera.device))
    liveProc.command = Camera.liveCommand(device || root.config.camera.device, root.runtimeDir, Camera.LIVE_FPS)
    liveProc.running = true
    return root.ok()
  }

  function stopCameraLive() {
    if (!root.cameraLive && !liveProc.running) return root.ok()
    root.cameraLive = false
    liveProc.running = false
    root.cameraFrame = ""
    root.cameraLuma = -1
    root.cameraSpread = -1
    root.run(Camera.cleanupCommand(root.runtimeDir))
    return root.ok()
  }

  // Arm-time check: is the lens blocked? (SPEC.md §4)
  function precheckCamera() {
    if (!root.config.camera.enabled || root.config.camera.warnOnArm === false) {
      root.cameraPrecheck = "unknown"
      return root.ok()
    }
    root.cameraPrecheck = "checking"
    var started = root.runCamera(function(reading) {
      root.cameraPrecheck = Camera.classify(reading, root.config.camera)
    })
    if (!started) {
      root.cameraPrecheck = "unknown"
      return root.fail("the camera is busy")
    }
    return root.ok()
  }

  // One frame for the current camera step.
  function captureCamera() {
    if (root.state === "idle") return root.fail("sleep mode is not active")
    var engine = root._engine
    if (!engine || !engine.current || engine.current.type !== "camera") {
      return root.fail("the current step is not a camera step")
    }
    root.cameraStatus = "capturing"
    var started = root.runCamera(function(reading) {
      root.cameraStatus = "idle"
      // The session may have ended while the camera ran.
      if (root._engine !== engine) return
      var result = Challenge.submitCamera(root._engine, reading, root.config.camera)
      root._engine = result.state
      root.challenge = Challenge.view(root._engine)
      root.lastResult = {
        correct: result.correct === true,
        skipped: result.skipped === true,
        reason: String(result.reason || (result.correct ? "ok" : "too dark")),
        at: Date.now()
      }
      if (root._engine && root._engine.done) root.exitSession("the challenge was solved")
    })
    if (!started) {
      root.cameraStatus = "idle"
      return root.fail("the camera is busy")
    }
    return root.ok()
  }

  function emergencyExit(confirmation) {
    if (!root.config.safety || root.config.safety.emergencyExit !== true) {
      return root.fail("the emergency exit is disabled")
    }
    if (!Lockdown.emergencyAccepted(root.config.safety, confirmation)) {
      return root.fail("wrong confirmation phrase")
    }
    root.exitSession("the emergency exit was used")
    return root.ok()
  }

  // ---- leaving --------------------------------------------------------------
  function exitSession(reason) {
    if (root.state === "idle") return
    var exitAt = Date.now()
    var record = null
    if (!root.dryRun) record = History.makeRecord(root.session, exitAt, root._engine)

    root._exitReason = String(reason || "")
    root._lastChallengeDone = !!(root._engine && root._engine.done === true)
    root._state = "idle"
    root.dryRun = false
    root.session = null
    root.challenge = null
    root._engine = null
    root._resolved = null

    root.finishSession(record)
  }

  // Every way out of the mode ends here: silence the alarm, undo every change
  // through the same idempotent script the crash watchdog uses, stand the
  // watchdog down, then record and announce the session.
  function finishSession(record) {
    root.stopAlarm()
    inhibitor.running = false
    root._record = null

    root.enqueue([
      { cmd: Lockdown.restoreCommand(root.pluginDir), done: function(code) {
        if (code !== 0) console.warn("sleep-mode: the restore script exited with " + code)
      } },
      // After the restore, so the watchdog is never the only thing standing
      // between a crash and a dimmed screen.
      { cmd: Lockdown.watchdogStopCommand() }
    ])

    if (root.shell && typeof root.shell.hide === "function") root.shell.hide(root.pluginId)

    if (record) {
      var list = History.append(root.historyList, record)
      root.historyList = list
      root.run(Lockdown.writeFileCommand(root.historyPath, History.serialize(list)))
      root.run(Lockdown.toastCommand("Sleep mode", History.summary(record)))
    }
    root.finished(record)
  }

  // A shell that died mid-session leaves its restore record behind. The
  // watchdog normally handles it; this covers a disabled watchdog and a
  // plugin reload, where this service starts with no memory of the session.
  function recoverPreviousSession() {
    root.run(Lockdown.existsCommand(root.activePath), function(code) {
      if (code !== 0 || root.state !== "idle") return
      console.warn("sleep-mode: restoring the state left by a previous session")
      root.run(Lockdown.restoreCommand(root.pluginDir))
    })
  }

  // ---- status for the CLI ---------------------------------------------------
  function statusJson() {
    var out = {
      state: root.state,
      previewing: root.previewing,
      dryRun: root.dryRun,
      now: Math.round(root.now),
      ringAt: root.session ? Number(root.session.ringAt) : 0,
      remaining: root.session ? Math.max(0, Number(root.session.ringAt) - root.now) : 0,
      preset: root.session ? String(root.session.preset) : "",
      reps: root.session ? Number(root.session.reps) : 0,
      cameraPrecheck: root.cameraPrecheck,
      cameraStatus: root.cameraStatus,
      lastError: root.lastError,
      steps: []
    }
    if (root._resolved && root._resolved.steps) {
      for (var i = 0; i < root._resolved.steps.length; i++) {
        var spec = root._resolved.steps[i]
        out.steps.push({ type: String(spec.type || ""), description: Steps.describe(spec) })
      }
    }
    if (root.challenge) {
      out.progress = {
        rep: Number(root.challenge.rep || 0),
        reps: Number(root.challenge.reps || 0),
        stepIndex: Number(root.challenge.stepIndex || 0),
        stepCount: Number(root.challenge.stepCount || 0),
        completedSteps: Number(root.challenge.completedSteps || 0),
        totalSteps: Number(root.challenge.totalSteps || 0),
        errors: Number(root.challenge.errors || 0),
        done: root.challenge.done === true
      }
    } else {
      out.progress = null
    }
    return out
  }

  // ---- the CLI target --------------------------------------------------------
  // `omarchy-shell sleep-mode <method> [json]`
  IpcHandler {
    id: ipc
    target: "sleep-mode"

    function status(): string {
      return JSON.stringify(root.statusJson())
    }

    function arm(payloadJson: string): string {
      var payload = root.parsePayload(payloadJson)
      if (payload.error) return JSON.stringify(root.fail(payload.error))
      return JSON.stringify(root.arm(payload.value))
    }

    // Rejected unless every required challenge is done.
    function disarm(): string {
      var done = (root.challenge && root.challenge.done === true) || root._lastChallengeDone === true
      if (!done) return JSON.stringify(root.fail("the challenge is not finished"))
      if (root.state !== "idle") root.exitSession("disarmed")
      return JSON.stringify(root.ok())
    }

    function open(payloadJson: string): string {
      var payload = root.parsePayload(payloadJson)
      if (payload.error) return JSON.stringify(root.fail(payload.error))
      var mode = payload.value && payload.value.mode === "preview" ? "preview" : "sleep"
      return JSON.stringify(root.openOverlay(mode))
    }

    function history(): string {
      return JSON.stringify(History.recent(root.historyList, 10))
    }

    function preview(): string {
      return JSON.stringify(root.startPreview())
    }

    function previewalarm(): string {
      return JSON.stringify(root.startPreview("ringing"))
    }

    function dryrun(): string {
      return JSON.stringify(root.startDryRun({}))
    }
  }

  Component.onDestruction: {
    if (liveProc.running) liveProc.running = false
  }

  Component.onCompleted: {
    root.now = Date.now()
    configFile.reload()
    historyFile.reload()
    root.recoverPreviousSession()
  }
}
