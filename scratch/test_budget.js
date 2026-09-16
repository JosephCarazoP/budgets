const assert = require('assert');

// Mock localStorage and window DOM stubs
const localStorageData = {};
global.localStorage = {
  getItem: (k) => localStorageData[k] || null,
  setItem: (k, v) => { localStorageData[k] = v; },
  removeItem: (k) => { delete localStorageData[k]; }
};

global.window = {};

// Test helper uid
function uid() {
  return 'id_' + Math.random().toString(36).substring(2, 9);
}

// Logic replication test
function getEnvelopeTotals(env, state) {
  const base = Number(env.baseAmount ?? env.initialAmount ?? env.amount ?? 0);
  const allIncomes = [...(state.incomes || [])];
  if (Array.isArray(state.sources)) {
    state.sources.forEach(s => {
      if (!allIncomes.some(i => i.id === s.id)) allIncomes.push(s);
    });
  }

  const envIncomes = allIncomes
    .filter((i) => (i.envelopeId === env.id || i.envelope === env.name) && (i.status === 'recibido' || !i.status))
    .reduce((sum, i) => sum + Number(i.amount || 0), 0);

  const spent = (state.expenses || [])
    .filter((e) => e.envelopeId === env.id || e.envelope === env.name)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const totalFunds = base + envIncomes;
  const available = totalFunds - spent;
  const pctSpent = totalFunds > 0 ? Math.min(100, Math.max(0, (spent / totalFunds) * 100)) : 0;

  return { base, incomes: envIncomes, spent, available, totalFunds, pctSpent };
}

console.log('--- TEST 1: Initial Envelope State & Totals ---');
const testState = {
  envelopes: [
    { id: 'env-1', name: 'Pista de Vida', bank: 'BAC', description: 'Gastos fijos', baseAmount: 500000, color: '#3b82f6' },
    { id: 'env-2', name: 'Ahorro', bank: 'BNCR', description: 'Fondo intocable', baseAmount: 200000, color: '#10b981' }
  ],
  incomes: [],
  expenses: []
};

let t1 = getEnvelopeTotals(testState.envelopes[0], testState);
assert.strictEqual(t1.available, 500000, 'Available should be 500,000 without movements');
assert.strictEqual(t1.spent, 0, 'Spent should be 0');
console.log('PASS: Initial totals correct');

console.log('--- TEST 2: Injections (Incomes inside Envelope) ---');
testState.incomes.push({
  id: 'inc-1',
  envelopeId: 'env-1',
  name: 'Beca INA',
  amount: 60000,
  date: '2026-09-16',
  status: 'recibido'
});

t1 = getEnvelopeTotals(testState.envelopes[0], testState);
assert.strictEqual(t1.incomes, 60000, 'Incomes should be 60,000');
assert.strictEqual(t1.available, 560000, 'Available should be 500,000 + 60,000 = 560,000');
console.log('PASS: Incomes injection calculated correctly');

console.log('--- TEST 3: Deductions (Expenses inside Envelope) ---');
testState.expenses.push({
  id: 'exp-1',
  envelopeId: 'env-1',
  desc: 'Supermercado quincenal',
  amount: 45000,
  date: '2026-09-16'
});

t1 = getEnvelopeTotals(testState.envelopes[0], testState);
assert.strictEqual(t1.spent, 45000, 'Spent should be 45,000');
assert.strictEqual(t1.available, 515000, 'Available should be 560,000 - 45,000 = 515,000');
console.log('PASS: Expenses deduction calculated correctly');

console.log('--- TEST 4: Total Wealth & Segment Distribution ---');
let t2 = getEnvelopeTotals(testState.envelopes[1], testState);
const totalWealth = t1.available + t2.available;
assert.strictEqual(totalWealth, 515000 + 200000, 'Total wealth is 715,000');

const pctEnv1 = (t1.available / totalWealth) * 100;
const pctEnv2 = (t2.available / totalWealth) * 100;
assert.strictEqual((pctEnv1 + pctEnv2).toFixed(2), '100.00', 'Percentages sum to 100%');
console.log('PASS: Total wealth and segment percentages verified');

console.log('ALL UNIT TESTS PASSED SUCCESSFULLY!');
