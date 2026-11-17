'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Minimal DOM & Browser Environment to execute the real app.js
function createTestEnvironment(initialStorage = {}) {
  const storage = { ...initialStorage };
  const elements = new Map();

  function makeElement(id, tagName = 'DIV') {
    const el = {
      id,
      tagName,
      value: '',
      checked: false,
      innerHTML: '',
      textContent: '',
      style: { display: '', visibility: 'visible' },
      dataset: {},
      className: '',
      options: [],
      selectedIndex: 0,
      children: [],
      parentNode: {
        classList: { contains: () => false },
        insertBefore: () => {}
      },
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        contains(c) { return this._set.has(c); }
      },
      _listeners: {},
      addEventListener(evt, fn) {
        if (!this._listeners[evt]) this._listeners[evt] = [];
        this._listeners[evt].push(fn);
      },
      dispatchEvent(evt) {
        (this._listeners[evt.type] || []).forEach((fn) => fn(evt));
      },
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k] || ''; },
      insertBefore() {},
      appendChild(child) { this.children.push(child); child.parentNode = this; },
      querySelector() { return makeElement('stub'); },
      querySelectorAll() { return []; },
      focus() {},
      scrollIntoView() {},
      contains() { return false; },
      closest() { return null; }
    };
    return el;
  }

  const document = {
    documentElement: makeElement('html', 'HTML'),
    body: makeElement('body', 'BODY'),
    getElementById(id) {
      if (!elements.has(id)) {
        const tag = id.startsWith('filter-') ? 'SELECT' : 'DIV';
        elements.set(id, makeElement(id, tag));
      }
      return elements.get(id);
    },
    querySelector(sel) {
      return makeElement(sel);
    },
    querySelectorAll() {
      return [];
    },
    createElement(tag) {
      return makeElement('created_' + Math.random().toString(36).slice(2, 7), tag.toUpperCase());
    },
    addEventListener() {}
  };

  const localStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
  };

  const sandbox = {
    window: null,
    document,
    localStorage,
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { onLine: true },
    console,
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    requestAnimationFrame: (fn) => fn(),
    addEventListener: () => {},
    scrollTo: () => {},
    confirm: () => true,
    Event: function(type) { this.type = type; },
    Chart: undefined,
    supabase: {
      createClient: () => ({
        from: () => ({
          select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) })
        }),
        channel: () => ({ on: () => ({ subscribe: () => {} }) })
      })
    }
  };
  sandbox.window = sandbox;

  const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(appCode, sandbox);

  // Expose internal state and functions for assertions
  const helpers = vm.runInContext(`({
    state,
    ensureEnvelopes,
    getUnifiedIncomes,
    getEnvelopeTotals,
    getCategoryStats,
    categoryMap,
    getBudgetTotals,
    getPeriodLimitStats,
    getGlobalFinancialSummary,
    computePeriodEndDate,
    confirmIncomeReception,
    advancePeriodLimit,
    deleteCategory,
    deleteExpense,
    deleteIncome,
    deleteBudget,
    deletePeriodLimit,
    deleteReserve,
    renderAll,
    renderOnly,
    save
  })`, sandbox);

  return { sandbox, helpers, storage, elements };
}

console.log('==========================================================');
console.log(' EJECUTANDO SUITE INTEGRAL DE PRUEBAS DE BUDGETFLOW (1-12)');
console.log('==========================================================\n');

// Prueba de regresión: arranque con datos heredados en localStorage sin campo .id (evita TDZ de uid())
console.log('--- Prueba Previa: Arranque con estado heredado en localStorage (sin .id en categorías/sobres) ---');
const legacyEnv = createTestEnvironment({
  bf_guest_mode: 'true',
  budget_state_local: JSON.stringify({
    envelopes: [{ name: 'Sobre Heredado', baseAmount: 50000 }],
    categories: [{ name: 'Mi Categoría', color: '#ef4444' }],
    incomes: [{ name: 'Ingreso Heredado', amount: 10000 }],
    expenses: []
  })
});
assert.strictEqual(legacyEnv.helpers.state.envelopes.length, 1, 'Sobre heredado cargado con éxito');
assert.ok(legacyEnv.helpers.state.envelopes[0].id, 'Sobre heredado recibe id automáticamente');
assert.strictEqual(legacyEnv.helpers.state.categories.length, 1, 'Categoría heredada personalizada conservada');
assert.ok(legacyEnv.helpers.state.categories[0].id, 'Categoría heredada recibe id automáticamente');
console.log('PASS: Arranque con datos previos en localStorage funciona sin errores.\n');

