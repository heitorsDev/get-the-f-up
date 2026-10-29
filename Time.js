.pragma library

// Ring-time parsing and every clock/countdown string the plugin shows.
// Pure: all inputs and outputs are epoch milliseconds or strings. Local time.

var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function pad2(n) {
  return n < 10 ? "0" + n : String(n)
}

function trim(s) {
  return String(s).replace(/^\s+|\s+$/g, "")
}

// "07:30" | "7:30" | "19:05" | "7:30pm" | "7:30 AM" -> { h, m } or null
function parseClock(text) {
  var m = /^(\d{1,2}):(\d{2})\s*([aApP][mM])?$/.exec(trim(text))
  if (!m) return null
  var h = Number(m[1])
  var min = Number(m[2])
  if (min > 59) return null
  if (m[3]) {
    if (h < 1 || h > 12) return null
    var pm = m[3].toLowerCase() === "pm"
    if (h === 12) h = pm ? 12 : 0
    else if (pm) h += 12
  } else if (h > 23) {
    return null
  }
  return { h: h, m: min }
}

// "45m" | "1h30m" | "1h 30m" | "90" (minutes) | "2h" | "30s" -> ms or null
function parseDuration(value) {
  if (typeof value === "number") {
    return isFinite(value) && value > 0 ? Math.round(value * 60000) : null
  }
  var text = trim(value).toLowerCase()
  if (/^\d+(\.\d+)?$/.test(text)) {
    var mins = Number(text)
    return mins > 0 ? Math.round(mins * 60000) : null
  }
  var m = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/.exec(text)
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null
  var ms = (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) * 1000
  return ms > 0 ? ms : null
}

// payload { time } or { duration } -> { ringAt, error }. A wall-clock time is
// the next future occurrence: today if still ahead, otherwise tomorrow.
function parseWhen(payload, nowMs) {
  var p = payload || {}
  var hasTime = p.time !== undefined && p.time !== null && trim(p.time) !== ""
  var hasDuration = p.duration !== undefined && p.duration !== null && trim(p.duration) !== ""
  if (hasTime && hasDuration) return { ringAt: null, error: "give either a time or a duration, not both" }
  if (!hasTime && !hasDuration) return { ringAt: null, error: "missing time or duration" }

  if (hasDuration) {
    var ms = parseDuration(p.duration)
    if (ms === null) return { ringAt: null, error: "invalid duration \"" + p.duration + "\" (try 45m, 1h30m, 90)" }
    return { ringAt: nowMs + ms, error: "" }
  }

  var clock = parseClock(p.time)
  if (clock === null) return { ringAt: null, error: "invalid time \"" + p.time + "\" (try 07:30)" }
  var d = new Date(nowMs)
  d.setHours(clock.h, clock.m, 0, 0)
  if (d.getTime() <= nowMs) {
    d.setDate(d.getDate() + 1)
    d.setHours(clock.h, clock.m, 0, 0)
  }
  return { ringAt: d.getTime(), error: "" }
}

// "07:14:22"; opts { h24 = true, seconds = true }; 12h -> "7:14:22 AM"
function formatClock(ms, opts) {
  var o = opts || {}
  var h24 = o.h24 !== false
  var seconds = o.seconds !== false
  var d = new Date(ms)
  var h = d.getHours()
  var out
  if (h24) {
    out = pad2(h) + ":" + pad2(d.getMinutes())
  } else {
    var h12 = h % 12 === 0 ? 12 : h % 12
    out = h12 + ":" + pad2(d.getMinutes())
  }
  if (seconds) out += ":" + pad2(d.getSeconds())
  if (!h24) out += h < 12 ? " AM" : " PM"
  return out
}

// "Thu 29 Oct"
function formatDate(ms) {
  var d = new Date(ms)
  return DAYS[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()]
}

// Splits ms into whole h/m/s. Remaining time rounds seconds up so a countdown
// never reads "0s" while time is left; elapsed time rounds down.
function parts(ms, roundUp) {
  var v = isFinite(ms) && ms > 0 ? ms : 0
  var total = roundUp ? Math.ceil(v / 1000) : Math.floor(v / 1000)
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60, total: total }
}

function hm(p, sep) {
  if (p.h > 0) return p.h + "h" + sep + p.m + "m"
  if (p.m > 0) return p.m + "m"
  return p.s + "s"
}

// "6h 15m" | "15m" | "42s"
function formatCountdown(remainingMs) {
  return hm(parts(remainingMs, true), " ")
}

// "6h18m" | "15m" | "42s"
function formatCompact(remainingMs) {
  return hm(parts(remainingMs, true), "")
}

// "+42s" | "+3m 12s" | "+1h 4m"
function formatElapsed(elapsedMs) {
  var p = parts(elapsedMs, false)
  if (p.h > 0) return "+" + p.h + "h " + p.m + "m"
  if (p.m > 0) return "+" + p.m + "m " + p.s + "s"
  return "+" + p.s + "s"
}

// "6h 12m" | "12m" | "42s"
function formatDuration(ms) {
  return hm(parts(ms, false), " ")
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseClock: parseClock,
    parseDuration: parseDuration,
    parseWhen: parseWhen,
    formatClock: formatClock,
    formatDate: formatDate,
    formatCountdown: formatCountdown,
    formatCompact: formatCompact,
    formatElapsed: formatElapsed,
    formatDuration: formatDuration
  }
}
