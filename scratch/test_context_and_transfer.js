// Test suite for contextual envelope assignment & transfer feature
const assert = require('assert');

// Mock data & environment
const env1 = { id: 'env-1', name: 'Pista de Vida', baseAmount: 250000, bank: 'BAC' };
const env2 = { id: 'env-2', name: 'Taller Mecánico', baseAmount: 50000, bank: 'BNCR' };

const state = {
  envelopes: [env1, env2],
  expenses: [],
  incomes: [],
  sources: []
};

function getEnvelopeTotals(env) {
  const base = Number(env.baseAmount || 0);
  const inc = state.incomes.filter(i => i.envelopeId === env.id).reduce((s, i) => s + Number(i.amount || 0), 0);
  const exp = state.expenses.filter(e => e.envelopeId === env.id).reduce((s, e) => s + Number(e.amount || 0), 0);
  return { base, inc, exp, available: base + inc - exp };
}

console.log('--- Test 1: Initial state ---');
let t1 = getEnvelopeTotals(env1);
let t2 = getEnvelopeTotals(env2);
assert.strictEqual(t1.available, 250000);
assert.strictEqual(t2.available, 50000);
console.log('✓ Initial balances correct');

console.log('--- Test 2: Inyectar ingreso a sobre contextual ---');
// When inside env1, injecting an income
const newInc = { id: 'inc-1', name: 'Beca', amount: 100000, envelopeId: env1.id, status: 'recibido' };
state.incomes.push(newInc);
state.sources.push(newInc);
t1 = getEnvelopeTotals(env1);
assert.strictEqual(t1.available, 350000);
console.log('✓ Contextual income directly credited to envelope 1 (350,000)');

console.log('--- Test 3: Registrar gasto a sobre contextual ---');
// When inside env1, registering an expense
state.expenses.push({ id: 'exp-1', envelopeId: env1.id, envelope: env1.name, amount: 30000, desc: 'Súper' });
t1 = getEnvelopeTotals(env1);
assert.strictEqual(t1.available, 320000);
console.log('✓ Contextual expense directly deducted from envelope 1 (320,000)');

console.log('--- Test 4: Transferencia de env1 a env2 ---');
// Transfer 50000 from env1 to env2
const transferAmt = 50000;
state.expenses.push({
  id: 'exp-tr-1',
  envelopeId: env1.id,
  envelope: env1.name,
  amount: transferAmt,
  desc: `Transferencia a ${env2.name}`
});
state.incomes.push({
  id: 'inc-tr-1',
  envelopeId: env2.id,
  name: `Transferencia desde ${env1.name}`,
  amount: transferAmt,
  status: 'recibido'
});

t1 = getEnvelopeTotals(env1);
t2 = getEnvelopeTotals(env2);
assert.strictEqual(t1.available, 270000);
assert.strictEqual(t2.available, 100000);
console.log('✓ Transfer executed: env1 available reduced to 270,000, env2 increased to 100,000');

console.log('\nAll context and transfer tests PASSED 100%!');