const env = createTestEnvironment({ bf_guest_mode: 'true' });
const h = env.helpers;

// 0. Verificar Estado Inicial Completamente Vacío (Req 10)
console.log('--- Prueba 0: Estado inicial completamente vacío (sin datos ficticios ni categorías automáticas) ---');
assert.strictEqual(h.state.envelopes.length, 0, 'No debe haber sobres precargados');
assert.strictEqual(h.state.categories.length, 0, 'No debe haber categorías creadas automáticamente');
assert.strictEqual(h.state.budgets.length, 0, 'No debe haber presupuestos de ejemplo (ej. Navidad)');
assert.strictEqual(h.state.incomes.length, 0, 'No debe haber ingresos ficticios');
assert.strictEqual(h.state.expenses.length, 0, 'No debe haber gastos ficticios');
assert.strictEqual(h.state.periodLimits.length, 0, 'No debe haber límites precargados');
assert.strictEqual(h.state.reserves.length, 0, 'No debe haber reservas precargadas');
let summary = h.getGlobalFinancialSummary();
assert.strictEqual(summary.totalMoney, 0, 'Dinero total inicial debe ser 0');
assert.strictEqual(summary.availableMoney, 0, 'Dinero disponible inicial debe ser 0');
console.log('PASS: Estado inicial 100% limpio y sin datos precargados.\n');

// 1 & 2. Crear una categoría personalizada, asignarle presupuesto y establecer fecha de inicio y fecha límite
console.log('--- Prueba 1 y 2: Crear categoría personalizada con presupuesto, límite y fechas ---');
h.state.categories.push({
  id: 'cat-1',
  name: 'Alimentación',
  color: '#10b981',
  budget: 120000,
  spendingLimit: 100000,
  periodType: 'mes',
  startDate: '2026-11-01',
  endDate: '2026-11-30'
});
h.renderAll();

let catStats = h.getCategoryStats('Alimentación');
assert.strictEqual(catStats.effectiveBudget, 120000, 'Presupuesto de categoría debe ser 120,000');
assert.strictEqual(catStats.spendingLimit, 100000, 'Límite de gasto de categoría debe ser 100,000');
assert.strictEqual(catStats.startDate, '2026-11-01', 'Fecha de inicio debe ser 2026-11-01');
assert.strictEqual(catStats.endDate, '2026-11-30', 'Fecha límite debe ser 2026-11-30');
assert.strictEqual(catStats.remaining, 120000, 'Saldo restante inicial de la categoría debe ser 120,000');
console.log('PASS: Categoría creada con presupuesto, límite y rango de fechas.\n');

// 3 & 4. Registrar gastos asociados a la categoría y consultar saldo restante
console.log('--- Prueba 3 y 4: Registrar gastos asociados a una categoría y consultar saldo restante ---');
h.state.envelopes.push({
  id: 'env-main',
  name: 'Cuenta Principal',
  bank: 'BAC Credomatic',
  description: 'Gastos del mes',
  baseAmount: 300000,
  targetAmount: 500000,
  spendingLimit: 250000,
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  associatedCategories: ['Alimentación'],
  color: '#3b82f6',
  icon: 'wallet'
});

h.state.expenses.push({
  id: 'exp-1',
  envelopeId: 'env-main',
  envelope: 'Cuenta Principal',
  category: 'Alimentación',
  amount: 35000,
  desc: 'Compra semanal supermercado',
  date: '2026-11-16'
});
h.renderAll();

catStats = h.getCategoryStats('Alimentación');
assert.strictEqual(catStats.spent, 35000, 'Gastado en Alimentación debe ser 35,000');
assert.strictEqual(catStats.remaining, 85000, 'Saldo restante en Alimentación debe ser 120,000 - 35,000 = 85,000');
assert.strictEqual(catStats.limitRemaining, 65000, 'Restante respecto al límite de gasto debe ser 65,000');

