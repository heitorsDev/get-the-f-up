const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function load(name, deps) {
  const file = path.join(__dirname, '..', name);
  const src = fs.readFileSync(file, 'utf8').replace(/^[ \t]*\.(pragma|import)\b.*$/gm, '');
  const mod = { exports: {} };
  const names = Object.keys(deps || {});
  const fn = new Function('module', 'exports', ...names, src + '\n//# sourceURL=' + file);
  fn(mod, mod.exports, ...names.map((n) => deps[n]));
  return mod.exports;
}

const Steps = load('Steps.js');

function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Independent reading of a math prompt: tokens and a JS-evaluated value.
function readPrompt(prompt) {
  const tokens = prompt.split(' ');
  const operands = tokens.filter((_, i) => i % 2 === 0).map(Number);
  const ops = tokens.filter((_, i) => i % 2 === 1);
  const js = prompt.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  // eslint-disable-next-line no-new-func
  const value = Function('return (' + js + ')')();
  return { operands, ops, value };
}

const SYMBOLS = { '+': '+', '-': '−', x: '×', '/': '÷' };

test('TYPES', () => {
  assert.deepEqual(Steps.TYPES, ['math', 'string', 'memory', 'camera']);
});

test('parseOperators accepts ascii and unicode forms', () => {
  assert.deepEqual(Steps.parseOperators('+-x/'), ['+', '-', 'x', '/']);
  assert.deepEqual(Steps.parseOperators('+−×÷'), ['+', '-', 'x', '/']);
  assert.deepEqual(Steps.parseOperators('*xX'), ['x']);
  assert.deepEqual(Steps.parseOperators(''), ['+']);
  assert.deepEqual(Steps.parseOperators(undefined), ['+', '-']);
});

test('evaluate honours precedence', () => {
  assert.equal(Steps.evaluate([7, 8, 3], ['x', '+']), 59);
  assert.equal(Steps.evaluate([3, 7, 8], ['+', 'x']), 59);
  assert.equal(Steps.evaluate([20, 12, 4, 2], ['-', '/', 'x']), 14);
  assert.equal(Steps.evaluate([10, 4, 3], ['-', '-']), 3);
});

for (const tier of ['easy', 'medium', 'hard']) {
  for (const operators of ['+', '-', 'x', '/', '+-', '+-x', '+-x/', 'x/']) {
    test(`math ${tier} ${operators}: well-formed, integer, consistent`, () => {
      const count = { easy: 2, medium: 3, hard: 4 }[tier];
      const allowed = Steps.parseOperators(operators).map((o) => SYMBOLS[o]);
      const range = tier === 'hard' ? 40 : 20;
      for (let seed = 1; seed <= 300; seed++) {
        const inst = Steps.generate({ type: 'math', operators, maxOperand: 20, tier }, seeded(seed));
        assert.equal(inst.type, 'math');
        const p = readPrompt(inst.prompt);
        assert.equal(p.operands.length, count, inst.prompt);
        assert.ok(p.ops.every((o) => allowed.includes(o)), inst.prompt);
        assert.ok(p.operands.every((n) => Number.isInteger(n) && n >= 1), inst.prompt);
        assert.ok(Number.isInteger(p.value), 'integer result: ' + inst.prompt);
        assert.equal(inst.expected, String(p.value), inst.prompt);
        // every operand outside a division dividend stays in range
        p.operands.forEach((n, i) => {
          const isDividend = p.ops[i] === '÷';
          if (!isDividend) assert.ok(n <= range, `operand ${n} in ${inst.prompt}`);
        });
        // divisions divide evenly, left to right inside each chain
        let acc = p.operands[0];
        p.ops.forEach((op, i) => {
          const b = p.operands[i + 1];
          if (op === '×') acc *= b;
          else if (op === '÷') {
            assert.equal(acc % b, 0, 'even division: ' + inst.prompt);
            acc /= b;
          } else acc = b;
        });
        if (tier === 'easy') assert.ok(p.value >= 0, 'easy non-negative: ' + inst.prompt);
        assert.ok(Steps.check(inst, inst.expected));
      }
    });
  }
}

test('math: every operator shows up when allowed', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const p = readPrompt(Steps.generate({ type: 'math', operators: '+-x/', tier: 'medium' }, seeded(seed)).prompt);
    p.ops.forEach((o) => seen.add(o));
  }
  assert.deepEqual([...seen].sort(), ['+', '×', '÷', '−'].sort());
});

