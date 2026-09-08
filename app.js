'use strict';

/* ============================================================
   SUPABASE CONFIG
   Reemplazá estos dos valores con los de tu proyecto:
   Supabase Dashboard → Settings → API
   ============================================================ */

const SUPABASE_URL = 'https://jljdudxbggewxvqmxlvj.supabase.co'; 
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsamR1ZHhiZ2dld3h2cW14bHZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MDMwNjYsImV4cCI6MjA5NDI3OTA2Nn0.eJAmo8cxkOr5em89domd0NWimI17TUAfaUH0Xo4Pncc';
const STATE_ROW_ID = 'default';
window.STATE_ROW_ID = STATE_ROW_ID;

/* ============================================================
   STATE
   ============================================================ */

const DEFAULT_ENVELOPES = [];

const DEFAULT_CATEGORIES = [
  { name: 'Alimentación', color: '#ef4444' },
  { name: 'Mascotas',     color: '#f59e0b' },
  { name: 'Transporte',   color: '#10b981' },
  { name: 'Ahorro',       color: '#3b82f6' },
  { name: 'Diversión',    color: '#8b5cf6' }
];

const INITIAL = {
  envelopes: [],
  sources: [],
  incomes: [],
  expenses: [],
  transfers: [],
  categories: DEFAULT_CATEGORIES,
  assignments: [],
  theme: 'light',
  editingSourceId: null,
  editingExpenseId: null,
  editingCategoryName: null
};

const state = { ...INITIAL, ...JSON.parse(localStorage.getItem('budget_state') || '{}') };

function ensureEnvelopes() {
  if (!Array.isArray(state.envelopes)) {
    state.envelopes = [];
  }
  state.envelopes.forEach((env) => {
    if (!env.id) env.id = uid();
    if (env.baseAmount === undefined) {
      env.baseAmount = Number(env.amount ?? env.initialAmount ?? 0);
    }
  });
  if (!Array.isArray(state.incomes)) {
    state.incomes = Array.isArray(state.sources) ? state.sources : [];
  }
  if (!Array.isArray(state.transfers)) {
    state.transfers = [];
  }
}
ensureEnvelopes();

if (!state.categories?.length) state.categories = DEFAULT_CATEGORIES;
if (!Array.isArray(state.assignments)) state.assignments = [];

function rebuildDistributionsFromAssignments() {
  state.sources.forEach((s) => { s.distribution = {}; });
  state.assignments.forEach((a) => {
    const src = state.sources.find((s) => s.id === a.sourceId);
    if (!src) return;
    if (!src.distribution) src.distribution = {};
    src.distribution[a.category] = (src.distribution[a.category] || 0) + Number(a.amount || 0);
  });
  state.sources.forEach((s) => {
    Object.keys(s.distribution || {}).forEach((k) => {
      if (s.distribution[k] <= 0) delete s.distribution[k];
    });
  });
}

function reconcileAssignmentsWithDistributions() {
  if (!state.assignments.length) return false;

  let changed = false;
  state.sources.forEach((source) => {
    const distribution = source.distribution || {};
    const assignmentTotals = {};

    state.assignments
      .filter((a) => a.sourceId === source.id)
      .forEach((a) => {
        assignmentTotals[a.category] = (assignmentTotals[a.category] || 0) + Number(a.amount || 0);
      });

    const categories = new Set([...Object.keys(distribution), ...Object.keys(assignmentTotals)]);
    const hasMismatch = [...categories].some((category) => (
      Math.abs(Number(distribution[category] || 0) - Number(assignmentTotals[category] || 0)) > 0.009
    ));

    if (!hasMismatch) return;

    changed = true;
    state.assignments = state.assignments.filter((a) => a.sourceId !== source.id);
    Object.entries(distribution).forEach(([category, amount]) => {
      const numericAmount = Number(amount || 0);
      if (numericAmount > 0) {
        state.assignments.push({
          id: uid(),
          sourceId: source.id,
          category,
          amount: numericAmount,
          date: new Date().toISOString().slice(0, 10)
        });
      }
    });
  });

  if (changed) rebuildDistributionsFromAssignments();
  return changed;
}

/* ============================================================
   SUPABASE CLIENT
   ============================================================ */

const _supabaseReady = SUPABASE_URL !== 'YOUR_SUPABASE_URL' && SUPABASE_KEY !== 'YOUR_SUPABASE_ANON_KEY';
const db = _supabaseReady ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
window.db = db;

/** Carga el estado desde Supabase. Retorna true si tuvo éxito. */
async function loadFromSupabase() {
  if (!db) return false;
  try {
    const { data, error } = await db
      .from('budget_state')
      .select('data')
      .eq('id', STATE_ROW_ID)
      .single();
    if (error || !data?.data) return false;
    // Mezclar: el estado remoto gana, pero preservamos editingSourceId local
    const remote = data.data;
    Object.assign(state, remote, { editingSourceId: null });
    if (!state.categories?.length) state.categories = DEFAULT_CATEGORIES;
    if (!Array.isArray(state.assignments)) state.assignments = [];
    // Sincronizar también en localStorage como caché offline
    localStorage.setItem('budget_state', JSON.stringify(state));
    return true;
  } catch (err) {
    console.warn('BudgetFlow: no se pudo cargar desde Supabase, usando localStorage.', err);
    return false;
  }
}

/** Suscripción real-time: actualiza la UI cuando otro dispositivo guarda cambios. */
function setupRealtime() {
  if (!db) return;
  db.channel('budget-sync')
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'budget_state',
      filter: `id=eq.${STATE_ROW_ID}`
    }, (payload) => {
      const remote = payload.new?.data;
      if (!remote) return;
      // Ignorar si el update lo generó este mismo dispositivo
      if (remote._deviceId === _deviceId) return;
      Object.assign(state, remote, { editingSourceId: state.editingSourceId });
      if (!state.categories?.length) state.categories = DEFAULT_CATEGORIES;
      if (!Array.isArray(state.assignments)) state.assignments = [];
      reconcileAssignmentsWithDistributions();
      localStorage.setItem('budget_state', JSON.stringify(state));
      renderOnly();
      toast('Sincronizado con otro dispositivo');
    })
    .subscribe();
}

/* ============================================================
   UTILITIES
   ============================================================ */

const $  = (id) => document.getElementById(id);
const $$ = (sel, ctx = document) => ctx.querySelectorAll(sel);

const money = (n) => `₡${Number(n || 0).toLocaleString('es-CR', { maximumFractionDigits: 2 })}`;
const uid   = () => Math.random().toString(36).slice(2, 10);

/**
 * Convierte cualquier valor (formateado o número) a un float de JavaScript válido.
 */
function parseAmount(val) {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  let str = String(val).trim();
  
  if (str.includes('.')) {
    str = str.replace(/,/g, '');
  } else if (str.includes(',')) {
    const lastCommaIdx = str.lastIndexOf(',');
    const charsAfterComma = str.slice(lastCommaIdx + 1);
    if (charsAfterComma.length <= 2) {
      str = str.slice(0, lastCommaIdx).replace(/,/g, '') + '.' + charsAfterComma;
    } else {
      str = str.replace(/,/g, '');
    }
  }
  
  const n = parseFloat(str);
  return isNaN(n) ? 0 : n;
}

/**
 * Formatea dinámicamente una cadena a formato numérico con comas para miles y punto para decimales.
 */
function formatAmountString(rawVal) {
  if (rawVal === undefined || rawVal === null || rawVal === '') return '';
  let str = String(rawVal);

  let hasDot = str.includes('.');
  let hasComma = str.includes(',');

  let decimalStr = null;
  let mainStr = str;

  if (hasDot) {
    const parts = str.split('.');
    mainStr = parts.slice(0, -1).join('').replace(/[^\d]/g, '');
    decimalStr = parts[parts.length - 1].replace(/[^\d]/g, '').slice(0, 2);
  } else if (hasComma) {
    const lastCommaIdx = str.lastIndexOf(',');
    const charsAfterComma = str.slice(lastCommaIdx + 1);
    
    if (charsAfterComma.length !== 3 && charsAfterComma.length <= 2) {
      mainStr = str.slice(0, lastCommaIdx).replace(/[^\d]/g, '');
      decimalStr = charsAfterComma.replace(/[^\d]/g, '').slice(0, 2);
    } else {
      mainStr = str.replace(/[^\d]/g, '');
    }
  } else {
    mainStr = str.replace(/[^\d]/g, '');
  }

  if (mainStr.length > 1) {
    mainStr = mainStr.replace(/^0+/, '') || '0';
  } else if (mainStr.length === 0 && decimalStr !== null) {
    mainStr = '0';
  }

  if (!mainStr && decimalStr === null) return '';

  const formattedInteger = mainStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  if (decimalStr !== null) {
    return `${formattedInteger}.${decimalStr}`;
  }
  return formattedInteger;
}

/**
 * Aplica el formateador de montos en tiempo real a un elemento input.
 */
function attachAmountFormatter(input) {
  if (!input) return;
  
  input.type = 'text';
  input.setAttribute('inputmode', 'decimal');
  input.setAttribute('autocomplete', 'off');

  if (input.value) {
    input.value = formatAmountString(input.value);
  }

  if (input.dataset.amountFormatted) return;
  input.dataset.amountFormatted = 'true';

  input.addEventListener('input', () => {
    const selStart = input.selectionStart || 0;
    const oldVal = input.value;
    
    const rawBeforeCursor = oldVal.slice(0, selStart).replace(/[^\d.]/g, '');
    
    const newVal = formatAmountString(oldVal);
    input.value = newVal;

    let newCursor = 0;
    let rawCount = 0;
    for (let i = 0; i < newVal.length; i++) {
      if (rawCount >= rawBeforeCursor.length) break;
      if (/[\d.]/.test(newVal[i])) {
        rawCount++;
      }
      newCursor = i + 1;
    }
    
    try {
      input.setSelectionRange(newCursor, newCursor);
    } catch (_) {}
  });

  input.addEventListener('blur', () => {
    if (input.value) {
      input.value = formatAmountString(input.value);
    }
  });
}
const fmt   = (iso) => { if (!iso) return '—'; const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; };
const compareByDateDesc = (a, b) => {
  const dateA = String(a?.date || '0000-00-00');
  const dateB = String(b?.date || '0000-00-00');
  return dateB.localeCompare(dateA);
};

// ID único por pestaña/dispositivo — se regenera con cada recarga
const _deviceId = Math.random().toString(36).slice(2, 8);

/** Guarda en localStorage y en Firestore (por usuario) o Supabase (fallback). */
function save() {
  if (window.FBAuth && window.FBAuth.isConfigured() && window.FBAuth.currentUser) {
    const uid = window.FBAuth.currentUser.uid;
    localStorage.setItem('budget_state_' + uid, JSON.stringify(state));
    window.FBAuth.saveUserState(uid, { ...state, _deviceId });
    return;
  }

  localStorage.setItem('budget_state', JSON.stringify(state));
  if (!db) return;
  const payload = { ...state, _deviceId };
  db.from('budget_state')
    .update({ data: payload, updated_at: new Date().toISOString() })
    .eq('id', STATE_ROW_ID)
    .then(({ error }) => {
      if (error) console.error('BudgetFlow: error al sincronizar con Supabase:', error);
    });
}

function migrateAssignmentsIfNeeded() {
  if (state.assignments.length) return;
  state.sources.forEach((s) => {
    Object.entries(s.distribution || {}).forEach(([category, amount]) => {
      if (Number(amount) > 0) {
        state.assignments.push({ id: uid(), sourceId: s.id, category, amount: Number(amount), date: new Date().toISOString().slice(0, 10) });
      }
    });
  });
  rebuildDistributionsFromAssignments();
}

let toastTimer;
function toast(msg, duration = 2800) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

/* ============================================================
   CUSTOM SELECT ENGINE (_buildCsel, _refreshCsel, _closeAllCsels)
   ============================================================ */

const _cselMap = {};

function _cselOptHTML(value, text, opts = {}) {
  if (opts.isStatus) {
    if (value === 'recibido') {
      return `<span class="badge badge-received">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        Recibido
      </span>`;
    }
    if (value === 'pendiente') {
      return `<span class="badge badge-pending">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Pendiente
      </span>`;
    }
    return `<span class="csel-text">${text}</span>`;
  }
  if (opts.isCategory) {
    const color = state.categories.find((c) => c.name === value)?.color;
    if (color) {
      return `<span class="csel-dot" style="background:${color}"></span><span class="csel-text">${text}</span>`;
    }
  }
  return `<span class="csel-text">${text}</span>`;
}

function _buildCsel(id, opts = {}) {
  const native = $(id);
  if (!native) return;
  if (!native.parentNode) return;

  // Si ya existía un registro pero el elemento nativo fue recreado por innerHTML
  if (_cselMap[id] && _cselMap[id].native === native && native.parentNode.classList?.contains('csel')) {
    _cselMap[id].opts = opts;
    _refreshCsel(id);
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'csel';
  native.parentNode.insertBefore(wrap, native);
  wrap.appendChild(native);
  native.classList.add('csel-native');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'csel-trigger';
  wrap.appendChild(trigger);

  const list = document.createElement('div');
  list.className = 'csel-list';
  wrap.appendChild(list);

  _cselMap[id] = { native, trigger, list, opts, wrap };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = list.classList.contains('open');
    _closeAllCsels();
    if (!isOpen) {
      list.classList.add('open');
      trigger.classList.add('open');
    }
  });

  _refreshCsel(id);
}

