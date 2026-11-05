.pragma library
.import "Time.js" as Time

// Day alarms: scheduled alarms that ring without the sleep screen, for
// ~/.config/omarchy/get-the-f-up/alarms.json. Pure: data in, data out, all
// times are epoch milliseconds in local time. See SPEC.md §17.
//
// An alarm:
//   { id, title, time: "HH:MM", days: [0..6] (0 = Sunday, [] = once),
//     enabled, preset ("" = the default preset), reps,
//     anchorAt, handledAt }
//
// anchorAt is when the alarm was created or last edited; handledAt is the
// last occurrence that rang or was reported missed. The occurrence an alarm
// is waiting for is the first one after both, so editing an alarm never
// fires an occurrence that was already in the past, and an occurrence is
// never handled twice.

var VERSION = 1
var TITLE_MAX = 40
var REPS_MAX = 10
// An occurrence missed by at most this much (the machine was suspended, or
// the shell was not running) still rings; an older one is reported missed.
var LATE_WINDOW_MS = 60 * 60 * 1000
var DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

function num(v, fallback) {
  return typeof v === "number" && isFinite(v) ? v : fallback
}

function pad2(n) {
  return n < 10 ? "0" + n : String(n)
}

function trim(s) {
  return String(s === undefined || s === null ? "" : s).replace(/^\s+|\s+$/g, "")
}

function normalizeDays(days) {
  var seen = {}
  var out = []
  if (!Array.isArray(days)) return out
  for (var i = 0; i < days.length; i++) {
    var d = Number(days[i])
    if (!isFinite(d) || Math.floor(d) !== d || d < 0 || d > 6 || seen[d]) continue
    seen[d] = true
    out.push(d)
  }
  out.sort(function(a, b) { return a - b })
  return out
}

function normalizeTitle(title) {
  return trim(title).slice(0, TITLE_MAX)
}

// "7:30" -> "07:30"; null when the text is not a clock time.
function normalizeTime(text) {
  var clock = Time.parseClock(String(text === undefined || text === null ? "" : text))
  return clock ? pad2(clock.h) + ":" + pad2(clock.m) : null
}

function normalize(raw) {
  if (!isPlainObject(raw)) return null
  var time = normalizeTime(raw.time)
  if (time === null || typeof raw.id !== "string" || raw.id === "") return null
  return {
    id: raw.id,
    title: normalizeTitle(raw.title),
    time: time,
    days: normalizeDays(raw.days),
    enabled: raw.enabled !== false,
    preset: typeof raw.preset === "string" ? raw.preset : "",
    reps: Math.max(1, Math.min(REPS_MAX, Math.floor(num(raw.reps, 1)))),
    anchorAt: num(raw.anchorAt, 0),
    handledAt: num(raw.handledAt, 0)
  }
}

function parse(text) {
  var src = text === undefined || text === null ? "" : String(text)
  if (src.replace(/\s+/g, "") === "") return { alarms: [], error: "" }
  var data
  try {
    data = JSON.parse(src)
  } catch (e) {
    return { alarms: [], error: "alarms.json is not valid JSON: " + e.message }
  }
  var list = Array.isArray(data) ? data : (isPlainObject(data) && Array.isArray(data.alarms) ? data.alarms : null)
  if (list === null) return { alarms: [], error: "alarms.json must hold an \"alarms\" array" }
  var out = []
  for (var i = 0; i < list.length; i++) {
    var alarm = normalize(list[i])
    if (alarm) out.push(alarm)
  }
  return { alarms: out, error: "" }
}

function serialize(alarms) {
  return JSON.stringify({ version: VERSION, alarms: Array.isArray(alarms) ? alarms : [] }, null, 2) + "\n"
}

function defaultId(nowMs) {
  return "a" + Math.floor(nowMs).toString(36) + Math.floor(Math.random() * 1679616).toString(36)
}