test('math: defaults when spec is sparse (pool entries have no tier)', () => {
  const inst = Steps.generate({ type: 'math' }, seeded(3));
  assert.equal(readPrompt(inst.prompt).operands.length, 2);
});

test('math: a fixed rng gives the contract example shape', () => {
  // rng sequence: op pick, operand a, op pick, operand b ... just check determinism
  const a = Steps.generate({ type: 'math', operators: '+-x' }, seeded(42));
  const b = Steps.generate({ type: 'math', operators: '+-x' }, seeded(42));
  assert.deepEqual(a, b);
  assert.match(a.prompt, /^\d+ [+−×] \d+$/);
  assert.match(a.expected, /^\d+$/);
});

test('math: check accepts trimmed and decimal-zero answers', () => {
  const inst = { type: 'math', prompt: '7 × 8 + 3', expected: '59', decimals: 0 };
  for (const ok of ['59', ' 59 ', '59.0', '59.', '+59', '059']) assert.equal(Steps.check(inst, ok), true, ok);
  for (const bad of ['58', '59.1', '', 'fifty', '5 9', '59a', null, undefined]) {
    assert.equal(Steps.check(inst, bad), false, String(bad));
  }
  const neg = { type: 'math', expected: '-3', decimals: 0 };
  assert.equal(Steps.check(neg, '-3'), true);
  assert.equal(Steps.check(neg, '−3'), true);
  assert.equal(Steps.check(neg, '3'), false);
});

test('math: decimals', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const inst = Steps.generate({ type: 'math', operators: '+-x/', decimals: 1, tier: 'medium' }, seeded(seed));
    assert.equal(inst.decimals, 1);
    const p = readPrompt(inst.prompt);
    assert.ok(Math.abs(Number(inst.expected) - p.value) <= 0.05 + 1e-9, inst.prompt + ' = ' + inst.expected);
    inst.prompt.split(' ').forEach((tok, i, all) => {
      if (i % 2 === 1) return;
      const whole = all[i - 1] === '×' || all[i - 1] === '÷';
      assert.match(tok, whole ? /^\d+$/ : /^\d+\.\d$/, inst.prompt);
    });
    assert.ok(Steps.check(inst, inst.expected));
    assert.ok(Steps.check(inst, Number(inst.expected).toFixed(1)));
  }
  const inst = { type: 'math', expected: '2.4', decimals: 1 };
  assert.equal(Steps.check(inst, '2.4'), true);
  assert.equal(Steps.check(inst, '2,4'), true);
  assert.equal(Steps.check(inst, '2.43'), true);
  assert.equal(Steps.check(inst, '2.5'), false);
  assert.equal(Steps.generate({ type: 'math', decimals: true }, seeded(1)).decimals, 1);
});

test('string: length, charset, ambiguity filter', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const inst = Steps.generate({ type: 'string', charset: 'alnum', length: 8 }, seeded(seed));
    assert.equal(inst.type, 'string');
    assert.equal(inst.prompt, inst.expected);
    assert.match(inst.prompt, /^[A-Za-z0-9]{8}$/);
    assert.doesNotMatch(inst.prompt, /[0O1lI]/);
  }
  assert.match(Steps.generate({ type: 'string', charset: 'digits', length: 12 }, seeded(1)).prompt, /^[2-9]{12}$/);
  assert.match(Steps.generate({ type: 'string', charset: 'lower', length: 5 }, seeded(1)).prompt, /^[a-z]{5}$/);
  assert.match(Steps.generate({ type: 'string', charset: 'abc', length: 6 }, seeded(1)).prompt, /^[abc]{6}$/);
  assert.equal(Steps.generate({ type: 'string' }, seeded(1)).prompt.length, 8);
  const sym = Array.from({ length: 40 }, (_, s) => Steps.generate({ type: 'string', charset: 'symbols', length: 16 }, seeded(s + 1)).prompt).join('');
  assert.match(sym, /[!@#$%^&*\-_=+?]/);
  const all = Array.from({ length: 40 }, (_, s) => Steps.generate({ type: 'string', charset: 'digits', length: 16, avoidAmbiguous: false }, seeded(s + 1)).prompt).join('');
  assert.match(all, /[01]/);
});