function _refreshCsel(id) {
  const cs = _cselMap[id];
  if (!cs) return;
  const { native, trigger, list, opts } = cs;

  list.innerHTML = '';
  Array.from(native.options).forEach((opt) => {
    const item = document.createElement('div');
    item.className = 'csel-item' + (opt.value === native.value ? ' selected' : '');
    item.innerHTML = _cselOptHTML(opt.value, opt.text, opts);
    item.addEventListener('click', () => {
      native.value = opt.value;
      native.dispatchEvent(new Event('change', { bubbles: true }));
      _closeAllCsels();
      _refreshCsel(id);
    });
    list.appendChild(item);
  });

  const sel = native.options[native.selectedIndex];
  const chevron = `<svg class="csel-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>`;
  if (sel) {
    trigger.innerHTML = _cselOptHTML(sel.value, sel.text, opts) + chevron;
  } else {
    trigger.innerHTML = `<span class="csel-placeholder">Seleccionar...</span>${chevron}`;
  }
}

function _closeAllCsels() {
  Object.values(_cselMap).forEach(({ list, trigger }) => {
    list?.classList.remove('open');
    trigger?.classList.remove('open');
  });
}

function initCustomSelects() {
  _buildCsel('filter-envelope', {});
  _buildCsel('filter-source', {});
  _buildCsel('filter-category', { isCategory: true });

  $('filter-envelope')?.addEventListener('change', () => {
    _refreshCsel('filter-envelope');
    renderExpensesList();
  });
  $('filter-source')?.addEventListener('change', () => {
    _refreshCsel('filter-source');
    renderExpensesList();
  });
  $('filter-category')?.addEventListener('change', () => {
    _refreshCsel('filter-category');
    renderExpensesList();
  });
}

document.addEventListener('click', _closeAllCsels);

// Tecla Escape para cerrar modales y selects
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    _closeAllCsels();
    const overlay = $('modal-overlay');
    if (overlay && overlay.style.display !== 'none') {
      overlay.style.display = 'none';
    }
  }
});

function renderFilters() {
  const feEl = $('filter-envelope');
  const fsEl = $('filter-source');
  const fcEl = $('filter-category');

  if (feEl) {
    const curEnv = feEl.value;
    feEl.innerHTML = `<option value="">Todos los sobres</option>` +
      (state.envelopes || []).map((e) => `<option value="${e.id}">${e.name}</option>`).join('');
    if (curEnv) feEl.value = curEnv;
    _refreshCsel('filter-envelope');
  }

  if (fsEl) {
    const curSrc = fsEl.value;
    fsEl.innerHTML = `<option value="">Todas las fuentes</option>` +
      state.sources.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
    if (curSrc) fsEl.value = curSrc;
    _refreshCsel('filter-source');
  }

  if (fcEl) {
    const curCat = fcEl.value;
    const opts = state.categories.map((c) => `<option value="${c.name}">${c.name}</option>`).join('');
    fcEl.innerHTML = `<option value="">Todas las categorías</option>${opts}`;
    if (curCat) fcEl.value = curCat;
    _refreshCsel('filter-category');
  }
}

/* ============================================================
   DOMAIN LOGIC
   ============================================================ */

function sourceTotals(source) {
  const assigned   = Object.values(source.distribution || {}).reduce((a, b) => a + Number(b || 0), 0);
  const spent      = state.expenses.filter((e) => e.sourceId === source.id).reduce((a, b) => a + Number(b.amount), 0);
  const amount     = Number(source.amount);
  return { assigned, spent, unassigned: amount - assigned, available: amount - spent };
}

function categoryMap() {
  const map = {};
  state.categories.forEach((c) => {
    map[c.name] = { assigned: 0, spent: 0, color: c.color, bySource: {} };
  });
  state.sources.forEach((s) => {
    Object.entries(s.distribution || {}).forEach(([cat, amount]) => {
      if (!map[cat]) map[cat] = { assigned: 0, spent: 0, color: '#64748b', bySource: {} };
      map[cat].assigned += Number(amount || 0);
      map[cat].bySource[s.id] = { sourceId: s.id, sourceName: s.name, assigned: Number(amount || 0), spent: 0 };
    });
  });
  state.expenses.forEach((e) => {
    if (!map[e.category]) map[e.category] = { assigned: 0, spent: 0, color: '#64748b', bySource: {} };
    map[e.category].spent += Number(e.amount);
    if (!map[e.category].bySource[e.sourceId]) {
      const src = state.sources.find((s) => s.id === e.sourceId);
      map[e.category].bySource[e.sourceId] = { sourceId: e.sourceId, sourceName: src?.name || 'Fuente eliminada', assigned: 0, spent: 0 };
    }
    map[e.category].bySource[e.sourceId].spent += Number(e.amount);
  });
  return map;
}

function reduceAssignments(sourceId, category, amount) {
  let pending = Number(amount || 0);
  const assignments = state.assignments
    .filter((a) => a.sourceId === sourceId && a.category === category)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  assignments.forEach((assignment) => {
    if (pending <= 0) return;
    const current = Number(assignment.amount || 0);
    const moved = Math.min(current, pending);
    assignment.amount = current - moved;
    pending -= moved;
  });

  state.assignments = state.assignments.filter((a) => Number(a.amount || 0) > 0.009);
  return Number(amount || 0) - pending;
}

function moveRemainingBudget(sourceId, fromCategory) {
  const source = state.sources.find((s) => s.id === sourceId);
  if (!source) return;

  const assigned = Number(source.distribution?.[fromCategory] || 0);
  const spent = state.expenses
    .filter((e) => e.sourceId === sourceId && e.category === fromCategory)
    .reduce((a, b) => a + Number(b.amount), 0);
  const remaining = assigned - spent;

  if (remaining <= 0) {
    toast('No hay saldo restante para reasignar');
    return;
  }

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  const targetOptions = state.categories
    .filter((c) => c.name !== fromCategory)
    .map((c) => `<option value="${c.name}">${c.name}</option>`)
    .join('');

  content.innerHTML = `
    <div class="card-header">
      <h3>Reasignar sobrante</h3>
    </div>
    <form id="reassign-form" class="form-grid" style="padding:1rem">
      <p class="muted">Fuente: <b>${source.name}</b> · Categoría: <b>${fromCategory}</b> · Disponible: <b>${money(remaining)}</b></p>
      <div class="field">
        <label>Monto a mover (₡)</label>
        <input id="reassign-amount" type="text" inputmode="decimal" value="${formatAmountString(remaining)}" required />
      </div>
      <div class="field">
        <label>Destino</label>
        <select id="reassign-target">
          <option value="__unassigned__">Volver a la fuente (Sin asignar)</option>
          ${targetOptions}
        </select>
      </div>
      <div class="field form-actions">
        <button type="submit" class="btn-primary">Mover</button>
        <button type="button" class="btn-ghost" id="reassign-cancel">Cancelar</button>
      </div>
    </form>
  `;
  overlay.style.display = 'flex';
  attachAmountFormatter($('reassign-amount'));
  _buildCsel('reassign-target', { isCategory: true });

  $('reassign-cancel')?.addEventListener('click', () => { overlay.style.display = 'none'; });
  overlay.onclick = (ev) => {
    if (ev.target === overlay) overlay.style.display = 'none';
  };

  $('reassign-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const amount = parseAmount($('reassign-amount').value);
    const target = $('reassign-target').value;
    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) {
      toast(`Monto inválido. Máximo disponible: ${money(remaining)}`);
      return;
    }

    const moved = reduceAssignments(sourceId, fromCategory, amount);
    if (Math.abs(moved - amount) > 0.009) {
      toast('No se pudo encontrar toda la asignación a mover');
      rebuildDistributionsFromAssignments();
      renderAll();
      return;
    }

    if (target !== '__unassigned__') {
      state.assignments.push({ id: uid(), sourceId, category: target, amount, date: new Date().toISOString().slice(0, 10) });
      toast(`Reasignado ${money(amount)} de ${fromCategory} a ${target}`);
    } else {
      toast(`Movido ${money(amount)} de ${fromCategory} a "Sin asignar"`);
    }

    rebuildDistributionsFromAssignments();
    overlay.style.display = 'none';
    renderAll();
  });
}
window.moveRemainingBudget = moveRemainingBudget;

/* ============================================================
   NAVIGATION / TABS
   ============================================================ */

let currentTab = 'dashboard';

function switchTab(tab) {
  currentTab = tab;
  $$('.tab-panel').forEach((el) => el.classList.remove('active'));
  $$('.nav-item, .bnav-item').forEach((el) => el.classList.remove('active'));

  const panel = $(`tab-${tab}`);
  if (panel) panel.classList.add('active');

  $$(`[data-tab="${tab}"]`).forEach((el) => el.classList.add('active'));

  renderTab(tab);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Nav buttons (sidebar + bottom)
document.addEventListener('click', (e) => {
  const navBtn = e.target.closest('[data-tab]');
  if (navBtn && !navBtn.dataset.tabLink) switchTab(navBtn.dataset.tab);

  const linkBtn = e.target.closest('[data-tab-link]');
  if (linkBtn) switchTab(linkBtn.dataset.tabLink);
});

/* ============================================================
   THEME
   ============================================================ */

function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  const dark = state.theme === 'dark';
  $('icon-moon').style.display    = dark ? 'none'  : '';
  $('icon-sun').style.display     = dark ? ''      : 'none';
  $('icon-moon-m').style.display  = dark ? 'none'  : '';
  $('icon-sun-m').style.display   = dark ? ''      : 'none';
  $('theme-label').textContent    = dark ? 'Modo claro' : 'Modo oscuro';

  const themeMeta = $('theme-color-meta');
  if (themeMeta) {
    themeMeta.setAttribute('content', dark ? '#08080a' : '#ffffff');
  }
}

function toggleTheme() { state.theme = state.theme === 'dark' ? 'light' : 'dark'; applyTheme(); save(); }
$('theme-toggle').addEventListener('click', toggleTheme);
$('theme-toggle-mobile').addEventListener('click', toggleTheme);

/* ============================================================
   ENVELOPE SYSTEM & DOMAIN CALCULATIONS
   Formula: Saldo = Base + Ingresos + TransfIn - TransfOut - Gastos
   ============================================================ */

function getEnvelopeTotals(envOrId) {
  const env = typeof envOrId === 'string' ? state.envelopes.find((e) => e.id === envOrId) : envOrId;
  if (!env) return { base: 0, incomes: 0, transfersIn: 0, transfersOut: 0, spent: 0, available: 0, totalFunds: 0, pctSpent: 0 };

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

  const transfersIn = (state.transfers || [])
    .filter((t) => t.toEnvelopeId === env.id)
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

  const transfersOut = (state.transfers || [])
    .filter((t) => t.fromEnvelopeId === env.id)
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

  const spent = (state.expenses || [])
    .filter((e) => e.envelopeId === env.id || e.envelope === env.name)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const totalFunds = base + envIncomes + transfersIn;
  const available = totalFunds - transfersOut - spent;
  const pctSpent = totalFunds > 0 ? Math.min(100, Math.max(0, (spent / totalFunds) * 100)) : 0;

  return { base, incomes: envIncomes, transfersIn, transfersOut, spent, available, totalFunds, pctSpent };
}