let envTotals = h.getEnvelopeTotals('env-main');
assert.strictEqual(envTotals.spent, 35000, 'Gastado en el sobre debe ser 35,000');
assert.strictEqual(envTotals.available, 265000, 'Disponible en el sobre debe ser 300,000 - 35,000 = 265,000');
console.log('PASS: Gasto asociado a categoría y sobre registrado; saldos restantes verificados.\n');

// Presupuesto personalizado (Req 3)
console.log('--- Prueba Presupuesto Personalizado (Req 3): Objetivo, fechas, categorías, límite y reserva ---');
h.state.budgets.push({
  id: 'bud-1',
  name: 'Plan Alimentación Noviembre',
  description: 'Control de compras de comida',
  targetAmount: 120000,
  spendingLimit: 100000,
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  categories: ['Alimentación'],
  reservedAmount: 0,
  envelopeId: 'env-main',
  color: '#10b981'
});
h.renderAll();
let budStats = h.getBudgetTotals('bud-1');
assert.strictEqual(budStats.spent, 35000, 'Presupuesto personalizado detecta el gasto de su categoría asociada en el rango de fechas');
assert.strictEqual(budStats.remainingBudget, 85000, 'Presupuesto restante es 85,000');
console.log('PASS: Presupuesto personalizado calculado correctamente.\n');

// 5. Crear límites semanales y mensuales (y probar alertas, rollover e historial de periodos)
console.log('--- Prueba 5: Crear límites semanales y mensuales, alertas, rollover e historial ---');
h.state.periodLimits.push({
  id: 'pl-weekly',
  name: 'Límite Semanal',
  periodType: 'semana',
  amount: 40000,
  startDate: '2026-11-15',
  endDate: h.computePeriodEndDate('2026-11-15', 'semana'),
  category: '',
  envelopeId: '',
  rolloverUnused: true,
  carriedOverAmount: 0,
  alertThreshold: 80,
  history: []
});

h.state.periodLimits.push({
  id: 'pl-monthly',
  name: 'Límite Mensual',
  periodType: 'mes',
  amount: 150000,
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  category: '',
  envelopeId: '',
  rolloverUnused: false,
  carriedOverAmount: 0,
  alertThreshold: 80,
  history: []
});
h.renderAll();

let weeklyStats = h.getPeriodLimitStats('pl-weekly');
let monthlyStats = h.getPeriodLimitStats('pl-monthly');

assert.strictEqual(weeklyStats.effectiveLimit, 40000, 'Límite semanal establecido: 40,000');
assert.strictEqual(weeklyStats.spent, 35000, 'Gastado en la semana: 35,000');
assert.strictEqual(weeklyStats.remaining, 5000, 'Restante en la semana: 5,000');
assert.strictEqual(weeklyStats.rawPct, 87.5, 'Porcentaje utilizado semanal: 87.5%');
assert.strictEqual(weeklyStats.isNearLimit, true, 'Debe activar alerta preventiva (>= 80%)');

assert.strictEqual(monthlyStats.effectiveLimit, 150000, 'Límite mensual establecido: 150,000');
assert.strictEqual(monthlyStats.spent, 35000, 'Gastado en el mes: 35,000');
assert.strictEqual(monthlyStats.remaining, 115000, 'Restante en el mes: 115,000');

// Probar cierre de periodo semanal y conservación del dinero no utilizado (5,000)
h.advancePeriodLimit('pl-weekly');
weeklyStats = h.getPeriodLimitStats('pl-weekly');
assert.strictEqual(weeklyStats.history.length, 1, 'El periodo anterior debe guardarse en el historial');
assert.strictEqual(weeklyStats.history[0].spent, 35000, 'Historial registra los 35,000 gastados');
assert.strictEqual(weeklyStats.carriedOver, 5000, 'El sobrante de 5,000 debe conservarse para el nuevo periodo');
assert.strictEqual(weeklyStats.effectiveLimit, 45000, 'Nuevo límite efectivo semanal = 40,000 + 5,000 = 45,000');
console.log('PASS: Límites semanales y mensuales, alertas, historial y rollover verificados.\n');