test('string: compare is exact and case-sensitive after trimming', () => {
  const inst = { type: 'string', prompt: 'k3Qz9pLm', expected: 'k3Qz9pLm' };
  assert.equal(Steps.check(inst, 'k3Qz9pLm'), true);
  assert.equal(Steps.check(inst, '  k3Qz9pLm\n'), true);
  assert.equal(Steps.check(inst, 'k3qz9plm'), false);
  assert.equal(Steps.check(inst, 'k3Qz9pL'), false);
  assert.equal(Steps.check(inst, 'k3Qz 9pLm'), false);
});

test('memory: sequence, prompt, expected, flash time', () => {
  const inst = Steps.generate({ type: 'memory', length: 4 }, seeded(9));
  assert.equal(inst.type, 'memory');
  assert.equal(inst.sequence.length, 4);
  assert.ok(inst.sequence.every((d) => Number.isInteger(d) && d >= 0 && d <= 9));
  assert.equal(inst.prompt, inst.sequence.join(' '));
  assert.equal(inst.expected, inst.sequence.join(''));
  assert.equal(inst.flashMs, 3000);
  assert.equal(Steps.generate({ type: 'memory', length: 8 }, seeded(1)).flashMs, 4800);
  assert.equal(Steps.generate({ type: 'memory', flashMs: 1500 }, seeded(1)).flashMs, 1500);
  assert.equal(Steps.generate({ type: 'memory' }, seeded(1)).sequence.length, 4);
});

test('memory: check ignores separators but not order', () => {
  const inst = { type: 'memory', sequence: [3, 1, 4, 1], prompt: '3 1 4 1', expected: '3141', flashMs: 3000 };
  for (const ok of ['3141', '3 1 4 1', '3,1,4,1', ' 3-1-4-1 ']) assert.equal(Steps.check(inst, ok), true, ok);
  for (const bad of ['1413', '314', '31415', '']) assert.equal(Steps.check(inst, bad), false, bad);
});

test('camera: instance carries the threshold and is never check()ed', () => {
  assert.deepEqual(Steps.generate({ type: 'camera' }, seeded(1)), { type: 'camera', threshold: 60 });
  assert.deepEqual(Steps.generate({ type: 'camera', threshold: 90 }), { type: 'camera', threshold: 90 });
  assert.equal(Steps.check({ type: 'camera', threshold: 60 }, '60'), false);
});

test('generate: unknown type throws; rng defaults to Math.random', () => {
  assert.throws(() => Steps.generate({ type: 'dance' }), /unknown step type/);
  assert.equal(Steps.generate({ type: 'string', length: 3 }).prompt.length, 3);
  assert.equal(Steps.check(null, 'x'), false);
});

test('generated instances are plain JSON', () => {
  for (const spec of [{ type: 'math' }, { type: 'string' }, { type: 'memory' }, { type: 'camera' }]) {
    const inst = Steps.generate(spec, seeded(5));
    assert.deepEqual(JSON.parse(JSON.stringify(inst)), inst);
  }
});

test('describe', () => {
  assert.equal(Steps.describe({ type: 'math', operators: '+-x', maxOperand: 20, tier: 'easy' }), 'math · + − × · up to 20 · easy');
  assert.equal(Steps.describe({ type: 'math', operators: '+/', maxOperand: 50, tier: 'hard', decimals: 2 }), 'math · + ÷ · up to 50 · hard · 2 decimals');
  assert.equal(Steps.describe({ type: 'math' }), 'math · + − · up to 20 · easy');
  assert.equal(Steps.describe({ type: 'string', charset: 'alnum', length: 8 }), 'string · alnum · 8 chars');
  assert.equal(Steps.describe({ type: 'string', charset: 'xyz' }), 'string · custom · 8 chars');
  assert.equal(Steps.describe({ type: 'memory', length: 6 }), 'memory · 6 digits');
  assert.equal(Steps.describe({ type: 'camera' }), 'camera · light on');
  assert.equal(Steps.describe({ type: 'camera', threshold: 70 }), 'camera · light ≥ 70');
});

test('sample returns a generated instance', () => {
  const s = Steps.sample({ type: 'math', operators: 'x' }, seeded(2));
  assert.equal(s.type, 'math');
  assert.match(s.prompt, /×/);
});
