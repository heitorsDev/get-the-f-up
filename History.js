.pragma library
.import "Time.js" as Time

// Session history for ~/.local/state/omarchy/get-the-f-up/history.json.
// Pure: data in, data out. See SPEC.md §12.

var DEFAULT_MAX = 500

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

function num(v, fallback) {
  return typeof v === "number" && isFinite(v) ? v : fallback
}

function parse(text) {
  if (text === undefined || text === null) return []
  var data
  try {
    data = JSON.parse(String(text))
  } catch (e) {
    return []
  }
  if (!Array.isArray(data)) return []
  var out = []
  for (var i = 0; i < data.length; i++) if (isPlainObject(data[i])) out.push(data[i])
  return out
}

function serialize(list) {
  return JSON.stringify(Array.isArray(list) ? list : [], null, 2) + "\n"
}

// session: the service's { kind, title, armedAt, ringAt, ringingSince, preset,
// reps, dryRun }. kind is "sleep" (the sleep mode) or "alarm" (a day alarm).
// Progress comes from `challenge` (a Challenge state or view) when given,
// otherwise from the same-named fields on `session` itself.
function makeRecord(session, exitAt, challenge) {
  var s = session || {}
  var c = challenge || s.challenge || s
  var ringAt = num(s.ringAt, 0)
  var required = num(s.reps, num(c.reps, 1))
  var completed = c.done === true ? num(c.reps, required) : num(c.rep, num(s.challengesCompleted, 0))
  return {
    kind: s.kind === "alarm" ? "alarm" : "sleep",
    title: typeof s.title === "string" ? s.title : "",
    armedAt: num(s.armedAt, 0),
    ringAt: ringAt,
    exitAt: exitAt,
    preset: typeof s.preset === "string" ? s.preset : String(s.preset || ""),
    challengesRequired: required,
    challengesCompleted: completed,
    errors: num(c.errors, num(s.errors, 0)),
    cameraDemotions: num(c.cameraDemotions, num(s.cameraDemotions, 0)),
    exitedBeforeRing: exitAt < ringAt
  }
}

function append(list, record, max) {
  var limit = typeof max === "number" && max > 0 ? Math.floor(max) : DEFAULT_MAX
  var out = (Array.isArray(list) ? list : []).concat([record])
  return out.length > limit ? out.slice(out.length - limit) : out
}

// Last n records, newest first.
function recent(list, n) {
  var src = Array.isArray(list) ? list : []
  var count = typeof n === "number" && n >= 0 ? Math.floor(n) : 10
  return src.slice(Math.max(0, src.length - count)).reverse()
}

// Time asleep: from arming until the alarm, or until an earlier exit.
function sleptMs(record) {
  var r = record || {}
  var end = Math.min(num(r.exitAt, 0), num(r.ringAt, Infinity))
  return Math.max(0, end - num(r.armedAt, end))
}

function isAlarm(record) {
  return !!record && record.kind === "alarm"
}

// Sleep sessions only: a day alarm is not time asleep.
function totals(list) {
  var src = Array.isArray(list) ? list : []
  var sessions = 0
  var slept = 0
  var early = 0
  var alarms = 0
  for (var i = 0; i < src.length; i++) {
    if (isAlarm(src[i])) {
      alarms += 1
      continue
    }
    sessions += 1
    slept += sleptMs(src[i])
    if (src[i] && src[i].exitedBeforeRing === true) early += 1
  }
  return { sessions: sessions, sleptMs: slept, earlyExits: early, alarms: alarms }
}

function plural(n, word) {
  return n + " " + word + (n === 1 ? "" : "s")
}

// "Slept 6h 12m — 3 challenges, 1 error"
// "standup: dismissed after 2m — 1 challenge, 0 errors" (a day alarm; armedAt
// is when it started ringing)
function summary(record) {
  var r = record || {}
  var text
  if (isAlarm(r)) {
    var title = typeof r.title === "string" && r.title !== "" ? r.title : "Alarm"
    text = title + ": dismissed after " + Time.formatDuration(Math.max(0, num(r.exitAt, 0) - num(r.armedAt, 0)))
  } else {
    text = "Slept " + Time.formatDuration(sleptMs(r))
    if (r.exitedBeforeRing === true) text += ", up before the alarm"
  }
  text += " — " + plural(num(r.challengesCompleted, 0), "challenge") + ", " + plural(num(r.errors, 0), "error")
  var demotions = num(r.cameraDemotions, 0)
  if (demotions > 0) text += ", " + plural(demotions, "camera skip")
  return text
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_MAX: DEFAULT_MAX,
    parse: parse,
    serialize: serialize,
    makeRecord: makeRecord,
    append: append,
    recent: recent,
    sleptMs: sleptMs,
    isAlarm: isAlarm,
    totals: totals,
    summary: summary
  }
}
