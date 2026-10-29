.pragma library

// Step generators and answer checking for math / string / memory / camera.
// A step *spec* is config ({ type: "math", operators: "+-x", ... }); an
// *instance* is a generated plain-JSON problem. Randomness is injected (rng).

var TYPES = ["math", "string", "memory", "camera"]

var OP_SYMBOL = { "+": "+", "-": "−", "x": "×", "/": "÷" }
var OP_ALIASES = {
  "+": "+",
  "-": "-", "−": "-",
  "x": "x", "X": "x", "*": "x", "×": "x",
  "/": "/", "÷": "/"
}
var TIER_OPERANDS = { easy: 2, medium: 3, hard: 4 }
// Keeps chained products from exploding past what is solvable half-asleep.
var PRODUCT_CAP = 1000

var CHARSETS = {
  alnum: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  alpha: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  hex: "0123456789abcdef",
  symbols: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*-_=+?"
}
// Glyphs that are easy to confuse at 6am; dropped from built-in charsets.
var AMBIGUOUS = "0O1lI|"

var DEFAULT_THRESHOLD = 60

function pickRng(rng) {
  return typeof rng === "function" ? rng : Math.random
}

// Integer in [min, max], robust to an rng that returns exactly 1.
function randInt(rng, min, max) {
  if (max <= min) return min
  var v = min + Math.floor(rng() * (max - min + 1))
  return v > max ? max : v
}

function intOr(value, fallback, min, max) {
  var n = typeof value === "number" && isFinite(value) ? Math.floor(value) : fallback
  if (n < min) n = min
  if (n > max) n = max
  return n
}

function trim(s) {
  return String(s === undefined || s === null ? "" : s).replace(/^\s+|\s+$/g, "")
}

// ---- math -----------------------------------------------------------------

function parseOperators(text) {
  var src = typeof text === "string" ? text : "+-"
  var out = []
  for (var i = 0; i < src.length; i++) {
    var op = OP_ALIASES[src.charAt(i)]
    if (op && out.indexOf(op) < 0) out.push(op)
  }
  return out.length > 0 ? out : ["+"]
}

function tierOf(spec) {
  return TIER_OPERANDS.hasOwnProperty(spec.tier) ? spec.tier : "easy"
}

function decimalsOf(spec) {
  if (spec.decimals === true) return 1
  return intOr(spec.decimals, 0, 0, 3)
}

function roundTo(v, places) {
  var f = Math.pow(10, places)
  return Math.round(v * f) / f
}

// Evaluates [a, op, b, op, c, ...] with × ÷ before + −.
function evaluate(operands, ops) {
  var terms = [operands[0]]
  var signs = []
  for (var i = 0; i < ops.length; i++) {
    var b = operands[i + 1]
    if (ops[i] === "x") terms[terms.length - 1] = terms[terms.length - 1] * b
    else if (ops[i] === "/") terms[terms.length - 1] = terms[terms.length - 1] / b
    else { signs.push(ops[i]); terms.push(b) }
  }
  var total = terms[0]
  for (var j = 0; j < signs.length; j++) total = signs[j] === "+" ? total + terms[j + 1] : total - terms[j + 1]
  return roundTo(total, 10)
}

function divisorsIn(v, lo, hi) {
  var out = []
  for (var d = lo; d <= hi; d++) if (v % d === 0) out.push(d)
  return out
}

function buildMath(spec, rng) {
  var tier = tierOf(spec)
  var count = TIER_OPERANDS[tier]
  var maxOperand = intOr(spec.maxOperand, 20, 2, 1000)
  var max = tier === "hard" ? maxOperand * 2 : maxOperand
  var places = decimalsOf(spec)
  var scale = Math.pow(10, places)
  var allowed = parseOperators(spec.operators)

  var ops = []
  for (var i = 0; i < count - 1; i++) ops.push(allowed[randInt(rng, 0, allowed.length - 1)])

  // Operands are built left to right; `chainStart` is the index of the first
  // operand of the current × ÷ chain, `chainValue` its running value.
  var operands = [randInt(rng, 1, max)]
  var chainStart = 0
  var chainValue = operands[0]
  for (var k = 0; k < ops.length; k++) {
    var op = ops[k]
    var b
    if (op === "x") {
      var cap = Math.max(1, Math.floor(PRODUCT_CAP / Math.max(1, Math.abs(chainValue))))
      b = randInt(rng, 1, Math.min(max, cap))
      chainValue = chainValue * b
    } else if (op === "/") {
      if (places > 0) {
        b = randInt(rng, 2, Math.max(2, Math.min(max, 12)))
        chainValue = chainValue / b
      } else if (k === chainStart) {
        // a ÷ b: pick the divisor and quotient, then rewrite the dividend.
        b = randInt(rng, 2, Math.max(2, Math.min(max, 12)))
        var q = randInt(rng, 1, Math.min(max, 12))
        operands[chainStart] = b * q
        chainValue = q
      } else {
        var divs = divisorsIn(chainValue, 2, Math.min(max, Math.abs(chainValue)))
        b = divs.length > 0 ? divs[randInt(rng, 0, divs.length - 1)] : 1
        chainValue = chainValue / b
      }
    } else {
      b = randInt(rng, 1, max)
      chainStart = k + 1
      chainValue = b
    }
    operands.push(b)
  }

  // Decimals: operands that start an additive term get `places` decimals;
  // multipliers and divisors stay whole so the arithmetic stays doable.
  if (places > 0) {
    for (var d = 0; d < operands.length; d++) {
      var startsTerm = d === 0 || ops[d - 1] === "+" || ops[d - 1] === "-"
      if (startsTerm) operands[d] = (operands[d] * scale + randInt(rng, 0, scale - 1)) / scale
    }
  }

  // Easy never goes negative: with two operands a − b becomes b − a.
  if (tier === "easy" && evaluate(operands, ops) < 0 && ops.length === 1) {
    operands = [operands[1], operands[0]]
  }

  return { operands: operands, ops: ops, places: places }
}