function getEnvelopeIconSVG(iconName, color = 'currentColor', size = 16) {
  switch (iconName) {
    case 'lock':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
    case 'compass':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`;
    case 'tool':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
    case 'camera':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
    case 'wallet':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>`;
    case 'car':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`;
    case 'heart':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`;
    case 'shield':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    default:
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`;
  }
}

/* ============================================================
   PATRIMONIO TOTAL (DISCRETO / CONSULTA BAJO DEMANDA)
   ============================================================ */

let _showTotalWealth = false;

function renderTotalWealth() {
  const valEl = $('total-wealth-val');
  const eyeIcon = $('icon-eye-total');
  const eyeOffIcon = $('icon-eye-off-total');
  if (!valEl) return;

  if (_showTotalWealth) {
    const total = (state.envelopes || []).reduce((acc, env) => acc + getEnvelopeTotals(env).available, 0);
    valEl.textContent = money(total);
    if (eyeIcon) eyeIcon.style.display = 'none';
    if (eyeOffIcon) eyeOffIcon.style.display = '';
  } else {
    valEl.textContent = '₡***';
    if (eyeIcon) eyeIcon.style.display = '';
    if (eyeOffIcon) eyeOffIcon.style.display = 'none';
  }
}

function initTotalWealthToggle() {
  const btn = $('btn-toggle-total-wealth');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = 'true';
    btn.addEventListener('click', () => {
      _showTotalWealth = !_showTotalWealth;
      renderTotalWealth();
    });
  }
}

/* ============================================================
   TARJETAS DE SOBRES (DASHBOARD)
   ============================================================ */

const _revealedEnvelopes = new Set();

window.toggleEnvelopeMask = function(envId) {
  if (_revealedEnvelopes.has(envId)) {
    _revealedEnvelopes.delete(envId);
  } else {
    _revealedEnvelopes.add(envId);
  }
  renderEnvelopeCards();
};

window.toggleEnvelopeMenu = function(event, envId) {
  event.stopPropagation();
  const dropdown = document.getElementById(`env-menu-${envId}`);
  const isAlreadyOpen = dropdown?.classList.contains('open');
  closeAllEnvelopeMenus();
  if (!isAlreadyOpen && dropdown) {
    dropdown.classList.add('open');
  }
};

function closeAllEnvelopeMenus() {
  document.querySelectorAll('.envelope-menu-dropdown').forEach((d) => d.classList.remove('open'));
}
document.addEventListener('click', closeAllEnvelopeMenus);

function renderEnvelopeCards() {
  const container = $('envelopes-grid') || $('kpis');
  if (!container) return;

  if (!state.envelopes || !state.envelopes.length) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 2.5rem 1.5rem; text-align: center;">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 0.75rem; color: var(--text-3); display: block;"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
        <p style="font-weight: 600; font-size: 1rem; margin-bottom: 0.35rem;">No tienes sobres creados aún</p>
        <span style="display: block; max-width: 420px; margin: 0 auto 1.25rem; font-size: 0.85rem; color: var(--text-2);">Crea tus propios sobres con su nombre y saldo base para comenzar a organizar tu presupuesto de transición.</span>
        <button type="button" class="btn-primary" onclick="openCreateEnvelopeModal()" style="margin: 0 auto;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Crear primer sobre
        </button>
      </div>`;
    return;
  }

  container.innerHTML = state.envelopes.map((env) => {
    const t = getEnvelopeTotals(env);
    const isLocked = !!env.isLocked;
    const isRevealed = _revealedEnvelopes.has(env.id);
    const isMasked = isLocked && !isRevealed;

    const displayAmount = isMasked ? '₡***' : money(t.available);
    const iconSVG = getEnvelopeIconSVG(env.icon || (isLocked ? 'lock' : 'compass'), env.color || '#3b82f6', 16);

    const lockedClass = isLocked ? ' envelope-card--locked' : '';
    const lockedBadge = isLocked
      ? `<span class="envelope-badge-locked">
           <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
           Protegido
         </span>`
      : '';

    const eyeToggleBtn = isLocked
      ? `<button type="button" class="btn-eye-toggle" onclick="toggleEnvelopeMask('${env.id}')" title="${isRevealed ? 'Ocultar saldo' : 'Revelar saldo'}" aria-label="Alternar visibilidad">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
             ${isRevealed
               ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
               : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
             }
           </svg>
         </button>`
      : '';

    return `
      <div class="envelope-card${lockedClass}" data-env-id="${env.id}">
        <div>
          <div class="envelope-header">
            <div class="envelope-header-left">
              <div class="envelope-icon-wrap" style="background:${env.color}18; color:${env.color}">
                ${iconSVG}
              </div>
              <div class="envelope-title-wrap">
                <span class="envelope-name" title="${env.name}">${env.name}</span>
                ${lockedBadge}
              </div>
            </div>
            <div class="envelope-menu-wrap">
              <button type="button" class="envelope-menu-btn" onclick="toggleEnvelopeMenu(event, '${env.id}')" title="Opciones del sobre">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>
                </svg>
              </button>
              <div class="envelope-menu-dropdown" id="env-menu-${env.id}">
                <button type="button" class="envelope-menu-item" onclick="openIncomeModal(null, '${env.id}')">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Inyectar ingreso
                </button>
                <button type="button" class="envelope-menu-item" onclick="openTransferModal('${env.id}')">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>
                  Transferir dinero
                </button>
                <button type="button" class="envelope-menu-item" onclick="openEditEnvelopeModal('${env.id}')">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Editar sobre
                </button>
                <div class="envelope-menu-divider"></div>
                <button type="button" class="envelope-menu-item danger" onclick="openDeleteEnvelopeModal('${env.id}')">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  Eliminar sobre
                </button>
              </div>
            </div>
          </div>

          <div class="envelope-balance-section">
            <div class="envelope-balance-label">
              <span>Saldo disponible</span>
              ${eyeToggleBtn}
            </div>
            <div class="envelope-balance-row">
              <span class="envelope-balance-val ${t.available < 0 ? 'over' : ''} ${isMasked ? 'envelope-balance-masked' : ''}">${displayAmount}</span>
            </div>
          </div>
        </div>

        <div>
          <div class="envelope-progress-wrap" title="${Math.round(t.pctSpent)}% consumido">
            <div class="envelope-progress-bar">
              <div class="envelope-progress-fill" style="width:${t.pctSpent}%; background:${t.available < 0 ? 'var(--danger)' : (env.color || 'var(--text)')}"></div>
            </div>
            <span class="envelope-progress-pct">${Math.round(t.pctSpent)}%</span>
          </div>

          <div class="envelope-submetrics">
            <div class="envelope-metric">
              <span class="label">Fondo total</span>
              <span class="val">${isMasked ? '₡***' : money(t.totalFunds)}</span>
            </div>
            <div class="envelope-metric" style="text-align:right">
              <span class="label">Gastado</span>
              <span class="val spent">-${money(t.spent)}</span>
            </div>
          </div>
        </div>
      </div>`;
  }).join('');
}

/* ============================================================
   GESTIÓN MANUAL DE SOBRES (CREAR, EDITAR, TRANSFERIR, ELIMINAR)
   ============================================================ */

const AVAILABLE_ENVELOPE_ICONS = ['compass', 'lock', 'wallet', 'tool', 'camera', 'car', 'heart', 'shield'];

window.openCreateEnvelopeModal = function() {
  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  const PRESET_ENVELOPE_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#ec4899', '#3b82f6', '#06b6d4', '#8b5cf6', '#ef4444'];
  let selectedColor = PRESET_ENVELOPE_COLORS[Math.floor(Math.random() * PRESET_ENVELOPE_COLORS.length)];
  let selectedIcon = 'compass';

  content.innerHTML = `
    <div class="modal-info-content" style="max-width:440px">
      <div class="modal-info-header">
        <h3>Nuevo sobre</h3>
        <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form id="create-env-form" style="display:flex;flex-direction:column;gap:1rem;margin-top:0.5rem">
        <div class="field">
          <label>Nombre del sobre</label>
          <input id="modal-env-name" placeholder="Ej. Pista de Vida, Fondo Vacaciones..." required />
        </div>

        <div class="field">
          <label>Fondo base inicial (₡)</label>
          <div class="amount-input-wrap">
            <span class="currency-symbol">₡</span>
            <input id="modal-env-base" type="text" inputmode="decimal" placeholder="0.00" required />
          </div>
        </div>

        <div class="field">
          <label>Icono del sobre</label>
          <div class="icon-picker-grid" id="create-env-icon-grid">
            ${AVAILABLE_ENVELOPE_ICONS.map(ic => `
              <div class="icon-picker-item ${ic === selectedIcon ? 'selected' : ''}" data-icon="${ic}">
                ${getEnvelopeIconSVG(ic, 'currentColor', 18)}
              </div>
            `).join('')}
          </div>
        </div>

        <div class="field">
          <label>Color representativo</label>
          <div class="color-picker-grid" id="env-color-grid">
            ${PRESET_ENVELOPE_COLORS.map(c => `
              <div class="color-swatch ${c === selectedColor ? 'selected' : ''}" style="background:${c}" data-color="${c}"></div>
            `).join('')}
          </div>
        </div>

        <div class="field" style="display:flex;align-items:center;gap:0.6rem;padding:0.65rem 0.85rem;background:var(--bg-alt);border:1px solid var(--border);border-radius:var(--radius-sm)">
          <input type="checkbox" id="modal-env-locked" style="width:16px;height:16px;cursor:pointer" />
          <label for="modal-env-locked" style="cursor:pointer;font-size:0.78rem;font-weight:500;user-select:none;display:flex;align-items:center;gap:0.4rem">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Protección psicológica (ocultar saldo con asteriscos por defecto)
          </label>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:0.6rem;margin-top:0.4rem">
          <button type="button" class="btn-ghost" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
          <button type="submit" class="btn-primary">Crear sobre</button>
        </div>
      </form>
    </div>
  `;

  attachAmountFormatter($('modal-env-base'));
  const swatches = content.querySelectorAll('#env-color-grid .color-swatch');
  swatches.forEach(sw => {
    sw.addEventListener('click', () => {
      swatches.forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      selectedColor = sw.getAttribute('data-color');
    });
  });

  const iconItems = content.querySelectorAll('#create-env-icon-grid .icon-picker-item');
  iconItems.forEach(item => {
    item.addEventListener('click', () => {
      iconItems.forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      selectedIcon = item.getAttribute('data-icon');
    });
  });

  const lockCheckbox = $('modal-env-locked');
  lockCheckbox?.addEventListener('change', () => {
    if (lockCheckbox.checked && selectedIcon === 'compass') {
      selectedIcon = 'lock';
      iconItems.forEach(i => {
        if (i.getAttribute('data-icon') === 'lock') i.classList.add('selected');
        else i.classList.remove('selected');
      });
    }
  });

  overlay.style.display = 'flex';
  $('modal-env-name').focus();

  $('create-env-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = $('modal-env-name').value.trim();
    const baseAmount = parseAmount($('modal-env-base').value);
    const isLocked = $('modal-env-locked').checked;

    if (!name || isNaN(baseAmount) || baseAmount < 0) {
      toast('Ingresa un nombre y monto base válidos');
      return;
    }

    const newEnv = {
      id: uid(),
      name,
      baseAmount,
      color: selectedColor,
      isLocked,
      icon: selectedIcon
    };

    state.envelopes.push(newEnv);
    overlay.style.display = 'none';
    renderAll();
    toast(`Sobre "${name}" creado con éxito`);
  });
};

window.openEditEnvelopeModal = function(envId) {
  closeAllEnvelopeMenus();
  const env = state.envelopes.find(e => e.id === envId);
  if (!env) return;

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  const PRESET_ENVELOPE_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#ec4899', '#3b82f6', '#06b6d4', '#8b5cf6', '#ef4444'];
  let selectedColor = env.color || '#3b82f6';
  let selectedIcon = env.icon || (env.isLocked ? 'lock' : 'compass');

  content.innerHTML = `
    <div class="modal-info-content" style="max-width:440px">
      <div class="modal-info-header">
        <h3>Editar sobre</h3>
        <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form id="edit-env-form" style="display:flex;flex-direction:column;gap:1rem;margin-top:0.5rem">
        <div class="field">
          <label>Nombre del sobre</label>
          <input id="modal-edit-env-name" value="${env.name}" required />
        </div>

        <div class="field">
          <label>Fondo base inicial (₡)</label>
          <div class="amount-input-wrap">
            <span class="currency-symbol">₡</span>
            <input id="modal-edit-env-base" type="text" inputmode="decimal" value="${formatAmountString(env.baseAmount)}" required />
          </div>
        </div>

        <div class="field">
          <label>Icono del sobre</label>
          <div class="icon-picker-grid" id="edit-env-icon-grid">
            ${AVAILABLE_ENVELOPE_ICONS.map(ic => `
              <div class="icon-picker-item ${ic === selectedIcon ? 'selected' : ''}" data-icon="${ic}">
                ${getEnvelopeIconSVG(ic, 'currentColor', 18)}
              </div>
            `).join('')}
          </div>
        </div>

        <div class="field">
          <label>Color representativo</label>
          <div class="color-picker-grid" id="edit-env-color-grid">
            ${PRESET_ENVELOPE_COLORS.map(c => `
              <div class="color-swatch ${c.toLowerCase() === selectedColor.toLowerCase() ? 'selected' : ''}" style="background:${c}" data-color="${c}"></div>
            `).join('')}
          </div>
        </div>

        <div class="field" style="display:flex;align-items:center;gap:0.6rem;padding:0.65rem 0.85rem;background:var(--bg-alt);border:1px solid var(--border);border-radius:var(--radius-sm)">
          <input type="checkbox" id="modal-edit-env-locked" ${env.isLocked ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer" />
          <label for="modal-edit-env-locked" style="cursor:pointer;font-size:0.78rem;font-weight:500;user-select:none;display:flex;align-items:center;gap:0.4rem">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Protección psicológica (ocultar saldo con asteriscos por defecto)
          </label>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:0.6rem;margin-top:0.4rem">
          <button type="button" class="btn-ghost" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
          <button type="submit" class="btn-primary">Guardar cambios</button>
        </div>
      </form>
    </div>
  `;

  attachAmountFormatter($('modal-edit-env-base'));
  const swatches = content.querySelectorAll('#edit-env-color-grid .color-swatch');
  swatches.forEach(sw => {
    sw.addEventListener('click', () => {
      swatches.forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      selectedColor = sw.getAttribute('data-color');
    });
  });

  const iconItems = content.querySelectorAll('#edit-env-icon-grid .icon-picker-item');
  iconItems.forEach(item => {
    item.addEventListener('click', () => {
      iconItems.forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      selectedIcon = item.getAttribute('data-icon');
    });
  });

  overlay.style.display = 'flex';
  $('modal-edit-env-name').focus();

  $('edit-env-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = $('modal-edit-env-name').value.trim();
    const baseAmount = parseAmount($('modal-edit-env-base').value);
    const isLocked = $('modal-edit-env-locked').checked;

    if (!name || isNaN(baseAmount) || baseAmount < 0) {
      toast('Ingresa datos válidos');
      return;
    }

    env.name = name;
    env.baseAmount = baseAmount;
    env.color = selectedColor;
    env.isLocked = isLocked;
    env.icon = selectedIcon;

    overlay.style.display = 'none';
    renderAll();
    toast(`Sobre "${name}" actualizado`);
  });
};

