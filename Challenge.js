.pragma library
.import "Steps.js" as Steps

// The challenge engine: preset resolution, shuffle-from-pool, step sequencing
// and retry semantics. State is a plain JSON object; every function returns a
// new state and never mutates its input. See SPEC.md §4.
//
// - AND over steps; `reps` (N) whole passes are required.
// - A wrong answer keeps all progress; a failed math step re-randomizes.
// - A skipped camera step (unusable / blocked / demoted) counts as passed.
// - A shuffled preset re-draws its steps for every rep.

var FALLBACK_STEP = { type: "math", operators: "+-", maxOperand: 20, tier: "easy" }
var DEFAULT_CAMERA = { lightThreshold: 60, nearBlackCutoff: 24, autoSkipAfterFailures: 3, varianceEpsilon: 1 }

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v))
}

function pickRng(rng) {
  return typeof rng === "function" ? rng : Math.random
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

function isNumber(v) {
  return typeof v === "number" && isFinite(v)
}

function validSpec(spec) {
  return isPlainObject(spec) && Steps.TYPES.indexOf(spec.type) >= 0
}

function cameraEnabled(config) {
  return !(config && config.camera && config.camera.enabled === false)
}

// Camera steps carry the session's light threshold unless they set their own.
function stamp(spec, config) {
  var out = clone(spec)
  if (out.type === "camera" && !isNumber(out.threshold) && config && config.camera && isNumber(config.camera.lightThreshold)) {
    out.threshold = config.camera.lightThreshold
  }
  return out
}

function buildPool(config) {
  var raw = config && config.challenge && isPlainObject(config.challenge.pool) ? config.challenge.pool : {}
  var allowCamera = cameraEnabled(config)
  var pool = []
  for (var type in raw) {
    if (!raw.hasOwnProperty(type) || Steps.TYPES.indexOf(type) < 0 || !isPlainObject(raw[type])) continue
    if (type === "camera" && !allowCamera) continue
    var weight = raw[type].hasOwnProperty("weight") ? raw[type].weight : 1
    if (!isNumber(weight) || weight <= 0) continue
    var spec = clone(raw[type])
    delete spec.weight
    spec.type = type
    pool.push({ weight: weight, spec: stamp(spec, config) })
  }
  return pool
}

function drawOne(pool, rng) {
  var total = 0
  for (var i = 0; i < pool.length; i++) total += pool[i].weight
  var x = rng() * total
  for (var j = 0; j < pool.length; j++) {
    x -= pool[j].weight
    if (x < 0) return clone(pool[j].spec)
  }
  return clone(pool[pool.length - 1].spec)
}

function draw(pool, count, rng) {
  var out = []
  for (var i = 0; i < count; i++) out.push(drawOne(pool, rng))
  return out
}

// name "default" / "" / null -> config.challenge.defaultPreset. Unknown -> null.
// Shuffled presets draw len(steps) specs from the pool by weight and carry the
// pool so later reps can re-draw. Camera steps are dropped when the camera is
// disabled; an empty result falls back to one easy math step.
function resolvePreset(config, name, rng) {
  var r = pickRng(rng)
  var challenge = config && config.challenge ? config.challenge : {}
  var presets = isPlainObject(challenge.presets) ? challenge.presets : {}
  var n = !name || name === "default" ? challenge.defaultPreset : String(name)
  if (!presets.hasOwnProperty(n) || !isPlainObject(presets[n])) return null
  var preset = presets[n]
  var authored = Array.isArray(preset.steps) ? preset.steps : []
  var allowCamera = cameraEnabled(config)

  if (preset.shuffle === true) {
    var pool = buildPool(config)
    if (pool.length === 0) pool = [{ weight: 1, spec: clone(FALLBACK_STEP) }]
    var count = Math.max(1, authored.length)
    return { name: n, steps: draw(pool, count, r), shuffled: true, pool: pool, drawCount: count }
  }

  var steps = []
  for (var i = 0; i < authored.length; i++) {
    if (!validSpec(authored[i])) continue
    if (authored[i].type === "camera" && !allowCamera) continue
    steps.push(stamp(authored[i], config))
  }
  if (steps.length === 0) steps.push(clone(FALLBACK_STEP))
  return { name: n, steps: steps, shuffled: false }
}

function heaviest(pool) {
  var best = pool[0]
  for (var i = 1; i < pool.length; i++) if (pool[i].weight > best.weight) best = pool[i]
  return clone(best.spec)
}

// The arm-time "remove camera step". Shuffled presets keep their step count:
// drawn camera steps become the heaviest non-camera pool entry.
function removeCameraSteps(resolved) {
  var out = clone(resolved)
  if (out.shuffled) {
    var pool = []
    for (var p = 0; p < (out.pool || []).length; p++) if (out.pool[p].spec.type !== "camera") pool.push(out.pool[p])
    if (pool.length === 0) pool = [{ weight: 1, spec: clone(FALLBACK_STEP) }]
    out.pool = pool
    for (var i = 0; i < out.steps.length; i++) if (out.steps[i].type === "camera") out.steps[i] = heaviest(pool)
    return out
  }
  var steps = []
  for (var j = 0; j < out.steps.length; j++) if (out.steps[j].type !== "camera") steps.push(out.steps[j])
  if (steps.length === 0) steps.push(clone(FALLBACK_STEP))
  out.steps = steps
  return out
}

function create(resolved, reps, rng) {
  var r = pickRng(rng)
  var steps = resolved && Array.isArray(resolved.steps) && resolved.steps.length > 0 ? clone(resolved.steps) : [clone(FALLBACK_STEP)]
  var n = isNumber(reps) ? Math.max(1, Math.floor(reps)) : 1
  var shuffled = !!(resolved && resolved.shuffled && Array.isArray(resolved.pool) && resolved.pool.length > 0)
  return {
    presetName: resolved && resolved.name ? resolved.name : "",
    shuffled: shuffled,
    pool: shuffled ? clone(resolved.pool) : null,
    steps: steps,
    reps: n,
    rep: 0,
    stepIndex: 0,
    current: Steps.generate(steps[0], r),
    errors: 0,
    completedSteps: 0,
    totalSteps: n * steps.length,
    cameraFailures: 0,
    cameraDemotions: 0,
    cameraSkips: 0,
    done: false
  }
}

// Mutates `s` (always a fresh clone): marks the current step passed and moves on.
function advance(s, rng) {
  s.completedSteps += 1
  s.cameraFailures = 0
  s.stepIndex += 1
  if (s.stepIndex >= s.steps.length) {
    s.rep += 1
    s.stepIndex = 0
    if (s.rep >= s.reps) {
      s.done = true
      s.current = null
      return s
    }
    if (s.shuffled) s.steps = draw(s.pool, s.steps.length, rng)
  }
  s.current = Steps.generate(s.steps[s.stepIndex], rng)
  return s
}

function view(state) {
  if (!state) return null
  return {
    type: state.done || !state.current ? null : state.current.type,
    instance: state.done ? null : clone(state.current),
    description: state.done ? "" : Steps.describe(state.steps[state.stepIndex]),
    rep: state.rep,
    reps: state.reps,
    stepIndex: state.stepIndex,
    stepCount: state.steps.length,
    completedSteps: state.completedSteps,
    totalSteps: state.totalSteps,
    errors: state.errors,
    cameraFailures: state.cameraFailures,
    cameraDemotions: state.cameraDemotions,
    done: state.done,
    presetName: state.presetName
  }
}

// Non-camera steps. A wrong answer keeps progress; math gets a new problem.
function submit(state, input, rng) {
  var r = pickRng(rng)
  var s = clone(state)
  if (!s || s.done || !s.current || s.current.type === "camera") return { state: s, correct: false }
  if (Steps.check(s.current, input)) return { state: advance(s, r), correct: true }
  s.errors += 1
  if (s.current.type === "math") s.current = Steps.generate(s.steps[s.stepIndex], r)
  return { state: s, correct: false }
}

// reading { luma, variance, error }. `correct` is true whenever the step was
// passed, including skips (a skipped camera step counts as passed); `reason`
// is one of "light" | "dark" | "unavailable" | "blocked" | "demoted" | "not-camera".
function submitCamera(state, reading, cameraConfig, rng) {
  var r = pickRng(rng)
  var s = clone(state)
  if (!s || s.done || !s.current || s.current.type !== "camera") {
    return { state: s, correct: false, skipped: false, reason: "not-camera" }
  }
  var cfg = cameraConfig || {}
  var cutoff = isNumber(cfg.nearBlackCutoff) ? cfg.nearBlackCutoff : DEFAULT_CAMERA.nearBlackCutoff
  var autoSkip = isNumber(cfg.autoSkipAfterFailures) ? cfg.autoSkipAfterFailures : DEFAULT_CAMERA.autoSkipAfterFailures
  var epsilon = isNumber(cfg.varianceEpsilon) ? cfg.varianceEpsilon : DEFAULT_CAMERA.varianceEpsilon
  var threshold = isNumber(s.current.threshold) ? s.current.threshold
    : (isNumber(cfg.lightThreshold) ? cfg.lightThreshold : DEFAULT_CAMERA.lightThreshold)
  var rd = reading || {}

  var skipReason = ""
  if (rd.error || !isNumber(rd.luma)) {
    skipReason = "unavailable"
  } else if (rd.luma < cutoff && (!isNumber(rd.variance) || Math.abs(rd.variance) <= epsilon)) {
    // Unknown variance is treated as flat: a stuck-black camera must never brick.
    skipReason = "blocked"
  } else if (rd.luma >= threshold) {
    return { state: advance(s, r), correct: true, skipped: false, reason: "light" }
  } else {
    s.errors += 1
    s.cameraFailures += 1
    if (autoSkip > 0 && s.cameraFailures >= autoSkip) {
      s.cameraDemotions += 1
      skipReason = "demoted"
    } else {
      return { state: s, correct: false, skipped: false, reason: "dark" }
    }
  }
  s.cameraSkips += 1
  return { state: advance(s, r), correct: true, skipped: true, reason: skipReason }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FALLBACK_STEP: FALLBACK_STEP,
    resolvePreset: resolvePreset,
    create: create,
    view: view,
    submit: submit,
    submitCamera: submitCamera,
    removeCameraSteps: removeCameraSteps
  }
}