function formatNumber(v, places) {
  return places > 0 ? v.toFixed(places) : String(v)
}

function generateMath(spec, rng) {
  var built = buildMath(spec, rng)
  var value = evaluate(built.operands, built.ops)
  var text = formatNumber(built.operands[0], built.places)
  for (var i = 0; i < built.ops.length; i++) {
    var op = built.ops[i]
    // Multipliers and divisors are whole numbers even in decimals mode.
    var places = op === "x" || op === "/" ? 0 : built.places
    text += " " + OP_SYMBOL[op] + " " + formatNumber(built.operands[i + 1], places)
  }
  var expected = built.places > 0 ? String(roundTo(value, built.places)) : String(value)
  return { type: "math", prompt: text, expected: expected, decimals: built.places }
}

function parseAnswerNumber(input) {
  var text = trim(input).replace(/−/g, "-").replace(",", ".")
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(text)) return null
  return Number(text)
}

function checkMath(instance, input) {
  var got = parseAnswerNumber(input)
  if (got === null) return false
  var want = Number(instance.expected)
  var places = instance.decimals > 0 ? instance.decimals : 0
  if (places === 0) return got === want
  return Math.abs(got - want) <= 0.5 / Math.pow(10, places) + 1e-9
}

// ---- string ---------------------------------------------------------------

function charsetOf(spec) {
  var name = typeof spec.charset === "string" ? spec.charset : "alnum"
  if (!CHARSETS.hasOwnProperty(name)) return name.length >= 2 ? name : CHARSETS.alnum
  var chars = CHARSETS[name]
  if (spec.avoidAmbiguous === false) return chars
  var out = ""
  for (var i = 0; i < chars.length; i++) if (AMBIGUOUS.indexOf(chars.charAt(i)) < 0) out += chars.charAt(i)
  return out
}

function generateString(spec, rng) {
  var chars = charsetOf(spec)
  var length = intOr(spec.length, 8, 1, 64)
  var out = ""
  for (var i = 0; i < length; i++) out += chars.charAt(randInt(rng, 0, chars.length - 1))
  return { type: "string", prompt: out, expected: out }
}

// ---- memory ---------------------------------------------------------------

function generateMemory(spec, rng) {
  var length = intOr(spec.length, 4, 1, 20)
  var seq = []
  for (var i = 0; i < length; i++) seq.push(randInt(rng, 0, 9))
  var flashMs = typeof spec.flashMs === "number" && spec.flashMs > 0 ? spec.flashMs : Math.max(3000, length * 600)
  return { type: "memory", sequence: seq, prompt: seq.join(" "), expected: seq.join(""), flashMs: flashMs }
}

// ---- public ---------------------------------------------------------------

function generate(spec, rng) {
  var s = spec || {}
  var r = pickRng(rng)
  if (s.type === "math") return generateMath(s, r)
  if (s.type === "string") return generateString(s, r)
  if (s.type === "memory") return generateMemory(s, r)
  if (s.type === "camera") {
    var t = typeof s.threshold === "number" && isFinite(s.threshold) ? s.threshold : DEFAULT_THRESHOLD
    return { type: "camera", threshold: t }
  }
  throw new Error("unknown step type: " + s.type)
}

function check(instance, input) {
  if (!instance) return false
  if (instance.type === "math") return checkMath(instance, input)
  if (instance.type === "string") return trim(input) === instance.expected
  if (instance.type === "memory") return trim(input).replace(/[\s,.\-]+/g, "") === instance.expected
  return false
}

function describe(spec) {
  var s = spec || {}
  if (s.type === "math") {
    var ops = parseOperators(s.operators)
    var syms = []
    for (var i = 0; i < ops.length; i++) syms.push(OP_SYMBOL[ops[i]])
    var text = "math · " + syms.join(" ") + " · up to " + intOr(s.maxOperand, 20, 2, 1000) + " · " + tierOf(s)
    var places = decimalsOf(s)
    if (places > 0) text += " · " + places + (places === 1 ? " decimal" : " decimals")
    return text
  }
  if (s.type === "string") {
    var cs = typeof s.charset === "string" && CHARSETS.hasOwnProperty(s.charset) ? s.charset : (typeof s.charset === "string" && s.charset.length >= 2 ? "custom" : "alnum")
    return "string · " + cs + " · " + intOr(s.length, 8, 1, 64) + " chars"
  }
  if (s.type === "memory") return "memory · " + intOr(s.length, 4, 1, 20) + " digits"
  if (s.type === "camera") {
    return "camera · light check"
  }
  return String(s.type)
}

// One throwaway instance for the settings "preview this step" button.
function sample(spec, rng) {
  return generate(spec, rng)
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TYPES: TYPES,
    generate: generate,
    check: check,
    describe: describe,
    sample: sample,
    parseOperators: parseOperators,
    evaluate: evaluate
  }
}