window.openTransferModal = function(fromEnvId) {
  closeAllEnvelopeMenus();
  const fromEnv = state.envelopes.find(e => e.id === fromEnvId);
  if (!fromEnv) return;

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  const fromTotals = getEnvelopeTotals(fromEnv);
  const otherEnvelopes = state.envelopes.filter(e => e.id !== fromEnvId);

  if (!otherEnvelopes.length) {
    toast('Necesitas al menos dos sobres para realizar transferencias');
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const toOpts = otherEnvelopes.map(e => `<option value="${e.id}">${e.name}</option>`).join('');

  content.innerHTML = `
    <div class="modal-info-content" style="max-width:440px">
      <div class="modal-info-header">
        <h3>Transferir entre sobres</h3>
        <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form id="transfer-form" style="display:flex;flex-direction:column;gap:1rem;margin-top:0.5rem">
        <div class="transfer-flow-box">
          <div class="transfer-env-side">
            <span class="label">Origen</span>
            <span class="name">${fromEnv.name}</span>
            <span class="bal">Disp: ${money(fromTotals.available)}</span>
          </div>
          <div class="transfer-arrow-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </div>
          <div class="transfer-env-side" style="text-align:right">
            <span class="label">Destino</span>
            <select id="modal-transfer-to" style="width:100%;margin-top:2px">
              ${toOpts}
            </select>
          </div>
        </div>

        ${fromEnv.isLocked ? `
          <div class="psych-warning-box">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Atención: Estás transfiriendo desde el Ahorro Intocable.
          </div>
        ` : ''}

        <div class="field">
          <label>Monto a transferir (₡)</label>
          <div class="amount-input-wrap">
            <span class="currency-symbol">₡</span>
            <input id="modal-transfer-amount" type="text" inputmode="decimal" placeholder="0.00" required />
          </div>
        </div>

        <div class="field">
          <label>Motivo o concepto (opcional)</label>
          <input id="modal-transfer-note" placeholder="Ej. Rebalanceo para taller mecánico..." />
        </div>

        <div id="transfer-preview" class="expense-sim-box" style="display:none"></div>

        <div style="display:flex;justify-content:flex-end;gap:0.6rem;margin-top:0.4rem">
          <button type="button" class="btn-ghost" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
          <button type="submit" class="btn-primary">Ejecutar transferencia</button>
        </div>
      </form>
    </div>
  `;

  attachAmountFormatter($('modal-transfer-amount'));
  _buildCsel('modal-transfer-to', {});

  const toSelect = $('modal-transfer-to');
  const amountInput = $('modal-transfer-amount');
  const previewBox = $('transfer-preview');

  function updateTransferPreview() {
    const toEnvId = toSelect.value;
    const toEnv = state.envelopes.find(e => e.id === toEnvId);
    const amount = parseAmount(amountInput.value);

    if (!toEnv || !amount || amount <= 0) {
      previewBox.style.display = 'none';
      return;
    }

    const toTotals = getEnvelopeTotals(toEnv);
    const newFromBal = fromTotals.available - amount;
    const newToBal = toTotals.available + amount;
    const isOver = newFromBal < 0;

    previewBox.style.display = 'flex';
    previewBox.innerHTML = `
      <div class="sim-row">
        <span>${fromEnv.name} (Origen):</span>
        <span>${money(fromTotals.available)} → <b class="${isOver ? 'over' : ''}">${money(newFromBal)}</b></span>
      </div>
      <div class="sim-row">
        <span>${toEnv.name} (Destino):</span>
        <span>${money(toTotals.available)} → <b style="color:var(--success)">${money(newToBal)}</b></span>
      </div>
      ${isOver ? `
        <div style="font-size:0.75rem;color:var(--danger);margin-top:0.3rem">
          Excede el saldo disponible del sobre de origen por ${money(Math.abs(newFromBal))}.
        </div>
      ` : ''}
    `;
  }

  toSelect.addEventListener('change', updateTransferPreview);
  amountInput.addEventListener('input', updateTransferPreview);

  overlay.style.display = 'flex';
  amountInput.focus();

  $('transfer-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const toEnvId = toSelect.value;
    const amount = parseAmount(amountInput.value);
    const note = $('modal-transfer-note').value.trim();

    if (!toEnvId || !amount || amount <= 0) {
      toast('Ingresa un monto válido');
      return;
    }

    if (amount > fromTotals.available) {
      if (!confirm(`El monto excede el disponible (${money(fromTotals.available)}). ¿Continuar de todos modos?`)) {
        return;
      }
    }

    if (!Array.isArray(state.transfers)) state.transfers = [];

    const newTransfer = {
      id: uid(),
      fromEnvelopeId: fromEnvId,
      toEnvelopeId: toEnvId,
      amount,
      date: todayStr,
      note: note || `Transferencia de ${fromEnv.name} a ${state.envelopes.find(e => e.id === toEnvId)?.name}`
    };

    state.transfers.push(newTransfer);
    overlay.style.display = 'none';
    renderAll();
    toast(`Transferido ${money(amount)} con éxito`);
  });
};

window.openDeleteEnvelopeModal = function(envId) {
  closeAllEnvelopeMenus();
  if (state.envelopes.length <= 1) {
    toast('No puedes eliminar el único sobre existente');
    return;
  }

  const env = state.envelopes.find(e => e.id === envId);
  if (!env) return;

  const t = getEnvelopeTotals(env);
  const remaining = t.available;
  const otherEnvelopes = state.envelopes.filter(e => e.id !== envId);

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  const targetOpts = otherEnvelopes.map(e => `<option value="${e.id}">${e.name}</option>`).join('');

  content.innerHTML = `
    <div class="modal-info-content" style="max-width:440px">
      <div class="modal-info-header">
        <h3>Eliminar sobre</h3>
        <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form id="delete-env-form" style="display:flex;flex-direction:column;gap:1rem;margin-top:0.5rem">
        <p style="font-size:0.82rem;color:var(--text)">
          ¿Estás seguro de que deseas eliminar el sobre <b>"${env.name}"</b>?
        </p>

        ${remaining > 0 ? `
          <div style="padding:0.75rem;background:var(--bg-alt);border:1px solid var(--border);border-radius:var(--radius-sm)">
            <p style="font-size:0.78rem;color:var(--text-2);margin-bottom:0.5rem">
              Este sobre cuenta con un saldo restante de <b>${money(remaining)}</b>. Selecciona a qué sobre deseas reasignar este dinero antes de eliminarlo:
            </p>
            <div class="field">
              <label>Sobre destino de los fondos</label>
              <select id="modal-delete-reassign-to" required>
                ${targetOpts}
              </select>
            </div>
          </div>
        ` : ''}

        <div style="display:flex;justify-content:flex-end;gap:0.6rem;margin-top:0.5rem">
          <button type="button" class="btn-ghost" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
          <button type="submit" class="btn-danger">Eliminar sobre</button>
        </div>
      </form>
    </div>
  `;

  if (remaining > 0) {
    _buildCsel('modal-delete-reassign-to', {});
  }

  overlay.style.display = 'flex';

  $('delete-env-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (remaining > 0) {
      const targetId = $('modal-delete-reassign-to')?.value;
      const targetEnv = state.envelopes.find(e => e.id === targetId);
      if (targetEnv) {
        targetEnv.baseAmount = Number(targetEnv.baseAmount || 0) + remaining;
      }
    }

    state.expenses.forEach(e => {
      if (e.envelopeId === envId) {
        e.envelopeId = otherEnvelopes[0]?.id || '';
      }
    });
    state.incomes.forEach(i => {
      if (i.envelopeId === envId) {
        i.envelopeId = otherEnvelopes[0]?.id || '';
      }
    });

    state.envelopes = state.envelopes.filter(e => e.id !== envId);
    overlay.style.display = 'none';
    renderAll();
    toast(`Sobre "${env.name}" eliminado`);
  });
};

/* ============================================================
   RENDER CHARTS (POR SOBRE, SIN TOTAL GLOBAL)
   ============================================================ */

let categoriesChart, balanceChart;

function renderCharts() {
  const envs = state.envelopes || [];
  const labels = envs.map((e) => e.name);
  const colors = envs.map((e) => e.color || '#64748b');

  const totalFundsData = envs.map((e) => getEnvelopeTotals(e).totalFunds);
  const spentData = envs.map((e) => getEnvelopeTotals(e).spent);

  const isDark = state.theme === 'dark';
  const gridColor  = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const labelColor = isDark ? '#9999a1' : '#5c5c64';

  Chart.defaults.color = labelColor;
  Chart.defaults.font.family = "'Geist', -apple-system, BlinkMacSystemFont, sans-serif";

  categoriesChart?.destroy();
  const catCanvas = $('chart-categories');
  if (catCanvas) {
    categoriesChart = new Chart(catCanvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: spentData.every(v => v === 0) ? envs.map(() => 1) : spentData,
          backgroundColor: colors,
          borderWidth: 1.5,
          borderColor: isDark ? '#08080a' : '#ffffff'
        }]
      },
      options: {
        cutout: '72%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 8, boxHeight: 8, padding: 12, font: { size: 11 } }
          },
          tooltip: {
            callbacks: {
              label: (c) => ` ${c.label}: ${money(spentData[c.dataIndex] || 0)} gastado`
            }
          }
        }
      }
    });
  }

  balanceChart?.destroy();
  const balCanvas = $('chart-balance');
  if (balCanvas) {
    balanceChart = new Chart(balCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Fondo total', data: totalFundsData, backgroundColor: colors.map((c) => c + 'c0'), borderRadius: 2, borderWidth: 0 },
          { label: 'Gastado',  data: spentData,    backgroundColor: isDark ? '#f43f5ecc' : '#e11d48cc', borderRadius: 2, borderWidth: 0 }
        ]
      },
      options: {
        responsive: true,
        scales: {
          x: { grid: { color: gridColor }, ticks: { font: { size: 10 } } },
          y: { grid: { color: gridColor }, ticks: { callback: (v) => `₡${(v/1000).toFixed(0)}k`, font: { size: 10 } } }
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 8, boxHeight: 8, padding: 12, font: { size: 11 } }
          }
        }
      }
    });
  }
}

/* ============================================================
   RENDER RECENT EXPENSES (dashboard)
   ============================================================ */

function renderRecentExpenses() {
  const recent = [...state.expenses].sort(compareByDateDesc).slice(0, 5);
  const el = $('recent-expenses-list');
  if (!el) return;

  if (!recent.length) {
    el.innerHTML = `<div class="empty-state">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>
      <p>Sin gastos registrados</p><span>Añade tu primer gasto con el botón de registrar gasto</span></div>`;
    return;
  }

  el.innerHTML = recent.map((e) => {
    const env = state.envelopes.find((x) => x.id === e.envelopeId || x.name === e.envelope);
    const cat = state.categories.find((c) => c.name === e.category);
    const envColor = env?.color || 'var(--text-3)';
    return `<div class="recent-row">
      <div class="recent-left">
        <div class="recent-desc">${e.desc}</div>
        <div class="recent-meta">${fmt(e.date)} · <span style="display:inline-flex;align-items:center;gap:.25rem">
          <span style="width:7px;height:7px;border-radius:50%;background:${envColor};display:inline-block"></span>
          ${env?.name || 'Sobre'}</span> · <span style="display:inline-flex;align-items:center;gap:.25rem">
          <span style="width:7px;height:7px;border-radius:50%;background:${cat?.color || '#888'};display:inline-block"></span>
          ${e.category || 'General'}</span></div>
      </div>
      <div class="recent-amount">-${money(e.amount)}</div>
    </div>`;
  }).join('');
}

/* ============================================================
   RENDER INGRESOS Y ENTRADAS DE DINERO
   ============================================================ */