// fields: { title, time, days, enabled, preset, reps } -> "" or the reason
// they cannot make an alarm.
function validate(fields) {
  var f = fields || {}
  if (normalizeTime(f.time) === null) return "invalid time \"" + trim(f.time) + "\" (try 07:30)"
  if (f.reps !== undefined && f.reps !== null) {
    var reps = Number(f.reps)
    if (!isFinite(reps) || reps < 1 || reps > REPS_MAX) return "challenges required must be from 1 to " + REPS_MAX
  }
  if (f.days !== undefined && f.days !== null && !Array.isArray(f.days)) return "days must be a list of weekdays (0 = Sunday)"
  return ""
}

// A new alarm, waiting for its first occurrence after nowMs.
function create(fields, nowMs, makeId) {
  var f = fields || {}
  var id = typeof makeId === "function" ? String(makeId(nowMs)) : defaultId(nowMs)
  return normalize({
    id: id,
    title: f.title,
    time: f.time,
    days: f.days,
    enabled: f.enabled,
    preset: f.preset,
    reps: f.reps,
    anchorAt: nowMs,
    handledAt: 0
  })
}

function indexOf(alarms, id) {
  var list = Array.isArray(alarms) ? alarms : []
  for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return i
  return -1
}

function find(alarms, id) {
  var i = indexOf(alarms, id)
  return i >= 0 ? alarms[i] : null
}

function add(alarms, alarm) {
  return (Array.isArray(alarms) ? alarms.slice() : []).concat([alarm])
}

// Edits re-anchor the alarm at nowMs: the next occurrence is the first one
// after the edit, whatever was handled before.
function update(alarms, id, fields, nowMs) {
  var list = Array.isArray(alarms) ? alarms.slice() : []
  var i = indexOf(list, id)
  if (i < 0) return list
  var prev = list[i]
  var f = fields || {}
  var next = normalize({
    id: prev.id,
    title: f.title !== undefined ? f.title : prev.title,
    time: f.time !== undefined ? f.time : prev.time,
    days: f.days !== undefined ? f.days : prev.days,
    enabled: f.enabled !== undefined ? f.enabled : prev.enabled,
    preset: f.preset !== undefined ? f.preset : prev.preset,
    reps: f.reps !== undefined ? f.reps : prev.reps,
    anchorAt: nowMs,
    handledAt: 0
  })
  if (next) list[i] = next
  return list
}

function setEnabled(alarms, id, enabled, nowMs) {
  return update(alarms, id, { enabled: enabled === true }, nowMs)
}

function remove(alarms, id) {
  var list = Array.isArray(alarms) ? alarms : []
  var out = []
  for (var i = 0; i < list.length; i++) if (list[i] && list[i].id !== id) out.push(list[i])
  return out
}

// ---------------------------------------------------------------- schedule

function clockOf(alarm) {
  return Time.parseClock(alarm && alarm.time ? alarm.time : "")
}

function onDay(alarm, date) {
  var days = alarm && Array.isArray(alarm.days) ? alarm.days : []
  return days.length === 0 || days.indexOf(date.getDay()) >= 0
}

// The alarm's time on the calendar day of `dayMs` shifted by `offset` days.
function atDay(clock, dayMs, offset) {
  var d = new Date(dayMs)
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + offset)
  d.setHours(clock.h, clock.m, 0, 0)
  return d
}

function base(alarm) {
  return Math.max(num(alarm && alarm.anchorAt, 0), num(alarm && alarm.handledAt, 0))
}

// The first occurrence strictly after afterMs, or 0.
function nextOccurrence(alarm, afterMs) {
  var clock = clockOf(alarm)
  if (!clock) return 0
  for (var offset = 0; offset <= 8; offset++) {
    var d = atDay(clock, afterMs, offset)
    if (d.getTime() > afterMs && onDay(alarm, d)) return d.getTime()
  }
  return 0
}

// The occurrence the alarm is waiting for (the first after its base), or 0
// for a disabled alarm.
function pending(alarm) {
  if (!alarm || alarm.enabled === false) return 0
  return nextOccurrence(alarm, base(alarm))
}