// 6 & 7. Registrar ingresos pendientes y confirmar su recepción sin duplicaciones
console.log('--- Prueba 6 y 7: Ingresos futuros pendientes y confirmación de recepción ---');
const pendingInc = {
  id: 'inc-pending-1',
  name: 'Salario Segunda Quincena',
  amount: 200000,
  envelopeId: 'env-main',
  date: '2026-11-30',
  status: 'pendiente'
};
h.state.incomes.push(pendingInc);
h.state.sources.push(pendingInc);
h.renderAll();

summary = h.getGlobalFinancialSummary();
envTotals = h.getEnvelopeTotals('env-main');
assert.strictEqual(summary.projectedIncomesTotal, 200000, 'Ingreso pendiente debe mostrarse como proyectado (200,000)');
assert.strictEqual(envTotals.projected, 200000, 'Sobre muestra 200,000 proyectados');
assert.strictEqual(summary.totalMoney, 265000, 'Ingreso pendiente NUNCA debe sumarse al dinero total real (sigue en 265,000)');
assert.strictEqual(summary.availableMoney, 265000, 'Ingreso pendiente NUNCA debe sumarse al dinero disponible real (sigue en 265,000)');

// Confirmar recepción
h.confirmIncomeReception('inc-pending-1');
summary = h.getGlobalFinancialSummary();
envTotals = h.getEnvelopeTotals('env-main');
const unifiedIncomes = h.getUnifiedIncomes();
assert.strictEqual(unifiedIncomes.length, 1, 'No debe duplicarse el ingreso al confirmar recepción');
assert.strictEqual(unifiedIncomes[0].status, 'recibido', 'El estado del ingreso pasa a recibido');
assert.strictEqual(summary.projectedIncomesTotal, 0, 'Ingresos proyectados bajan a 0');
assert.strictEqual(summary.totalMoney, 465000, 'Dinero total sube a 265,000 + 200,000 = 465,000');
assert.strictEqual(summary.availableMoney, 465000, 'Dinero disponible sube a 465,000');
console.log('PASS: Ingresos pendientes proyectados y confirmación sin duplicación verificados.\n');

// 8 & 9. Reservar dinero para un propósito específico, consultar disponible real, utilizar y liberar reserva
console.log('--- Prueba 8 y 9: Reservar dinero, consultar disponible real, utilizar y liberar reserva ---');
h.state.reserves.push({
  id: 'res-1',
  name: 'Marchamo y Seguro',
  initialAmount: 65000,
  amount: 65000,
  usedAmount: 0,
  releasedAmount: 0,
  envelopeId: 'env-main',
  budgetId: '',
  category: '',
  date: '2026-11-16',
  usages: []
});
h.renderAll();

summary = h.getGlobalFinancialSummary();
envTotals = h.getEnvelopeTotals('env-main');
assert.strictEqual(summary.totalMoney, 465000, 'Dinero total sigue siendo 465,000');
assert.strictEqual(summary.totalReserved, 65000, 'Dinero reservado es 65,000');
assert.strictEqual(summary.availableMoney, 400000, 'Dinero realmente disponible es 465,000 - 65,000 = 400,000');
assert.strictEqual(envTotals.available, 400000, 'Disponible libre en el sobre es 400,000');

// Utilizar 25,000 de la reserva
const reserveObj = h.state.reserves[0];
const useAmt = 25000;
h.state.expenses.push({
  id: 'exp-res-1',
  envelopeId: 'env-main',
  envelope: 'Cuenta Principal',
  reserveId: 'res-1',
  amount: useAmt,
  desc: 'Pago parcial seguro',
  date: '2026-11-16'
});
reserveObj.amount -= useAmt;
reserveObj.usedAmount += useAmt;
h.renderAll();

summary = h.getGlobalFinancialSummary();
assert.strictEqual(reserveObj.amount, 40000, 'Saldo reservado baja de 65,000 a 40,000');
assert.strictEqual(summary.totalMoney, 440000, 'Dinero total baja de 465,000 a 440,000 tras el gasto');
assert.strictEqual(summary.availableMoney, 400000, 'Dinero libre disponible se mantiene en 400,000 (porque se pagó con la reserva)');