function renderSources() {
  const el = $('sources');
  if (!el) return;

  const allIncomes = [...(state.incomes || [])];
  if (Array.isArray(state.sources)) {
    state.sources.forEach(s => {
      if (!allIncomes.some(i => i.id === s.id)) allIncomes.push(s);
    });
  }

  if (!allIncomes.length) {
    el.innerHTML = `<div class="empty-state" style="padding:2rem">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <p>Sin ingresos registrados</p><span>Inyecta tu primer ingreso asignándolo a un sobre con el botón de nuevo ingreso</span></div>`;
    return;
  }

  el.innerHTML = allIncomes.sort(compareByDateDesc).map((s) => {
    const env = state.envelopes.find((e) => e.id === s.envelopeId || e.name === s.envelope);
    const envColor = env?.color || 'var(--text-3)';
    const envName = env?.name || 'Sin sobre asignado';

    const badge = s.status === 'recibido' || !s.status
      ? `<span class="badge badge-received">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Recibido
        </span>`
      : `<span class="badge badge-pending">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Pendiente
        </span>`;

    return `<div class="source-card">
      <div class="source-header">
        <div class="source-title-wrap">
          <span class="source-name">${s.name}</span>
          <span class="exp-tag" style="margin-left:0.5rem">
            <span class="exp-tag-dot" style="background:${envColor}"></span>
            ${envName}
          </span>
        </div>
        <div class="source-meta">
          ${badge}
          <div class="source-actions">
            <button type="button" class="btn-secondary btn-sm" onclick="openIncomeModal('${s.id}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Editar
            </button>
            <button type="button" class="btn-danger btn-sm" onclick="deleteIncome('${s.id}')" title="Eliminar ingreso">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div class="source-compact-body">
        <div class="source-compact-metrics">
          <div class="compact-metric">
            <span class="label">Monto inyectado:</span>
            <span class="val total" style="color:var(--success)">+${money(s.amount)}</span>
          </div>
          <div class="compact-metric">
            <span class="label">Sobre destino:</span>
            <span class="val">${envName}</span>
          </div>
          <div class="compact-metric">
            <span class="label">Fecha:</span>
            <span class="val">${fmt(s.date)}</span>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

window.deleteIncome = function(id) {
  if (!confirm('¿Eliminar este registro de ingreso?')) return;
  state.incomes = (state.incomes || []).filter((x) => x.id !== id);
  state.sources = (state.sources || []).filter((x) => x.id !== id);
  renderAll();
  toast('Ingreso eliminado');
};

/* ============================================================
   INCOME MODAL (NUEVO / EDITAR INGRESO ASIGNADO A SOBRE)
   ============================================================ */

window.openIncomeModal = window.openSourceModal = function(incomeId = null, preselectedEnvId = null) {
  const isEdit = !!incomeId;
  const s = isEdit ? (state.incomes || state.sources || []).find((x) => x.id === incomeId) : null;
  const targetEnvId = s ? (s.envelopeId || s.envelope) : (preselectedEnvId || state.envelopes[0]?.id || '');

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  const todayStr = new Date().toISOString().slice(0, 10);
  const envOpts = state.envelopes.map((e) => {
    return `<option value="${e.id}" ${e.id === targetEnvId ? 'selected' : ''}>${e.isLocked ? '[Protegido] ' : ''}${e.name}</option>`;
  }).join('');

  content.innerHTML = `
    <div class="modal-info-content" style="max-width:440px">
      <div class="modal-info-header">
        <h3>${isEdit ? 'Editar ingreso' : 'Nuevo ingreso asignado'}</h3>
        <button type="button" class="btn-ghost btn-sm" id="source-modal-close" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form id="source-modal-form" style="display:flex;flex-direction:column;gap:0.95rem;margin-top:0.5rem">
        <div class="field">
          <label class="field-label-step">
            <span class="step-num">1</span>
            CONCEPTO DEL INGRESO
          </label>
          <input id="modal-src-name" placeholder="Ej. Beca INA, Salario, Trabajo extra..." value="${s ? s.name : ''}" required />
        </div>

        <div class="field">
          <label class="field-label-step">
            <span class="step-num">2</span>
            MONTO DEL INGRESO (₡)
          </label>
          <div class="amount-input-wrap">
            <span class="currency-symbol">₡</span>
            <input id="modal-src-amount" type="text" inputmode="decimal" placeholder="0.00" value="${s ? formatAmountString(s.amount) : ''}" required />
          </div>
        </div>

        <div class="field">
          <label class="field-label-step">
            <span class="step-num">3</span>
            SOBRE DESTINO (OBLIGATORIO)
          </label>
          <select id="modal-src-envelope" required>
            ${envOpts}
          </select>
        </div>

        <div class="form-grid" style="grid-template-columns: 1fr 1fr; gap:0.75rem; padding:0">
          <div class="field">
            <label class="field-label-step">
              <span class="step-num">4</span>
              FECHA
            </label>
            <input id="modal-src-date" type="date" value="${s ? s.date : todayStr}" required />
          </div>

          <div class="field">
            <label class="field-label-step">
              <span class="step-num">5</span>
              ESTADO
            </label>
            <select id="modal-src-status">
              <option value="recibido" ${!s || s.status === 'recibido' ? 'selected' : ''}>Recibido</option>
              <option value="pendiente" ${s && s.status === 'pendiente' ? 'selected' : ''}>Pendiente</option>
            </select>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:0.6rem;margin-top:0.5rem">
          <button type="button" class="btn-ghost" id="source-modal-cancel" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
          <button type="submit" class="btn-primary">${isEdit ? 'Actualizar ingreso' : 'Inyectar al sobre'}</button>
        </div>
      </form>
    </div>
  `;

  _buildCsel('modal-src-envelope', {});
  _buildCsel('modal-src-status', { isStatus: true });
  attachAmountFormatter($('modal-src-amount'));

  const nameInput = $('modal-src-name');
  overlay.style.display = 'flex';
  nameInput.focus();

  $('source-modal-close')?.addEventListener('click', () => { overlay.style.display = 'none'; });
  $('source-modal-cancel')?.addEventListener('click', () => { overlay.style.display = 'none'; });
  overlay.onclick = (ev) => { if (ev.target === overlay) overlay.style.display = 'none'; };

  $('source-modal-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = $('modal-src-name').value.trim();
    const amount = parseAmount($('modal-src-amount').value);
    const envelopeId = $('modal-src-envelope').value;
    const date = $('modal-src-date').value || todayStr;
    const status = $('modal-src-status').value;

    if (!name || !amount || amount <= 0 || !envelopeId) {
      toast('Ingresa datos válidos y selecciona un sobre');
      return;
    }

    if (!Array.isArray(state.incomes)) state.incomes = [];
    if (!Array.isArray(state.sources)) state.sources = [];

    const targetEnv = state.envelopes.find((e) => e.id === envelopeId);

    if (isEdit) {
      const existing = state.incomes.find((x) => x.id === incomeId) || state.sources.find((x) => x.id === incomeId);
      if (existing) {
        Object.assign(existing, { name, amount, envelopeId, date, status });
      }
      toast(`Ingreso actualizado en ${targetEnv?.name || 'sobre'}`);
    } else {
      const newInc = { id: uid(), name, amount, envelopeId, date, status };
      state.incomes.push(newInc);
      state.sources.push(newInc);
      toast(`Inyectado ${money(amount)} a ${targetEnv?.name || 'sobre'}`);
    }

    overlay.style.display = 'none';
    renderAll();
  });
};

window.deleteSource = function(id) {
  if (!confirm('¿Eliminar esta fuente y todos sus gastos asociados?')) return;
  state.sources = state.sources.filter((s) => s.id !== id);
  state.expenses = state.expenses.filter((e) => e.sourceId !== id);
  state.assignments = state.assignments.filter((a) => a.sourceId !== id);
  renderAll();
  toast('Fuente eliminada');
};

/* ============================================================
   SOURCE INFO MODAL (i) - VISUAL PROGRESS BARS
   ============================================================ */

window.openSourceInfoModal = function(sourceId) {
  const s = state.sources.find((x) => x.id === sourceId);
  if (!s) return;
  const t = sourceTotals(s);
  const total = Number(s.amount) || 0;

  const pctAssigned = total > 0 ? Math.min(100, (t.assigned / total) * 100) : 0;
  const pctUnassigned = total > 0 ? Math.max(0, (t.unassigned / total) * 100) : 0;
  const pctSpentOfTotal = total > 0 ? Math.min(100, (t.spent / total) * 100) : 0;
  const pctSpentOfAssigned = t.assigned > 0 ? Math.min(100, (t.spent / t.assigned) * 100) : 0;

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  const cats = Object.entries(s.distribution || {});

  content.innerHTML = `
    <div class="modal-info-content">
      <div class="modal-info-header">
        <div>
          <h3>${s.name}</h3>
          <p class="muted" style="font-size:0.75rem;margin-top:0.2rem">
            Estado: <b>${s.status === 'recibido' ? 'Recibido' : 'Pendiente'}</b> · Fecha esperada: <b>${fmt(s.date)}</b>
          </p>
        </div>
        <button type="button" class="btn-ghost btn-sm" id="modal-info-close" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="info-bars-container">
        <!-- Total -->
        <div class="info-bar-item">
          <div class="info-bar-header">
            <span class="name">Total Presupuestado</span>
            <span class="val">${money(total)}</span>
          </div>
          <div class="info-bar-track">
            <div class="info-bar-fill" style="width:100%; background:var(--accent)"></div>
          </div>
        </div>

        <!-- Asignado -->
        <div class="info-bar-item">
          <div class="info-bar-header">
            <span class="name">Asignado a categorías (${Math.round(pctAssigned)}%)</span>
            <span class="val">${money(t.assigned)}</span>
          </div>
          <div class="info-bar-track">
            <div class="info-bar-fill" style="width:${pctAssigned}%; background:var(--text)"></div>
          </div>
        </div>

        <!-- Sin Asignar -->
        <div class="info-bar-item">
          <div class="info-bar-header">
            <span class="name">Sin asignar (${Math.round(pctUnassigned)}%)</span>
            <span class="val" style="color:${t.unassigned < 0 ? 'var(--danger)' : 'var(--success)'}">${money(t.unassigned)}</span>
          </div>
          <div class="info-bar-track">
            <div class="info-bar-fill" style="width:${pctUnassigned}%; background:${t.unassigned < 0 ? 'var(--danger)' : 'var(--success)'}"></div>
          </div>
        </div>

        <!-- Gastado -->
        <div class="info-bar-item">
          <div class="info-bar-header">
            <span class="name">Gastado real (${Math.round(pctSpentOfAssigned)}% de lo asignado)</span>
            <span class="val" style="color:var(--danger)">${money(t.spent)}</span>
          </div>
          <div class="info-bar-track">
            <div class="info-bar-fill" style="width:${pctSpentOfTotal}%; background:var(--danger)"></div>
          </div>
        </div>

        <!-- Saldo Disponible Real -->
        <div class="info-bar-item">
          <div class="info-bar-header">
            <span class="name">Saldo remanente disponible</span>
            <span class="val" style="color:${t.available < 0 ? 'var(--danger)' : 'var(--success)'}">${money(t.available)}</span>
          </div>
        </div>
      </div>

      <!-- Categorías de esta fuente -->
      ${cats.length ? `
        <div class="info-cat-breakdown">
          <h4 style="font-size:0.78rem;font-weight:600;color:var(--text-2);margin-bottom:0.25rem">Categorías asignadas en esta fuente</h4>
          ${cats.map(([cat, amt]) => {
            const catObj = state.categories.find((c) => c.name === cat);
            const spent = state.expenses
              .filter((e) => e.sourceId === s.id && e.category === cat)
              .reduce((a, b) => a + Number(b.amount), 0);
            return `<div class="info-cat-row">
              <div style="display:flex;align-items:center;gap:0.4rem">
                <span class="cat-dot" style="background:${catObj?.color || '#888'}"></span>
                <b>${cat}</b>
              </div>
              <div style="display:flex;gap:0.75rem;font-size:0.75rem">
                <span>Asig: <b>${money(amt)}</b></span>
                <span style="color:var(--danger)">Gast: <b>${money(spent)}</b></span>
                <span style="color:${amt - spent < 0 ? 'var(--danger)' : 'var(--success)'}">Disp: <b>${money(amt - spent)}</b></span>
              </div>
            </div>`;
          }).join('')}
        </div>
      ` : ''}

      <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.5rem">
        <button type="button" class="btn-primary btn-sm" onclick="openSourceAssignmentsModal('${s.id}')">Editar asignaciones →</button>
      </div>
    </div>
  `;

  overlay.style.display = 'flex';
  $('modal-info-close')?.addEventListener('click', () => { overlay.style.display = 'none'; });
  overlay.onclick = (ev) => { if (ev.target === overlay) overlay.style.display = 'none'; };
};

/* ============================================================
   SOURCE ASSIGNMENTS MODAL - CLEAN BUDGET ALLOCATION
   ============================================================ */

window.openSourceAssignmentsModal = function(sourceId) {
  const s = state.sources.find((x) => x.id === sourceId);
  if (!s) return;

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  function renderModalContent() {
    const freshSource = state.sources.find((x) => x.id === sourceId);
    if (!freshSource) { overlay.style.display = 'none'; return; }
    const t = sourceTotals(freshSource);
    const sourceAssignments = state.assignments.filter((a) => a.sourceId === sourceId);

    const catOpts = state.categories.map((c) => `<option value="${c.name}">${c.name}</option>`).join('');

    content.innerHTML = `
      <div class="assignments-modal-body">
        <div class="modal-info-header">
          <div>
            <h3>Asignaciones: ${freshSource.name}</h3>
            <p class="muted" style="font-size:0.75rem;margin-top:0.15rem">Distribuye el presupuesto disponible en tus categorías</p>
          </div>
          <button type="button" class="btn-ghost btn-sm" id="assignments-modal-close" onclick="document.getElementById('modal-overlay').style.display='none'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="assignments-balance-card">
          <div class="abc-col">
            <span class="label">Total fuente</span>
            <span class="val">${money(freshSource.amount)}</span>
          </div>
          <div class="abc-col">
            <span class="label">Asignado</span>
            <span class="val">${money(t.assigned)}</span>
          </div>
          <div class="abc-col">
            <span class="label">Por asignar</span>
            <span class="val" style="color:${t.unassigned < 0 ? 'var(--danger)' : 'var(--success)'}">${money(t.unassigned)}</span>
          </div>
        </div>

        <div>
          <h4 style="font-size:0.78rem;font-weight:600;color:var(--text-2);margin-bottom:0.45rem">
            Asignaciones actuales (${sourceAssignments.length})
          </h4>
          <div class="assignments-table">
            ${sourceAssignments.length === 0 ? `
              <div class="empty-state" style="padding:1rem;font-size:0.8rem">
                <span>Esta fuente aún no tiene categorías asignadas</span>
              </div>
            ` : sourceAssignments.map((a) => {
              const catObj = state.categories.find((c) => c.name === a.category);
              return `<div class="assignment-row-item">
                <div class="assignment-cat-name">
                  <span class="cat-dot" style="background:${catObj?.color || '#888'}"></span>
                  <span>${a.category}</span>
                </div>
                <div class="assignment-input-inline">
                  <input type="text" inputmode="decimal" value="${formatAmountString(a.amount)}" id="input-asg-${a.id}" data-asg-id="${a.id}" />
                  <button type="button" class="btn-secondary btn-sm" onclick="saveAssignmentInline('${a.id}', '${sourceId}')" title="Guardar cambios">Guardar</button>
                  <button type="button" class="btn-danger btn-sm" onclick="removeAssignmentFromModal('${a.id}', '${sourceId}')" title="Eliminar asignación">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>

        <div class="assignment-add-box">
          <h4>+ Asignar presupuesto a categoría</h4>
          <form id="modal-asg-add-form" class="assignment-add-form">
            <select id="modal-asg-category" required>${catOpts}</select>
            <input id="modal-asg-amount" type="text" inputmode="decimal" placeholder="Monto (₡)" required />
            <button type="submit" class="btn-primary btn-sm">Asignar</button>
          </form>
        </div>

        <div style="display:flex;justify-content:flex-end">
          <button type="button" class="btn-secondary btn-sm" id="modal-asg-done-btn" onclick="document.getElementById('modal-overlay').style.display='none'">Listo</button>
        </div>
      </div>
    `;

    _buildCsel('modal-asg-category', { isCategory: true });

    attachAmountFormatter($('modal-asg-amount'));
    state.assignments.filter((a) => a.sourceId === sourceId).forEach((a) => {
      attachAmountFormatter($(`input-asg-${a.id}`));
    });

    // Scroll focus handler
    content.querySelectorAll('input, select').forEach((inp) => {
      inp.addEventListener('focus', () => {
        setTimeout(() => inp.scrollIntoView({ block: 'center', behavior: 'smooth' }), 200);
      });
    });

    $('assignments-modal-close')?.addEventListener('click', () => { overlay.style.display = 'none'; });
    $('modal-asg-done-btn')?.addEventListener('click', () => { overlay.style.display = 'none'; });

    $('modal-asg-add-form')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const cat = $('modal-asg-category').value;
      const amt = parseAmount($('modal-asg-amount').value);
      if (!cat || !amt || amt <= 0) return;

      const curDist = { ...(freshSource.distribution || {}) };
      const curTotal = Object.values(curDist).reduce((x, y) => x + Number(y || 0), 0);
      if (curTotal + amt > Number(freshSource.amount)) {
        toast(`Excede el total de la fuente (${money(freshSource.amount)})`);
        return;
      }

      state.assignments.push({
        id: uid(),
        sourceId: freshSource.id,
        category: cat,
        amount: amt,
        date: new Date().toISOString().slice(0, 10)
      });
      rebuildDistributionsFromAssignments();
      renderAll();
      toast(`Asignado ${money(amt)} a ${cat}`);
      renderModalContent();
    });
  }

  renderModalContent();
  overlay.style.display = 'flex';
  overlay.onclick = (ev) => { if (ev.target === overlay) overlay.style.display = 'none'; };
};

window.saveAssignmentInline = function(assignmentId, sourceId) {
  const input = $(`input-asg-${assignmentId}`);
  if (!input) return;
  const newAmt = parseAmount(input.value);
  if (!Number.isFinite(newAmt) || newAmt <= 0) {
    toast('Monto inválido');
    return;
  }
  const asg = state.assignments.find((a) => a.id === assignmentId);
  const src = state.sources.find((s) => s.id === sourceId);
  if (!asg || !src) return;

  const currentTotal = Object.values(src.distribution || {}).reduce((x, y) => x + Number(y || 0), 0);
  const projected = currentTotal - Number(asg.amount) + newAmt;
  if (projected > Number(src.amount)) {
    toast(`Excede el total de la fuente (${money(src.amount)})`);
    return;
  }

  asg.amount = newAmt;
  rebuildDistributionsFromAssignments();
  renderAll();
  toast('Asignación actualizada');
  openSourceAssignmentsModal(sourceId);
};

window.removeAssignmentFromModal = function(assignmentId, sourceId) {
  if (!confirm('¿Eliminar esta asignación de presupuesto?')) return;
  state.assignments = state.assignments.filter((a) => a.id !== assignmentId);
  rebuildDistributionsFromAssignments();
  renderAll();
  toast('Asignación eliminada');
  openSourceAssignmentsModal(sourceId);
};

/* ============================================================
   RENDER CATEGORIES & CATEGORY MODAL (GOTERO COLOR PICKER)
   ============================================================ */

const PRESET_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6',
  '#6366f1', '#f97316', '#64748b', '#84cc16'
];

window.openCategoryModal = function(catName = null) {
  const isEdit = !!catName;
  const existing = isEdit ? state.categories.find((c) => c.name === catName) : null;

  let selectedColor = existing ? existing.color : PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];
  const isCustomColor = !PRESET_COLORS.some((c) => c.toLowerCase() === selectedColor.toLowerCase());

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  content.innerHTML = `
    <div class="modal-info-content" style="max-width:440px">
      <div class="modal-info-header">
        <h3>${isEdit ? 'Editar categoría' : 'Nueva categoría'}</h3>
        <button type="button" class="btn-ghost btn-sm" id="cat-modal-close" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form id="cat-modal-form" style="display:flex;flex-direction:column;gap:1rem;margin-top:0.5rem">
        <div class="field">
          <label>Nombre de la categoría</label>
          <input id="cat-modal-name" placeholder="Ej. Alimentación, Vivienda, Servicios..." value="${existing ? existing.name : ''}" required />
        </div>

        <div class="field">
          <label>Color representativo</label>
          <div class="color-picker-grid" id="cat-preset-grid">
            ${PRESET_COLORS.map((c) => `
              <div class="color-swatch ${c.toLowerCase() === selectedColor.toLowerCase() ? 'selected' : ''}" style="background:${c}" data-color="${c}"></div>
            `).join('')}

            <!-- Gotero Button for Custom Color -->
            <label class="color-swatch custom-color-picker ${isCustomColor ? 'selected' : ''}" id="gotero-swatch" title="Color personalizado con gotero" style="background:${isCustomColor ? selectedColor : 'var(--bg-alt)'}">
              <input type="color" id="cat-native-color" value="${selectedColor}" class="sr-only-color-input" />
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m2 22 5-5"/>
                <path d="M9.5 14.5 16 8"/>
                <path d="m17 7 3-3a2.12 2.12 0 0 1 3 3l-3 3"/>
                <path d="m14.5 9.5 3 3"/>
                <path d="M11.5 12.5 4 20v2h2l7.5-7.5"/>
              </svg>
            </label>
          </div>
        </div>

        <div style="padding:0.6rem 0.85rem;background:var(--bg-alt);border:1px solid var(--border);border-radius:var(--radius-sm);display:flex;align-items:center;gap:0.6rem">
          <span style="font-size:0.75rem;color:var(--text-3)">Vista previa:</span>
          <span class="badge" id="cat-preview-badge" style="background:${selectedColor};color:#fff;font-weight:600;padding:0.25rem 0.6rem">
            ${existing ? existing.name : 'Ejemplo'}
          </span>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:0.6rem;margin-top:0.5rem">
          <button type="button" class="btn-ghost" id="cat-modal-cancel" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
          <button type="submit" class="btn-primary">${isEdit ? 'Guardar cambios' : 'Crear categoría'}</button>
        </div>
      </form>
    </div>
  `;

  const swatches = content.querySelectorAll('.color-swatch:not(.custom-color-picker)');
  const goteroSwatch = $('gotero-swatch');
  const nativeColorInput = $('cat-native-color');
  const previewBadge = $('cat-preview-badge');
  const nameInput = $('cat-modal-name');

  swatches.forEach((sw) => {
    sw.addEventListener('click', () => {
      content.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('selected'));
      sw.classList.add('selected');
      selectedColor = sw.getAttribute('data-color');
      nativeColorInput.value = selectedColor;
      previewBadge.style.background = selectedColor;
      goteroSwatch.style.background = 'var(--bg-alt)';
    });
  });

  nativeColorInput.addEventListener('input', (ev) => {
    content.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('selected'));
    goteroSwatch.classList.add('selected');
    selectedColor = ev.target.value;
    goteroSwatch.style.background = selectedColor;
    previewBadge.style.background = selectedColor;
  });

  nameInput.addEventListener('input', (ev) => {
    previewBadge.textContent = ev.target.value.trim() || 'Ejemplo';
  });

  overlay.style.display = 'flex';
  nameInput.focus();

  // Scroll focus listener for mobile keyboard safety
  content.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('focus', () => {
      setTimeout(() => inp.scrollIntoView({ block: 'center', behavior: 'smooth' }), 200);
    });
  });

  $('cat-modal-close')?.addEventListener('click', () => { overlay.style.display = 'none'; });
  $('cat-modal-cancel')?.addEventListener('click', () => { overlay.style.display = 'none'; });
  overlay.onclick = (ev) => { if (ev.target === overlay) overlay.style.display = 'none'; };

  $('cat-modal-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;

    if (!isEdit && state.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast('Esa categoría ya existe');
      return;
    }

    if (isEdit) {
      const cat = state.categories.find((c) => c.name === catName);
      if (cat) {
        cat.name = name;
        cat.color = selectedColor;
      }
      state.expenses.forEach((ex) => { if (ex.category === catName) ex.category = name; });
      state.assignments.forEach((a) => { if (a.category === catName) a.category = name; });
      state.sources.forEach((s) => {
        if (s.distribution && s.distribution[catName] !== undefined) {
          s.distribution[name] = s.distribution[catName];
          if (name !== catName) delete s.distribution[catName];
        }
      });
      toast(`Categoría "${name}" actualizada`);
    } else {
      state.categories.push({ name, color: selectedColor });
      toast(`Categoría "${name}" creada`);
    }

    overlay.style.display = 'none';
    renderAll();
  });
};

