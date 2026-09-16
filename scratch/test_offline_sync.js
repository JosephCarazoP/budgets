const assert = require('assert');

// 1. Mock DOM and Web APIs
const storage = {};
global.localStorage = {
  getItem: (k) => storage[k] || null,
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
};

global.sessionStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};

const eventListeners = {};
global.window = {
  addEventListener: (event, handler) => {
    if (!eventListeners[event]) eventListeners[event] = [];
    eventListeners[event].push(handler);
  },
  dispatchEvent: (event) => {
    (eventListeners[event.type] || []).forEach(fn => fn(event));
  }
};

global.document = {
  getElementById: (id) => ({
    id,
    classList: { add: () => {}, remove: () => {} },
    addEventListener: () => {},
    style: {}
  }),
  querySelector: () => ({ style: {} }),
  querySelectorAll: () => []
};

global.navigator = { onLine: false };

console.log('--- TEST: SyncManager Offline to Online Transition ---');

// Mock state
const state = {
  envelopes: [],
  sources: [],
  incomes: [],
  expenses: [],
  transfers: [],
  categories: [{ name: 'Alimentación', color: '#ef4444' }],
  assignments: []
};

let syncCalled = false;
let savedPayload = null;

global.FBAuth = {
  currentUser: { uid: 'user-test-123' },
  isConfigured: () => true,
  saveUserState: async (uid, payload) => {
    syncCalled = true;
    savedPayload = payload;
    return true;
  }
};

global.toast = (msg) => console.log('  [Toast]:', msg);

// SyncManager implementation test
const SyncManager = {
  isOnline: global.navigator.onLine,
  isSyncing: false,
  pendingChanges: false,
  _activeUser: global.FBAuth.currentUser,
  _isGuest: false,

  _getMetaKey() {
    const uid = this._activeUser?.uid || (this._isGuest ? 'guest' : 'default');
    return `bf_sync_meta_${uid}`;
  },

  markDirty() {
    this.pendingChanges = true;
    localStorage.setItem(this._getMetaKey(), JSON.stringify({ pending: true }));
  },

  async syncPending() {
    if (!this.isOnline || this.isSyncing || this._isGuest) return;
    if (!global.FBAuth || !global.FBAuth.currentUser) return;
    this.isSyncing = true;
    const ok = await global.FBAuth.saveUserState(this._activeUser.uid, state);
    if (ok) {
      this.pendingChanges = false;
      localStorage.setItem(this._getMetaKey(), JSON.stringify({ pending: false }));
      global.toast('¡Todo sincronizado con la nube!');
    }
    this.isSyncing = false;
  }
};

// 1. User performs an offline edit
console.log('1. Realizando edición offline (agregar sobre y gasto)...');
state.envelopes.push({ id: 'env-1', name: 'Comida', baseAmount: 50000 });
state.expenses.push({ id: 'exp-1', envelopeId: 'env-1', amount: 12000, description: 'Supermercado' });

// Local save simulation
localStorage.setItem('budget_state_' + SyncManager._activeUser.uid, JSON.stringify(state));
SyncManager.markDirty();

assert.strictEqual(SyncManager.pendingChanges, true, 'Debe marcarse como pendiente de sincronización');
const savedLocal = JSON.parse(localStorage.getItem('budget_state_user-test-123'));
assert.strictEqual(savedLocal.envelopes.length, 1, 'Debe guardar el sobre localmente de inmediato');
assert.strictEqual(savedLocal.expenses.length, 1, 'Debe guardar el gasto localmente de inmediato');
assert.strictEqual(syncCalled, false, 'No debe haber subido a la nube porque está offline');
console.log('  -> Edición offline guardada exitosamente en LocalStorage con pending=true.');

// 2. Internet is restored
console.log('2. Conectando a internet (evento online)...');
global.navigator.onLine = true;
SyncManager.isOnline = true;

// Trigger sync
SyncManager.syncPending().then(() => {
  assert.strictEqual(syncCalled, true, 'Debe haberse ejecutado la sincronización con la nube');
  assert.strictEqual(SyncManager.pendingChanges, false, 'No debe haber cambios pendientes tras sincronizar');
  assert.strictEqual(savedPayload.envelopes[0].name, 'Comida', 'El payload en la nube debe incluir los sobres modificados');
  assert.strictEqual(savedPayload.expenses[0].amount, 12000, 'El payload en la nube debe incluir los gastos modificados');
  console.log('  -> Sincronización completada exitosamente. Datos en la nube verificados.');
  console.log('--- TODOS LOS TESTS PASARON EXITOSAMENTE ---');
});