// Liberar 10,000 de la reserva de vuelta al disponible
reserveObj.amount -= 10000;
reserveObj.releasedAmount += 10000;
h.renderAll();

summary = h.getGlobalFinancialSummary();
assert.strictEqual(reserveObj.amount, 30000, 'Saldo reservado queda en 30,000');
assert.strictEqual(summary.availableMoney, 410000, 'Dinero libre disponible sube de 400,000 a 410,000 al liberar 10,000');
console.log('PASS: Reserva creada, utilizada y liberada reflejándose con exactitud en el saldo disponible.\n');

// 10, 11 & 12. Sincronización, persistencia tras recargar la aplicación, y compatibilidad con funciones previas
console.log('--- Prueba 10, 11 y 12: Persistencia al recargar y compatibilidad completa ---');
assert.ok(env.storage.budget_state_local, 'El estado debe haberse guardado en localStorage');

// Simular recarga completa de la aplicación en una nueva instancia con el mismo localStorage
const reloadedEnv = createTestEnvironment(env.storage);
const rh = reloadedEnv.helpers;

assert.strictEqual(rh.state.envelopes.length, 1, 'Sobre persiste tras recargar');
assert.strictEqual(rh.state.categories.length, 1, 'Categoría persiste tras recargar');
assert.strictEqual(rh.state.budgets.length, 1, 'Presupuesto personalizado persiste tras recargar');
assert.strictEqual(rh.state.periodLimits.length, 2, 'Límites por periodo persisten tras recargar');
assert.strictEqual(rh.state.reserves.length, 1, 'Reserva persiste tras recargar');
assert.strictEqual(rh.state.incomes.length, 1, 'Ingreso persiste tras recargar sin duplicarse');
assert.strictEqual(rh.state.expenses.length, 2, 'Gastos persisten tras recargar');

const reloadedSummary = rh.getGlobalFinancialSummary();
assert.strictEqual(reloadedSummary.totalMoney, 440000, 'Dinero total tras recargar es exactamente 440,000');
assert.strictEqual(reloadedSummary.totalReserved, 30000, 'Dinero reservado tras recargar es exactamente 30,000');
assert.strictEqual(reloadedSummary.availableMoney, 410000, 'Dinero disponible tras recargar es exactamente 410,000');

// Probar eliminación segura de categoría (conserva los gastos existentes)
rh.deleteCategory('Alimentación');
assert.strictEqual(rh.state.categories.length, 0, 'Categoría eliminada');
assert.strictEqual(rh.state.expenses.length, 2, 'Los gastos NO se pierden al eliminar la categoría');
assert.strictEqual(rh.state.expenses[0].category, '', 'El gasto queda desvinculado de la categoría de forma segura');

// Probar apertura y renderizado de todos los modales y pestañas sin errores
reloadedEnv.sandbox.openCreateEnvelopeModal();
reloadedEnv.sandbox.openEditEnvelopeModal('env-main');
reloadedEnv.sandbox.openBudgetModal();
reloadedEnv.sandbox.openBudgetModal('bud-1');
reloadedEnv.sandbox.openCategoryModal();
reloadedEnv.sandbox.openPeriodLimitModal();
reloadedEnv.sandbox.openPeriodLimitModal('pl-weekly');
reloadedEnv.sandbox.openReserveModal();
reloadedEnv.sandbox.openReserveModal('res-1');
reloadedEnv.sandbox.openUseReserveModal('res-1');
reloadedEnv.sandbox.openReleaseReserveModal('res-1');
reloadedEnv.sandbox.openIncomeModal();
reloadedEnv.sandbox.openExpenseModal();
reloadedEnv.sandbox.openEnvelopeDetail('env-main');

console.log('PASS: Persistencia tras recarga, eliminación segura y renderizado de todos los modales/pestañas verificados al 100%.\n');
console.log('==========================================================');
console.log(' ¡TODAS LAS 12 PRUEBAS REQUERIDAS PASARON EXITOSAMENTE!');
console.log('==========================================================');