function renderCategories() {
  const map = categoryMap();
  const el = $('categories');

  const opts = state.categories.map((c) => `<option value="${c.name}">${c.name}</option>`).join('');
  $('filter-category').innerHTML = `<option value="">Todas las categorías</option>${opts}`;
  _refreshCsel('filter-category');

  const entries = Object.entries(map);
  if (!entries.length) {
    el.innerHTML = `<div class="empty-state" style="padding:2rem">
      <p>Sin categorías definidas</p><span>Crea tu primera categoría con el botón de arriba</span>
    </div>`;
    return;
  }

  el.innerHTML = entries.map(([cat, d]) => {
    const available = d.assigned - d.spent;
    const pct = d.assigned > 0 ? Math.min(100, (d.spent / d.assigned) * 100) : 0;
    const detail = Object.values(d.bySource).map((x) => `
      <div class="breakdown-row">
        <span class="src-name">${x.sourceName}</span>
        <div class="src-vals">
          <span>Asig: <b>${money(x.assigned)}</b></span>
          <span>Gast: <b>${money(x.spent)}</b></span>
          <span>Disp: <b>${money(x.assigned - x.spent)}</b></span>
          ${(x.assigned - x.spent) > 0
            ? `<button type="button" class="btn-secondary btn-sm" onclick="moveRemainingBudget('${x.sourceId}','${cat.replace(/'/g, "\\'")}')">Reasignar</button>`
            : ''}
        </div>
      </div>`).join('');

    return `<div class="category-card">
      <div class="category-header">
        <div class="category-title">
          <span class="cat-dot" style="background:${d.color}"></span>
          ${cat}
        </div>
        <div class="category-card-actions">
          <button type="button" class="btn-secondary btn-sm" onclick="openCategoryModal('${cat.replace(/'/g, "\\'")}')" title="Editar categoría">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Editar
          </button>
          <button type="button" class="btn-danger btn-sm" onclick="deleteCategory('${cat.replace(/'/g, "\\'")}')" title="Eliminar categoría">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Eliminar
          </button>
        </div>
      </div>

      <div class="category-body">
        <div class="category-metrics-grid">
          <div class="cat-metric-box">
            <span class="label">Asignado</span>
            <span class="val">${money(d.assigned)}</span>
          </div>
          <div class="cat-metric-box">
            <span class="label">Gastado</span>
            <span class="val spent">${money(d.spent)}</span>
          </div>
          <div class="cat-metric-box">
            <span class="label">Disponible</span>
            <span class="val ${available < 0 ? 'over' : 'remaining'}">${money(available)}</span>
          </div>
        </div>

        <div class="cat-progress-wrap">
          <div class="progress-bar" style="flex:1">
            <div class="progress-fill" style="width:${pct}%; background:${d.color}"></div>
          </div>
          <span class="cat-pct">${Math.round(pct)}%</span>
        </div>

        ${detail ? `<details><summary>Desglose por fuente</summary><div class="source-breakdown">${detail}</div></details>` : ''}
      </div>
    </div>`;
  }).join('');
}

window.deleteCategory = function(name) {
  if (!confirm(`¿Eliminar categoría "${name}" y todos sus gastos asociados?`)) return;
  state.categories = state.categories.filter((c) => c.name !== name);
  state.assignments = state.assignments.filter((a) => a.category !== name);
  state.expenses = state.expenses.filter((e) => e.category !== name);
  state.sources.forEach((s) => {
    if (s.distribution && s.distribution[name] !== undefined) {
      delete s.distribution[name];
    }
  });
  rebuildDistributionsFromAssignments();
  renderAll();
  toast(`Categoría "${name}" eliminada`);
};

/* ============================================================
   EXPENSE MODAL & SMART BALANCING (CONVERTED TO COMPACT MODAL)
   ============================================================ */

window.openExpenseModal = function(expenseId = null) {
  if (!state.envelopes || !state.envelopes.length) {
    toast('Crea al menos un sobre antes de registrar gastos');
    openCreateEnvelopeModal();
    return;
  }

  const isEdit = !!expenseId;
  const ex = isEdit ? state.expenses.find((x) => x.id === expenseId) : null;

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  const todayStr = new Date().toISOString().slice(0, 10);
  const initialEnvId = ex ? (ex.envelopeId || ex.sourceId || state.envelopes[0].id) : state.envelopes[0].id;

  const envOpts = state.envelopes.map((env) => {
    const t = getEnvelopeTotals(env);
    return `<option value="${env.id}" ${env.id === initialEnvId ? 'selected' : ''}>${env.isLocked ? '[Protegido] ' : ''}${env.name} (Disp: ${money(t.available)})</option>`;
  }).join('');

  const catOpts = state.categories.map((c) => {
    return `<option value="${c.name}" ${ex && ex.category === c.name ? 'selected' : ''}>${c.name}</option>`;
  }).join('');

  content.innerHTML = `
    <div class="modal-info-content" style="max-width:460px">
      <div class="modal-info-header">
        <h3>${isEdit ? 'Editar gasto' : 'Registrar nuevo gasto'}</h3>
        <button type="button" class="btn-ghost btn-sm" id="expense-modal-close" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form id="expense-modal-form" class="expense-smart-form" style="padding:0.5rem 0;display:flex;flex-direction:column;gap:0.9rem">
        <!-- Step 1: SOBRE DEL QUE SE DESCONTARÁ EL DINERO -->
        <div class="field">
          <label class="field-label-step">
            <span class="step-num">1</span>
            SELECCIONA EL SOBRE DEL QUE SE DESCONTARÁ EL DINERO
          </label>
          <select id="modal-exp-envelope" required>${envOpts}</select>
        </div>

        <!-- Psychological warning if locked -->
        <div id="modal-exp-locked-warning" class="psych-warning-box" style="display:none">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>Atención: Este sobre cuenta con protección psicológica. Asegúrate de que este gasto sea indispensable.</span>
        </div>

        <!-- Step 2: CATEGORÍA DEL GASTO -->
        <div class="field">
          <label class="field-label-step">
            <span class="step-num">2</span>
            CATEGORÍA DEL GASTO
          </label>
          <select id="modal-exp-category" required>${catOpts}</select>
        </div>

        <!-- Step 3: MONTO Y FECHA -->
        <div class="form-grid" style="grid-template-columns: 1fr 1fr; gap:0.75rem; padding:0">
          <div class="field">
            <label class="field-label-step">
              <span class="step-num">3</span>
              MONTO DEL GASTO (₡)
            </label>
            <div class="amount-input-wrap">
              <span class="currency-symbol">₡</span>
              <input id="modal-exp-amount" type="text" inputmode="decimal" placeholder="0.00" value="${ex ? formatAmountString(ex.amount) : ''}" required autocomplete="off" />
            </div>
          </div>

          <div class="field">
            <label class="field-label-step">
              <span class="step-num">4</span>
              FECHA DEL GASTO
            </label>
            <input id="modal-exp-date" type="date" value="${ex ? ex.date : todayStr}" required />
          </div>
        </div>

        <!-- Step 4: CONCEPTO -->
        <div class="field">
          <label class="field-label-step">
            <span class="step-num">5</span>
            CONCEPTO O DESCRIPCIÓN
          </label>
          <input id="modal-exp-desc" placeholder="Ej. Taller mecánico, compras de comida, repuesto..." value="${ex ? ex.desc : ''}" required />
        </div>

        <!-- Live Simulation Box -->
        <div id="modal-exp-sim-box" class="expense-sim-box" style="display:none"></div>

        <div style="display:flex;justify-content:flex-end;gap:0.6rem;margin-top:0.4rem">
          <button type="button" class="btn-ghost" id="expense-modal-cancel" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
          <button type="submit" class="btn-primary">${isEdit ? 'Actualizar gasto' : 'Registrar gasto'}</button>
        </div>
      </form>
    </div>
  `;

  _buildCsel('modal-exp-envelope', {});
  _buildCsel('modal-exp-category', { isCategory: true });

  const envSelect = $('modal-exp-envelope');
  const catSelect = $('modal-exp-category');
  const lockedWarning = $('modal-exp-locked-warning');
  const simBox = $('modal-exp-sim-box');
  const amountInput = $('modal-exp-amount');

  function updateModalSimulation() {
    const envId = envSelect.value;
    const env = state.envelopes.find((e) => e.id === envId);
    if (!env) {
      if (lockedWarning) lockedWarning.style.display = 'none';
      if (simBox) simBox.style.display = 'none';
      return;
    }

    if (lockedWarning) {
      lockedWarning.style.display = env.isLocked ? 'flex' : 'none';
    }

    const amount = parseAmount(amountInput.value || 0);
    const totals = getEnvelopeTotals(env);
    const existingAmount = (isEdit && ex && (ex.envelopeId === envId || ex.sourceId === envId)) ? Number(ex.amount || 0) : 0;
    const currentAvailable = totals.available + existingAmount;
    const newAvailable = currentAvailable - amount;
    const isOver = newAvailable < 0;

    if (!amount || amount <= 0) {
      simBox.style.display = 'none';
      return;
    }

    simBox.style.display = 'flex';
    simBox.innerHTML = `
      <div class="sim-row">
        <span style="color:var(--text-2)">Saldo disponible en <b>${env.name}</b></span>
        <span>${money(currentAvailable)}</span>
      </div>
      <div class="sim-row">
        <span style="font-weight:500;color:var(--text)">Balance resultante:</span>
        <div class="sim-calc-flow">
          <span>${money(currentAvailable)}</span>
          <span class="arrow">− ${money(amount)} →</span>
          <span class="new-bal ${isOver ? 'over' : ''}">${money(newAvailable)}</span>
        </div>
      </div>
      ${isOver ? `
        <div style="font-size:0.75rem;color:var(--danger);font-weight:500;margin-top:0.25rem;display:flex;align-items:center;gap:0.35rem">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Excede el saldo disponible del sobre por ${money(Math.abs(newAvailable))}.
        </div>
      ` : ''}
    `;
  }

  envSelect.addEventListener('change', () => {
    _refreshCsel('modal-exp-envelope');
    updateModalSimulation();
  });
  amountInput.addEventListener('input', updateModalSimulation);

  updateModalSimulation();
  attachAmountFormatter(amountInput);

  overlay.style.display = 'flex';
  amountInput.focus();

  content.querySelectorAll('input, select').forEach((inp) => {
    inp.addEventListener('focus', () => {
      setTimeout(() => inp.scrollIntoView({ block: 'center', behavior: 'smooth' }), 200);
    });
  });

  $('expense-modal-close')?.addEventListener('click', () => { overlay.style.display = 'none'; });
  $('expense-modal-cancel')?.addEventListener('click', () => { overlay.style.display = 'none'; });
  overlay.onclick = (ev) => { if (ev.target === overlay) overlay.style.display = 'none'; };

  $('expense-modal-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const envId = envSelect.value;
    const category = catSelect.value;
    const amount = parseAmount(amountInput.value);
    const date = $('modal-exp-date').value || todayStr;
    const desc = $('modal-exp-desc').value.trim();

    if (!envId || !category || !amount || amount <= 0) {
      toast('Ingresa datos válidos para el gasto');
      return;
    }

    const env = state.envelopes.find((e) => e.id === envId);
    if (!env) {
      toast('Selecciona un sobre válido');
      return;
    }

    const totals = getEnvelopeTotals(env);
    const existingAmount = (isEdit && ex && (ex.envelopeId === envId || ex.sourceId === envId)) ? Number(ex.amount || 0) : 0;
    const currentAvailable = totals.available + existingAmount;

    if (amount > currentAvailable) {
      if (!confirm(`Este gasto excede el saldo disponible en "${env.name}" (${money(currentAvailable)}). ¿Deseas registrarlo de todos modos?`)) {
        return;
      }
    }

    if (isEdit) {
      const existingExp = state.expenses.find((x) => x.id === expenseId);
      if (existingExp) {
        Object.assign(existingExp, {
          envelopeId: envId,
          envelope: env.name,
          sourceId: envId,
          category,
          amount,
          desc,
          date
        });
      }
      toast(`Gasto de ${money(amount)} actualizado`);
    } else {
      state.expenses.push({
        id: uid(),
        envelopeId: envId,
        envelope: env.name,
        sourceId: envId,
        category,
        amount,
        desc,
        date
      });
      toast(`Gasto de ${money(amount)} descontado de ${env.name}`);
    }

    overlay.style.display = 'none';
    renderAll();
  });
};

/* ============================================================
   RENDER EXPENSES LIST
   ============================================================ */

function renderExpensesList() {
  const filterEnv = $('filter-envelope')?.value || $('filter-source')?.value;
  const filterCat = $('filter-category')?.value;

  let list = [...state.expenses].sort(compareByDateDesc);
  if (filterEnv) {
    list = list.filter((e) => e.envelopeId === filterEnv || e.envelope === filterEnv || e.sourceId === filterEnv);
  }
  if (filterCat) list = list.filter((e) => e.category === filterCat);

  const el = $('expenses-list');
  if (!el) return;

  if (!list.length) {
    el.innerHTML = `<div class="empty-state">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>
      <p>Sin gastos registrados</p><span>Ajusta los filtros o registra un nuevo gasto</span></div>`;
    return;
  }

  el.innerHTML = `
    <div class="expense-table-header">
      <span>Descripción</span><span>Categoría</span><span>Sobre</span><span>Monto</span><span>Fecha</span><span>Acciones</span>
    </div>` +
    list.map((e) => {
      const env = (state.envelopes || []).find((x) => x.id === e.envelopeId || x.name === e.envelope) || state.sources.find((s) => s.id === e.sourceId);
      const cat = state.categories.find((c) => c.name === e.category);
      const envColor = env?.color || '#888';
      const envName = env?.name || '—';

      return `<div class="expense-row">
        <div class="exp-col-desc">
          <div class="exp-desc">${e.desc}</div>
          <div class="exp-meta-inline">
            <span class="exp-tag"><span class="exp-tag-dot" style="background:${cat?.color || '#888'}"></span>${e.category}</span>
            <span class="exp-tag"><span class="exp-tag-dot" style="background:${envColor}"></span>${envName}</span>
            <span class="exp-date">${fmt(e.date)}</span>
          </div>
        </div>
        <div class="exp-col-cat"><span class="exp-tag"><span class="exp-tag-dot" style="background:${cat?.color || '#888'}"></span>${e.category}</span></div>
        <div class="exp-col-src"><span class="exp-tag"><span class="exp-tag-dot" style="background:${envColor}"></span>${envName}</span></div>
        <div class="exp-col-amt"><span class="exp-amount">-${money(e.amount)}</span></div>
        <div class="exp-col-date"><span class="exp-date">${fmt(e.date)}</span></div>
        <div class="exp-col-actions expense-actions">
          <button type="button" class="btn-secondary btn-sm" onclick="openExpenseModal('${e.id}')" title="Editar gasto">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Editar
          </button>
          <button type="button" class="btn-danger btn-sm" onclick="deleteExpense('${e.id}')" title="Eliminar gasto">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Eliminar
          </button>
        </div>
      </div>`;
    }).join('');
}

window.deleteExpense = function(id) {
  if (!confirm('¿Eliminar este gasto?')) return;
  state.expenses = state.expenses.filter((x) => x.id !== id);
  renderAll();
  toast('Gasto eliminado');
};

/* ============================================================
   RENDER ALL / PER TAB
   ============================================================ */

function renderTab(tab) {
  switch (tab) {
    case 'dashboard':
      renderTotalWealth();
      renderEnvelopeCards();
      renderCharts();
      renderCatSummary();
      renderRecentExpenses();
      break;
    case 'sources':
      renderSources();
      break;
    case 'categories':
      renderCategories();
      break;
    case 'expenses':
      renderFilters();
      renderCategories();  // keep selects in sync
      renderExpensesList();
      break;
  }
}

function renderOnly() {
  applyTheme();
  renderTab(currentTab);
  renderFilters();
  renderCategories();
}

function renderAll() {
  renderOnly();
  save();
}

/* ============================================================
   CALCULATOR
   ============================================================ */

const calcState = { expr: '', result: '0', justEvaled: false, histExpr: '' };
const CALC_OPS  = ['+', '−', '×', '÷'];

function calcRender() {
  // Show the evaluated expression (e.g. "8+10 =") in the small line after hitting =
  $('calc-expr').textContent    = calcState.justEvaled ? calcState.histExpr : '';
  $('calc-display').textContent = calcState.result;
}

function calcInput(val) {
  if (calcState.justEvaled) {
    if (!CALC_OPS.includes(val)) {
      // Digit/dot after eval → start fresh
      calcState.expr = '';
      calcState.result = '0';
      calcState.histExpr = '';
    }
    // Operator after eval → continue from result (expr is already the result string)
  }
  calcState.justEvaled = false;
  const lastChar = calcState.expr.slice(-1);
  if (CALC_OPS.includes(val) && CALC_OPS.includes(lastChar)) return; // no double ops
  if (val === '.' && /[0-9]*\.[0-9]*$/.test(calcState.expr.split(/[+\-×÷−]/).pop())) return;
  calcState.expr += val;
  calcState.result = calcState.expr || '0';
  calcRender();
}

function calcEval() {
  if (!calcState.expr) return;
  try {
    const safe = calcState.expr
      .replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
    // eslint-disable-next-line no-new-func
    const r = Function('"use strict";return (' + safe + ')')();
    if (!isFinite(r)) {
      calcState.result  = 'Error';
      calcState.expr    = '';
      calcState.histExpr = '';
    } else {
      const resultStr       = String(+parseFloat(r.toFixed(10)));
      calcState.histExpr    = calcState.expr + ' =';  // save what we evaluated
      calcState.result      = resultStr;
      calcState.expr        = resultStr;              // KEY FIX: expr = numeric result
    }
    calcState.justEvaled = true;
  } catch {
    calcState.result   = 'Error';
    calcState.expr     = '';
    calcState.histExpr = '';
  }
  calcRender();
}

function calcPercent() {
  try {
    const safe = calcState.expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
    // eslint-disable-next-line no-new-func
    const r = Function('"use strict";return (' + safe + ')')();
    const resultStr   = String(+parseFloat((r / 100).toFixed(10)));
    calcState.histExpr = calcState.expr + ' % =';
    calcState.result  = resultStr;
    calcState.expr    = resultStr;
    calcState.justEvaled = true;
  } catch { /* ignore */ }
  calcRender();
}

// FAB toggle — hide FAB when panel is open
$('calc-fab').addEventListener('click', () => {
  const panel = $('calc-panel');
  const open  = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : '';
  $('calc-fab').style.display = open ? '' : 'none';
  if (!open) {
    panel.style.animation = 'none';
    requestAnimationFrame(() => { panel.style.animation = ''; });
    calcRender();
  }
});

$('calc-close').addEventListener('click', () => {
  $('calc-panel').style.display = 'none';
  $('calc-fab').style.display = '';
});

// Calculator button delegation
$('calc-panel').addEventListener('click', (e) => {
  const btn = e.target.closest('.calc-btn');
  if (!btn) return;
  const action = btn.dataset.action;
  const val    = btn.dataset.val;
  if (action === 'clear') {
    calcState.expr = ''; calcState.result = '0';
    calcState.justEvaled = false; calcState.histExpr = '';
    calcRender();
  }
  else if (action === 'backspace') {
    if (calcState.justEvaled) {
      // backspace after eval → clear entirely
      calcState.expr = ''; calcState.result = '0';
      calcState.justEvaled = false; calcState.histExpr = '';
    } else {
      calcState.expr   = calcState.expr.slice(0, -1);
      calcState.result = calcState.expr || '0';
    }
    calcRender();
  }
  else if (action === 'equals') calcEval();
  else if (action === 'pct')    calcPercent();
  else if (val !== undefined)   calcInput(val);
});

// Keyboard support (when calc is open)
document.addEventListener('keydown', (e) => {
  if ($('calc-panel').style.display === 'none') return;
  const map = { '0':'0','1':'1','2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9',
    '+':'+','-':'−','*':'×','/':'÷','.':'.',
    'Enter':'=','=':'=','Backspace':'back','Escape':'esc','%':'%' };
  const k = map[e.key];
  if (!k) return;
  e.preventDefault();
  if (k === '=')    calcEval();
  else if (k === 'back') {
    if (calcState.justEvaled) {
      calcState.expr = ''; calcState.result = '0'; calcState.justEvaled = false; calcState.histExpr = '';
    } else {
      calcState.expr = calcState.expr.slice(0,-1); calcState.result = calcState.expr||'0';
    }
    calcRender();
  }
  else if (k === 'esc') { $('calc-panel').style.display = 'none'; $('calc-fab').style.display = ''; }
  else if (k === '%') calcPercent();
  else calcInput(k);
});

/* ============================================================
   RENDER ENVELOPE SUMMARY (dashboard)
   ============================================================ */

function renderCatSummary() {
  const envs = state.envelopes || [];
  const el = $('cat-summary-list');
  const count = $('cat-summary-count');
  if (!el) return;

  if (!envs.length) {
    el.innerHTML = `<div class="empty-state" style="padding:1.5rem">
      <p>Sin sobres definidos</p>
      <span>Crea tus primeros sobres para visualizar su desglose</span>
    </div>`;
    if (count) count.textContent = '';
    return;
  }

  if (count) count.textContent = `${envs.length} ${envs.length === 1 ? 'sobre' : 'sobres'}`;

  el.innerHTML = `
    <div class="cat-summary-header">
      <span>Sobre</span>
      <span>Consumo</span>
      <span style="text-align:right">Fondo total</span>
      <span style="text-align:right">Gastado</span>
      <span style="text-align:right">Disponible</span>
    </div>` +
    envs.map((env) => {
      const t = getEnvelopeTotals(env);
      const isLocked = !!env.isLocked;
      const isRevealed = _revealedEnvelopes.has(env.id);
      const isMasked = isLocked && !isRevealed;
      const over = t.available < 0;

      return `<div class="cat-summary-row">
        <div class="cat-sum-name">
          <span class="cat-dot" style="background:${env.color || 'var(--text)'}"></span>
          ${env.name}
          ${isLocked ? `
            <span class="envelope-badge-locked" style="margin-left:0.4rem;font-size:0.65rem;padding:0.1rem 0.35rem">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Protegido
            </span>` : ''}
        </div>
        <div class="cat-sum-bar-wrap">
          <div class="cat-sum-bar">
            <div class="cat-sum-bar-fill" style="width:${t.pctSpent}%;background:${over ? 'var(--danger)' : (env.color || 'var(--text)')}"></div>
          </div>
          <span class="cat-sum-pct">${Math.round(t.pctSpent)}%</span>
        </div>
        <div class="cat-sum-values">
          <div class="cat-sum-col">
            <div class="label">Fondo total</div>
            <div class="val">${isMasked ? '₡***' : money(t.totalFunds)}</div>
          </div>
          <div class="cat-sum-col">
            <div class="label">Gastado</div>
            <div class="val spent">-${money(t.spent)}</div>
          </div>
          <div class="cat-sum-col">
            <div class="label">Disponible</div>
            <div class="val ${over ? 'over' : 'remaining'}">${isMasked ? '₡***' : money(t.available)}</div>
          </div>
        </div>
      </div>`;
    }).join('');
}

/* ============================================================
   INIT  (async: carga Supabase primero, localStorage como fallback)
   Envuelto en Auth.init para protección por contraseña.
   ============================================================ */

function _startApp() {
  // Botones de seguridad — sidebar y mobile
  async function openSecurityModal() {
    const overlay = document.getElementById('security-modal-overlay');
    const body    = document.getElementById('security-modal-body');
    if (!overlay || !body) return;
    body.innerHTML = await Auth.renderSettingsPanel();
    Auth.bindSettingsEvents();
    overlay.style.display = 'flex';
  }

  document.getElementById('security-btn')?.addEventListener('click', openSecurityModal);
  document.getElementById('security-btn-mobile')?.addEventListener('click', openSecurityModal);
  document.getElementById('security-modal-close')?.addEventListener('click', () => {
    document.getElementById('security-modal-overlay').style.display = 'none';
  });
  document.getElementById('security-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('security-modal-overlay'))
      document.getElementById('security-modal-overlay').style.display = 'none';
  });

  const srcDateEl = $('source-date');
  if (srcDateEl) srcDateEl.valueAsDate = new Date();
  applyTheme();
  ensureEnvelopes();
  initTotalWealthToggle();
  renderAll();
  initCustomSelects();
  switchTab('dashboard');
}

let _unsubscribeFirestore = null;

async function handleUserSession(user) {
  const shell = document.querySelector('.app-shell');
  const sidebar = document.getElementById('sidebar');

  if (!user) {
    // Si se cierra sesión: detener sincronización en tiempo real
    if (_unsubscribeFirestore) {
      _unsubscribeFirestore();
      _unsubscribeFirestore = null;
    }

    // Limpiar estado en memoria para que no queden datos de un usuario previo
    Object.assign(state, {
      envelopes: [],
      sources: [],
      incomes: [],
      expenses: [],
      transfers: [],
      categories: DEFAULT_CATEGORIES,
      assignments: [],
      editingSourceId: null,
      editingExpenseId: null,
      editingCategoryName: null
    });

    if (shell) shell.style.visibility = 'hidden';
    if (sidebar) sidebar.style.visibility = 'hidden';

    if (window.Auth) {
      window.Auth.updateUserProfile(null);
      window.Auth.showAuthPortal({
        defaultTab: 'login',
        onAuthSuccess: (newUser) => handleUserSession(newUser)
      });
    }
    return;
  }

  // Usuario autenticado: mostrar portal
  if (window.Auth) {
    window.Auth.hideAuthPortal();
    window.Auth.updateUserProfile(user);
  }

  // Cargar datos de este usuario desde Firestore
  try {
    const remoteState = await window.FBAuth.loadUserState(user.uid);
    if (remoteState) {
      Object.assign(state, remoteState, { editingSourceId: null });
    } else {
      const cached = localStorage.getItem('budget_state_' + user.uid);
      if (cached) {
        Object.assign(state, JSON.parse(cached), { editingSourceId: null });
      } else {
        Object.assign(state, {
          envelopes: [],
          sources: [],
          incomes: [],
          expenses: [],
          transfers: [],
          categories: DEFAULT_CATEGORIES,
          assignments: []
        });
      }
    }
  } catch (err) {
    console.warn('Error cargando de Firestore, usando caché local:', err);
  }

  ensureEnvelopes();
  if (!state.categories?.length) state.categories = DEFAULT_CATEGORIES;
  if (!Array.isArray(state.assignments)) state.assignments = [];

  migrateAssignmentsIfNeeded();
  reconcileAssignmentsWithDistributions();
  rebuildDistributionsFromAssignments();

  // Escuchar cambios en Firestore en tiempo real para este usuario
  if (_unsubscribeFirestore) _unsubscribeFirestore();
  _unsubscribeFirestore = window.FBAuth.subscribeToUserState(user.uid, (remote) => {
    if (!remote || remote._deviceId === _deviceId) return;
    Object.assign(state, remote, { editingSourceId: state.editingSourceId });
    ensureEnvelopes();
    if (!state.categories?.length) state.categories = DEFAULT_CATEGORIES;
    if (!Array.isArray(state.assignments)) state.assignments = [];
    reconcileAssignmentsWithDistributions();
    renderOnly();
    toast('Sincronizado');
  });

  if (shell) shell.style.visibility = 'visible';
  if (sidebar) sidebar.style.visibility = 'visible';

  _startApp();
}

(async () => {
  applyTheme();

  if (window.Auth && window.Auth._initInactivityTracker) {
    window.Auth._initInactivityTracker();
  }

  if (window.FBAuth) {
    const initialized = await window.FBAuth.init();
    if (initialized) {
      window.FBAuth.onChange((user) => {
        handleUserSession(user);
      });
    } else {
      // Si falta configurar Firebase, mostrar el portal con pestaña de login
      if (window.Auth) {
        window.Auth.showAuthPortal({
          defaultTab: 'login',
          onAuthSuccess: (user) => handleUserSession(user)
        });
      }
    }
  } else {
    _startApp();
  }
})();