// The latest occurrence in (base, nowMs], or 0 when none is due yet. A
// repeating alarm that missed several occurrences is due once, for the
// latest of them.
function dueOccurrence(alarm, nowMs) {
  var first = pending(alarm)
  if (first === 0 || first > nowMs) return 0
  var once = !Array.isArray(alarm.days) || alarm.days.length === 0
  if (once) return first
  var clock = clockOf(alarm)
  var from = base(alarm)
  for (var offset = 0; offset >= -8; offset--) {
    var d = atDay(clock, nowMs, offset)
    var t = d.getTime()
    if (t <= nowMs && t > from && onDay(alarm, d)) return t
  }
  return first
}

// What to do at nowMs:
//   ring   - { id, occurrence } of the alarm to ring now (the earliest due
//            one within the late window), or null
//   missed - [{ id, occurrence }] due longer ago than the window
// Other alarms due within the window wait their turn: they ring after the
// current one, as long as they are still inside the window by then.
function check(alarms, nowMs, windowMs) {
  var list = Array.isArray(alarms) ? alarms : []
  var late = typeof windowMs === "number" && windowMs >= 0 ? windowMs : LATE_WINDOW_MS
  var ring = null
  var missed = []
  for (var i = 0; i < list.length; i++) {
    var alarm = list[i]
    var at = dueOccurrence(alarm, nowMs)
    if (at === 0) continue
    if (nowMs - at > late) {
      missed.push({ id: alarm.id, occurrence: at })
    } else if (ring === null || at < ring.occurrence) {
      ring = { id: alarm.id, occurrence: at }
    }
  }
  return { ring: ring, missed: missed }
}

// Mark an occurrence handled (rung or reported missed). A one-off alarm is
// switched off once it is handled; it stays in the list to be re-enabled.
function markHandled(alarms, id, occurrence) {
  var list = Array.isArray(alarms) ? alarms.slice() : []
  var i = indexOf(list, id)
  if (i < 0) return list
  var next = {}
  for (var key in list[i]) next[key] = list[i][key]
  next.handledAt = Math.max(num(next.handledAt, 0), occurrence)
  if (!Array.isArray(next.days) || next.days.length === 0) next.enabled = false
  list[i] = next
  return list
}

// The soonest upcoming occurrence: { alarm, at } or null.
function upcoming(alarms, nowMs) {
  var list = Array.isArray(alarms) ? alarms : []
  var best = null
  for (var i = 0; i < list.length; i++) {
    var at = pending(list[i])
    if (at === 0) continue
    if (at <= nowMs) at = nextOccurrence(list[i], nowMs)
    if (at === 0) continue
    if (best === null || at < best.at) best = { alarm: list[i], at: at }
  }
  return best
}

// ---------------------------------------------------------------- labels

function describeDays(days) {
  var d = normalizeDays(days)
  if (d.length === 0) return "once"
  if (d.length === 7) return "every day"
  if (d.join(",") === "1,2,3,4,5") return "weekdays"
  if (d.join(",") === "0,6") return "weekends"
  var names = []
  for (var i = 0; i < d.length; i++) names.push(DAY_NAMES[d[i]])
  return names.join(" ")
}

// The headline the ring screen shows for an alarm.
function displayTitle(alarm) {
  var title = alarm ? normalizeTitle(alarm.title) : ""
  return title !== "" ? title : "ALARM"
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    VERSION: VERSION,
    TITLE_MAX: TITLE_MAX,
    REPS_MAX: REPS_MAX,
    LATE_WINDOW_MS: LATE_WINDOW_MS,
    DAY_NAMES: DAY_NAMES,
    normalize: normalize,
    normalizeTime: normalizeTime,
    normalizeTitle: normalizeTitle,
    normalizeDays: normalizeDays,
    parse: parse,
    serialize: serialize,
    validate: validate,
    create: create,
    find: find,
    add: add,
    update: update,
    setEnabled: setEnabled,
    remove: remove,
    nextOccurrence: nextOccurrence,
    pending: pending,
    dueOccurrence: dueOccurrence,
    check: check,
    markHandled: markHandled,
    upcoming: upcoming,
    describeDays: describeDays,
    displayTitle: displayTitle
  }
}
