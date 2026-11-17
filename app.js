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
   CORE UTILITIES (DEFINIDOS AL INICIO PARA EVITAR TDZ)
   ============================================================ */

const $  = (id) => document.getElementById(id);
const $$ = (sel, ctx = document) => ctx.querySelectorAll(sel);

const money = (n) => `₡${Number(n || 0).toLocaleString('es-CR', { maximumFractionDigits: 2 })}`;
const uid   = () => Math.random().toString(36).slice(2, 10);
const fmt   = (iso) => { if (!iso) return '—'; const [y,m,d] = String(iso).split('-'); return (y && m && d) ? `${d}/${m}/${y}` : String(iso); };
const compareByDateDesc = (a, b) => {
  const dateA = String(a?.date || '0000-00-00');
  const dateB = String(b?.date || '0000-00-00');
  return dateB.localeCompare(dateA);
};

// ID único por pestaña/dispositivo — se regenera con cada recarga
const _deviceId = Math.random().toString(36).slice(2, 8);

/* ============================================================
   STATE
   ============================================================ */

const DEFAULT_ENVELOPES = [];

const DEFAULT_CATEGORIES = [];

const _revealedEnvelopes = new Set();

const INITIAL = {
  envelopes: [],
  sources: [],
  incomes: [],
  expenses: [],
  transfers: [],
  categories: [],
  assignments: [],
  budgets: [],
  periodLimits: [],
  reserves: [],
  theme: 'light',
  editingSourceId: null,
  editingExpenseId: null,
  editingCategoryName: null
};

let _initialCached = null;
try {
  const lastUserRaw = localStorage.getItem('bf_last_user');
  if (lastUserRaw) {
    const lastUser = JSON.parse(lastUserRaw);
    if (lastUser?.uid) {
      const uCache = localStorage.getItem('budget_state_' + lastUser.uid);
      if (uCache) _initialCached = JSON.parse(uCache);
    }
  }
} catch (_) {}

if (!_initialCached) {
  try {
    const localGuest = localStorage.getItem('budget_state_local');
    if (localGuest) _initialCached = JSON.parse(localGuest);
  } catch (_) {}
}

if (!_initialCached) {
  try {
    const legacy = localStorage.getItem('budget_state');
    if (legacy) _initialCached = JSON.parse(legacy);
  } catch (_) {}
}

const state = { ...INITIAL, ...(_initialCached || {}) };

const LEGACY_AUTO_CAT_NAMES = new Set(['Alimentación', 'Mascotas', 'Transporte', 'Ahorro', 'Diversión']);

function ensureEnvelopes() {
  if (!Array.isArray(state.envelopes)) state.envelopes = [];
  if (!Array.isArray(state.sources)) state.sources = [];
  if (!Array.isArray(state.incomes)) state.incomes = [];
  if (!Array.isArray(state.expenses)) state.expenses = [];
  if (!Array.isArray(state.transfers)) state.transfers = [];
  if (!Array.isArray(state.categories)) state.categories = [];
  if (!Array.isArray(state.assignments)) state.assignments = [];
  if (!Array.isArray(state.budgets)) state.budgets = [];
  if (!Array.isArray(state.periodLimits)) state.periodLimits = [];
  if (!Array.isArray(state.reserves)) state.reserves = [];

  // Limpiar categorías predeterminadas antiguas si fueron autogeneradas y no tienen uso ni configuración
  if (
    state.categories.length === 5 &&
    state.categories.every((c) => c && !c.id && !c.budget && !c.spendingLimit && !c.startDate && !c.endDate && LEGACY_AUTO_CAT_NAMES.has(c.name)) &&
    !state.expenses.some((e) => e && e.category && LEGACY_AUTO_CAT_NAMES.has(e.category)) &&
    !state.assignments.some((a) => a && a.category && LEGACY_AUTO_CAT_NAMES.has(a.category))
  ) {
    state.categories = [];
  }

  // Sincronizar incomes y sources sin duplicados
  const incomeById = new Map();
  [...state.incomes, ...state.sources].forEach((item) => {
    if (!item || typeof item !== 'object') return;
    if (!item.id) item.id = uid();
    const existing = incomeById.get(item.id);
    if (existing) {
      Object.assign(existing, item);
    } else {
      incomeById.set(item.id, {
        ...item,
        amount: Number(item.amount || 0),
        status: item.status === 'pendiente' ? 'pendiente' : 'recibido',
        date: item.date || ''
      });
    }
  });
  const unifiedList = Array.from(incomeById.values());
  state.incomes = unifiedList;
  state.sources = unifiedList;

  state.envelopes.forEach((env) => {
    if (!env.id) env.id = uid();
    if (env.baseAmount === undefined) {
      env.baseAmount = Number(env.amount ?? env.initialAmount ?? 0);
    } else {
      env.baseAmount = Number(env.baseAmount || 0);
    }
    if (env.bank === undefined) env.bank = '';
    if (env.description === undefined) env.description = '';
    if (!env.color) env.color = '#3b82f6';
    if (!env.icon) env.icon = 'compass';
    env.targetAmount = Number(env.targetAmount || 0);
    env.spendingLimit = Number(env.spendingLimit || 0);
    env.startDate = env.startDate || '';
    env.endDate = env.endDate || '';
    if (!Array.isArray(env.associatedCategories)) env.associatedCategories = [];
  });

  state.categories.forEach((cat) => {
    if (!cat.id) cat.id = uid();
    if (!cat.color) cat.color = '#3b82f6';
    cat.budget = Number(cat.budget || 0);
    cat.spendingLimit = Number(cat.spendingLimit || 0);
    cat.periodType = cat.periodType || '';
    cat.startDate = cat.startDate || '';
    cat.endDate = cat.endDate || '';
    cat.envelopeId = cat.envelopeId || '';
  });

  state.budgets.forEach((b) => {
    if (!b.id) b.id = uid();
    b.name = b.name || 'Presupuesto';
    b.description = b.description || '';
    b.targetAmount = Number(b.targetAmount || 0);
    b.spendingLimit = Number(b.spendingLimit || 0);
    b.startDate = b.startDate || '';
    b.endDate = b.endDate || '';
    if (!Array.isArray(b.categories)) b.categories = [];
    b.reservedAmount = Number(b.reservedAmount || 0);
    b.envelopeId = b.envelopeId || '';
    if (!b.color) b.color = '#3b82f6';
  });

  state.periodLimits.forEach((pl) => {
    if (!pl.id) pl.id = uid();
    pl.name = pl.name || 'Límite por periodo';
    pl.periodType = pl.periodType || 'mensual';
    pl.amount = Number(pl.amount || 0);
    pl.startDate = pl.startDate || '';
    pl.endDate = pl.endDate || '';
    pl.rolloverUnused = !!pl.rolloverUnused;
    pl.carriedOverAmount = Number(pl.carriedOverAmount || 0);
    pl.envelopeId = pl.envelopeId || '';
    pl.category = pl.category || '';
    pl.alertThreshold = Number(pl.alertThreshold || 80);
    if (!Array.isArray(pl.history)) pl.history = [];
  });

  state.reserves.forEach((r) => {
    if (!r.id) r.id = uid();
    r.name = r.name || 'Reserva';
    r.amount = Math.max(0, Number(r.amount || 0));
    r.initialAmount = Number(r.initialAmount ?? r.amount ?? 0);
    r.usedAmount = Number(r.usedAmount || 0);
    r.releasedAmount = Number(r.releasedAmount || 0);
    r.envelopeId = r.envelopeId || '';
    r.budgetId = r.budgetId || '';
    r.category = r.category || '';
    r.date = r.date || '';
    if (!Array.isArray(r.usages)) r.usages = [];
  });
}
ensureEnvelopes();

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
const db = (_supabaseReady && window.supabase) ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
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
    ensureEnvelopes();
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
      ensureEnvelopes();
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

/* ============================================================
   SYNC MANAGER (OFFLINE-FIRST & CLOUD SYNC ENGINE)
   ============================================================ */
const SyncManager = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isSyncing: false,
  pendingChanges: false,
  _activeUser: null,
  _isGuest: false,

  init() {
    this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this._readPendingMeta();

    window.addEventListener('online', () => {
      this.isOnline = true;
      this.updateUI();
      toast('Conexión restablecida — Sincronizando datos con la nube...', 2800);
      this.syncPending();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.updateUI();
      toast('Estás sin conexión — Tus cambios se guardarán en este equipo', 3200);
    });

    // Vincular botones interactivos de sincronización manual
    document.getElementById('sync-now-btn-sidebar')?.addEventListener('click', () => {
      this.forceSync();
    });

    document.getElementById('sync-status-mobile')?.addEventListener('click', () => {
      this.forceSync();
    });

    this.updateUI();
  },

  setUser(user, isGuest = false) {
    this._activeUser = user;
    this._isGuest = isGuest;
    this._readPendingMeta();
    this.updateUI();
  },

  _getMetaKey() {
    const uid = this._activeUser?.uid || (this._isGuest ? 'guest' : 'default');
    return `bf_sync_meta_${uid}`;
  },

  _readPendingMeta() {
    try {
      const data = localStorage.getItem(this._getMetaKey());
      if (data) {
        const parsed = JSON.parse(data);
        this.pendingChanges = !!parsed.pending;
      } else {
        this.pendingChanges = false;
      }
    } catch (_) {
      this.pendingChanges = false;
    }
  },

  _setPendingMeta(isPending) {
    this.pendingChanges = isPending;
    try {
      localStorage.setItem(this._getMetaKey(), JSON.stringify({
        pending: isPending,
        updatedAt: new Date().toISOString()
      }));
    } catch (_) {}
    this.updateUI();
  },

  markDirty() {
    this._setPendingMeta(true);
  },

  updateUI() {
    const dotSidebar = document.getElementById('sync-dot-sidebar');
    const titleSidebar = document.getElementById('sync-title-sidebar');
    const descSidebar = document.getElementById('sync-desc-sidebar');
    const btnSidebar = document.getElementById('sync-now-btn-sidebar');

    const dotMobile = document.getElementById('sync-dot-mobile');
    const textMobile = document.getElementById('sync-text-mobile');
    const pillMobile = document.getElementById('sync-status-mobile');

    let dotClass = 'online';
    let title = 'Sincronizado';
    let desc = 'Todo al día en la nube';
    let mobileText = 'En línea';

    if (this.isSyncing) {
      dotClass = 'syncing';
      title = 'Sincronizando...';
      desc = 'Subiendo cambios a la nube';
      mobileText = 'Sincronizando';
    } else if (!this.isOnline) {
      dotClass = 'offline';
      title = this._isGuest ? 'Modo Local' : 'Sin conexión';
      desc = this.pendingChanges ? 'Cambios guardados en este equipo' : 'Operando sin internet';
      mobileText = this.pendingChanges ? 'Guardado local' : 'Sin red';
    } else if (this._isGuest) {
      dotClass = 'offline';
      title = 'Modo Local';
      desc = 'Tus datos están en este equipo';
      mobileText = 'Local';
    } else if (this.pendingChanges) {
      dotClass = 'offline';
      title = 'Pendiente de subir';
      desc = 'Pulsa para subir a la nube';
      mobileText = 'Pendiente';
    }

    // Actualizar sidebar (desktop)
    if (dotSidebar) dotSidebar.className = `sync-dot ${dotClass}`;
    if (titleSidebar) titleSidebar.textContent = title;
    if (descSidebar) descSidebar.textContent = desc;
    if (btnSidebar) {
      if (this.isSyncing) btnSidebar.classList.add('spinning');
      else btnSidebar.classList.remove('spinning');
    }

    // Actualizar topbar (mobile)
    if (dotMobile) dotMobile.className = `sync-dot ${dotClass}`;
    if (textMobile) textMobile.textContent = mobileText;
    if (pillMobile) {
      if (this.isSyncing) pillMobile.classList.add('spinning');
      else pillMobile.classList.remove('spinning');
    }
  },

  async syncPending() {
    if (!this.isOnline || this.isSyncing || this._isGuest) return;
    if (!window.FBAuth || !window.FBAuth.currentUser) return;

    this.isSyncing = true;
    this.updateUI();

    const uid = window.FBAuth.currentUser.uid;
    try {
      const payload = { ...state, _deviceId };
      const ok = await window.FBAuth.saveUserState(uid, payload);
      if (ok) {
        this._setPendingMeta(false);
        toast('¡Todo sincronizado con la nube!', 2200);
      }
    } catch (err) {
      console.warn('SyncManager: error en sincronización:', err);
    } finally {
      this.isSyncing = false;
      this.updateUI();
    }
  },

  async forceSync() {
    if (!this.isOnline) {
      toast('No hay conexión a internet actualmente. Los cambios están guardados en tu equipo.', 3200);
      return;
    }
    if (this._isGuest) {
      toast('Estás en Modo Local. Para guardar en la nube, inicia sesión en Seguridad.', 3500);
      return;
    }
    toast('Sincronizando con la nube...', 1400);
    await this.syncPending();
  }
};

/** Guarda inmediatamente en localStorage (offline-first) y sincroniza con Firestore/Supabase. */
function save() {
  state.lastModifiedAt = new Date().toISOString();

  // 1. Persistencia local inmediata (cero latencia, offline garantizado)
  if (window.FBAuth && window.FBAuth.currentUser) {
    const uid = window.FBAuth.currentUser.uid;
    localStorage.setItem('budget_state_' + uid, JSON.stringify(state));
  } else if (localStorage.getItem('bf_guest_mode') === 'true') {
    localStorage.setItem('budget_state_local', JSON.stringify(state));
  } else {
    localStorage.setItem('budget_state', JSON.stringify(state));
  }

  // 2. Marcar cambios pendientes en metadata de sincronización
  SyncManager.markDirty();

  // 3. Si hay red y usuario autenticado en Firebase, subir a Firestore en background
  if (SyncManager.isOnline && window.FBAuth && window.FBAuth.isConfigured() && window.FBAuth.currentUser) {
    const uid = window.FBAuth.currentUser.uid;
    window.FBAuth.saveUserState(uid, { ...state, _deviceId }).then((ok) => {
      if (ok) {
        SyncManager._setPendingMeta(false);
      }
    }).catch((err) => {
      console.warn('BudgetFlow: Guardado diferido por error de red:', err?.message);
    });
    return;
  }

  // Fallback a Supabase si aplica
  if (db && SyncManager.isOnline) {
    const payload = { ...state, _deviceId };
    db.from('budget_state')
      .update({ data: payload, updated_at: new Date().toISOString() })
      .eq('id', STATE_ROW_ID)
      .then(({ error }) => {
        if (!error) {
          SyncManager._setPendingMeta(false);
        } else {
          console.warn('BudgetFlow: error al sincronizar con Supabase:', error);
        }
      });
  }
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
  _buildCsel('filter-category', { isCategory: true });
  _buildCsel('filter-income-envelope', {});
  _buildCsel('filter-income-status', { isStatus: true });

  $('filter-envelope')?.addEventListener('change', () => {
    _refreshCsel('filter-envelope');
    renderExpensesList();
  });
  $('filter-category')?.addEventListener('change', () => {
    _refreshCsel('filter-category');
    renderExpensesList();
  });
  $('filter-income-envelope')?.addEventListener('change', () => {
    _refreshCsel('filter-income-envelope');
    renderSources();
  });
  $('filter-income-status')?.addEventListener('change', () => {
    _refreshCsel('filter-income-status');
    renderSources();
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
  const fcEl = $('filter-category');
  const fieEl = $('filter-income-envelope');
  const fisEl = $('filter-income-status');

  const envOptions = `<option value="">Todos los sobres</option>` +
    (state.envelopes || []).map((e) => `<option value="${e.id}">${e.name}${e.bank ? ` (${e.bank})` : ''}</option>`).join('');

  const catOptions = `<option value="">Todas las categorías</option>` +
    (state.categories || []).map((c) => `<option value="${c.name}">${c.name}</option>`).join('');

  if (feEl) {
    const curEnv = feEl.value;
    feEl.innerHTML = envOptions;
    if (curEnv) feEl.value = curEnv;
    _refreshCsel('filter-envelope');
  }

  if (fcEl) {
    const curCat = fcEl.value;
    fcEl.innerHTML = catOptions;
    if (curCat) fcEl.value = curCat;
    _refreshCsel('filter-category');
  }

  if (fieEl) {
    const curEnv = fieEl.value;
    fieEl.innerHTML = envOptions;
    if (curEnv) fieEl.value = curEnv;
    _refreshCsel('filter-income-envelope');
  }

  if (fisEl) {
    _refreshCsel('filter-income-status');
  }
}

/* ============================================================
   DOMAIN LOGIC & UNIFIED FINANCIAL ENGINE
   ============================================================ */

function isDateInRange(dateStr, startDate, endDate) {
  if (!startDate && !endDate) return true;
  if (!dateStr) return false;
  if (startDate && dateStr < startDate) return false;
  if (endDate && dateStr > endDate) return false;
  return true;
}

function isTransferMovement(item) {
  if (!item) return false;
  if (item.isTransfer) return true;
  const text = String(item.desc || item.description || item.name || '');
  return /^Transferencia (a|desde) /i.test(text);
}

function getUnifiedIncomes() {
  const map = new Map();
  [...(state.incomes || []), ...(state.sources || [])].forEach((inc) => {
    if (!inc || typeof inc !== 'object') return;
    if (!inc.id) inc.id = uid();
    if (!map.has(inc.id)) {
      map.set(inc.id, {
        ...inc,
        amount: Number(inc.amount || 0),
        status: inc.status === 'pendiente' ? 'pendiente' : 'recibido'
      });
    } else {
      Object.assign(map.get(inc.id), inc, {
        amount: Number(inc.amount || 0),
        status: inc.status === 'pendiente' ? 'pendiente' : 'recibido'
      });
    }
  });
  return Array.from(map.values());
}

function computePeriodEndDate(startDateStr, periodType) {
  if (!startDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(startDateStr)) return '';
  const [y, m, d] = startDateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (isNaN(dt.getTime())) return '';

  switch (periodType) {
    case 'dia':
    case 'diario':
      return startDateStr;
    case 'semana':
    case 'semanal':
      dt.setUTCDate(dt.getUTCDate() + 6);
      return dt.toISOString().slice(0, 10);
    case 'quincena':
    case 'quincenal':
      dt.setUTCDate(dt.getUTCDate() + 14);
      return dt.toISOString().slice(0, 10);
    case 'mes':
    case 'mensual': {
      const nextMonth = new Date(Date.UTC(y, m, d));
      nextMonth.setUTCDate(nextMonth.getUTCDate() - 1);
      return nextMonth.toISOString().slice(0, 10);
    }
    default:
      return '';
  }
}

function sourceTotals(source) {
  const assigned   = Object.values(source.distribution || {}).reduce((a, b) => a + Number(b || 0), 0);
  const spent      = (state.expenses || []).filter((e) => e.sourceId === source.id).reduce((a, b) => a + Number(b.amount), 0);
  const amount     = Number(source.amount || 0);
  return { assigned, spent, unassigned: amount - assigned, available: amount - spent };
}

function getCategoryStats(catOrName) {
  const catObj = typeof catOrName === 'string'
    ? (state.categories || []).find((c) => c.name === catOrName) || { name: catOrName, color: '#64748b', budget: 0, spendingLimit: 0, periodType: '', startDate: '', endDate: '' }
    : catOrName;

  const name = catObj.name;
  const assignedFromSources = (state.sources || []).reduce((sum, s) => sum + Number((s.distribution && s.distribution[name]) || 0), 0);
  const directBudget = Number(catObj.budget || 0);
  const effectiveBudget = directBudget > 0 ? directBudget : assignedFromSources;
  const spendingLimit = Number(catObj.spendingLimit || 0);

  const allCatExpenses = (state.expenses || []).filter((e) => e.category === name && !isTransferMovement(e));
  const periodExpenses = allCatExpenses.filter((e) => isDateInRange(e.date, catObj.startDate, catObj.endDate));

  const spent = periodExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const spentAllTime = allCatExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const cap = effectiveBudget > 0 ? effectiveBudget : (spendingLimit > 0 ? spendingLimit : 0);
  const remaining = cap > 0 ? (cap - spent) : -spent;
  const limitRemaining = spendingLimit > 0 ? (spendingLimit - spent) : null;
  const rawPct = cap > 0 ? (spent / cap) * 100 : 0;
  const pct = Math.min(100, Math.max(0, rawPct));
  const rawLimitPct = spendingLimit > 0 ? (spent / spendingLimit) * 100 : 0;

  return {
    category: catObj,
    name,
    color: catObj.color || '#64748b',
    directBudget,
    assignedFromSources,
    effectiveBudget,
    spendingLimit,
    cap,
    spent,
    spentAllTime,
    remaining,
    limitRemaining,
    pct,
    rawPct,
    rawLimitPct,
    isNearLimit: (rawPct >= 80 && rawPct <= 100) || (rawLimitPct >= 80 && rawLimitPct <= 100),
    isOverLimit: (cap > 0 && spent > cap) || (spendingLimit > 0 && spent > spendingLimit),
    periodType: catObj.periodType || '',
    startDate: catObj.startDate || '',
    endDate: catObj.endDate || ''
  };
}

function categoryMap() {
  const map = {};
  (state.categories || []).forEach((c) => {
    const stats = getCategoryStats(c);
    map[c.name] = {
      ...stats,
      assigned: stats.effectiveBudget,
      bySource: {}
    };
  });
  (state.sources || []).forEach((s) => {
    Object.entries(s.distribution || {}).forEach(([cat, amount]) => {
      if (!map[cat]) {
        const stats = getCategoryStats(cat);
        map[cat] = { ...stats, assigned: stats.effectiveBudget, bySource: {} };
      }
      map[cat].bySource[s.id] = { sourceId: s.id, sourceName: s.name, assigned: Number(amount || 0), spent: 0 };
    });
  });
  (state.expenses || []).forEach((e) => {
    if (!e.category) return;
    if (!map[e.category]) {
      const stats = getCategoryStats(e.category);
      map[e.category] = { ...stats, assigned: stats.effectiveBudget, bySource: {} };
    }
    if (e.sourceId) {
      if (!map[e.category].bySource[e.sourceId]) {
        const src = (state.sources || []).find((s) => s.id === e.sourceId) || (state.envelopes || []).find((env) => env.id === e.sourceId);
        map[e.category].bySource[e.sourceId] = { sourceId: e.sourceId, sourceName: src?.name || 'Origen', assigned: 0, spent: 0 };
      }
      map[e.category].bySource[e.sourceId].spent += Number(e.amount || 0);
    }
  });
  return map;
}

function getBudgetTotals(budgetOrId) {
  const b = typeof budgetOrId === 'string'
    ? (state.budgets || []).find((x) => x.id === budgetOrId)
    : budgetOrId;
  if (!b) {
    return {
      targetAmount: 0, spendingLimit: 0, spent: 0, reserved: 0,
      remainingBudget: 0, limitRemaining: null, pctGoal: 0, pctLimit: 0,
      isNearLimit: false, isOverLimit: false
    };
  }

  const targetAmount = Number(b.targetAmount || 0);
  const spendingLimit = Number(b.spendingLimit || 0);
  const assocCats = Array.isArray(b.categories) ? b.categories : [];

  const matchingExpenses = (state.expenses || []).filter((e) => {
    if (isTransferMovement(e)) return false;
    if (!isDateInRange(e.date, b.startDate, b.endDate)) return false;
    if (e.budgetId && e.budgetId === b.id) return true;
    if (assocCats.length > 0 && e.category && assocCats.includes(e.category)) {
      if (b.envelopeId) return e.envelopeId === b.envelopeId;
      return true;
    }
    if (!assocCats.length && b.envelopeId && e.envelopeId === b.envelopeId) return true;
    return false;
  });

  const spent = matchingExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const linkedReserves = (state.reserves || []).filter((r) => r.budgetId === b.id);
  const reserved = linkedReserves.length > 0
    ? linkedReserves.reduce((sum, r) => sum + Number(r.amount || 0), 0)
    : Number(b.reservedAmount || 0);

  const baseCap = targetAmount > 0 ? targetAmount : spendingLimit;
  const remainingBudget = baseCap > 0 ? (baseCap - spent - reserved) : -spent;
  const limitRemaining = spendingLimit > 0 ? (spendingLimit - spent) : null;

  let goalProgressAmount = spent + reserved;
  if (b.envelopeId && !assocCats.length && spendingLimit === 0 && targetAmount > 0) {
    const envT = getEnvelopeTotals(b.envelopeId);
    goalProgressAmount = Math.max(goalProgressAmount, envT.totalBalance);
  }

  const rawGoalPct = targetAmount > 0 ? (goalProgressAmount / targetAmount) * 100 : 0;
  const pctGoal = Math.min(100, Math.max(0, rawGoalPct));
  const rawLimitPct = spendingLimit > 0 ? (spent / spendingLimit) * 100 : (targetAmount > 0 ? (spent / targetAmount) * 100 : 0);
  const pctLimit = Math.min(100, Math.max(0, rawLimitPct));

  return {
    targetAmount,
    spendingLimit,
    spent,
    reserved,
    baseCap,
    remainingBudget,
    limitRemaining,
    goalProgressAmount,
    pctGoal,
    rawGoalPct,
    pctLimit,
    rawLimitPct,
    isNearLimit: rawLimitPct >= 80 && rawLimitPct <= 100,
    isOverLimit: (spendingLimit > 0 && spent > spendingLimit) || (baseCap > 0 && (spent + reserved) > baseCap)
  };
}

function getPeriodLimitStats(limitOrId) {
  const pl = typeof limitOrId === 'string'
    ? (state.periodLimits || []).find((x) => x.id === limitOrId)
    : limitOrId;
  if (!pl) {
    return {
      baseLimit: 0, carriedOver: 0, effectiveLimit: 0, spent: 0, remaining: 0,
      pctUsed: 0, rawPct: 0, alertState: 'ok', history: []
    };
  }

  const baseLimit = Number(pl.amount || 0);
  const carriedOver = pl.rolloverUnused ? Number(pl.carriedOverAmount || 0) : 0;
  const effectiveLimit = baseLimit + carriedOver;

  const matchingExpenses = (state.expenses || []).filter((e) => {
    if (isTransferMovement(e)) return false;
    if (!isDateInRange(e.date, pl.startDate, pl.endDate)) return false;
    if (pl.envelopeId && e.envelopeId !== pl.envelopeId) return false;
    if (pl.category && e.category !== pl.category) return false;
    return true;
  });

  const spent = matchingExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const remaining = effectiveLimit - spent;
  const rawPct = effectiveLimit > 0 ? (spent / effectiveLimit) * 100 : 0;
  const pctUsed = Math.min(100, Math.max(0, rawPct));
  const threshold = Number(pl.alertThreshold || 80);

  let alertState = 'ok';
  if (effectiveLimit > 0 && spent > effectiveLimit) {
    alertState = 'danger';
  } else if (effectiveLimit > 0 && rawPct >= threshold) {
    alertState = 'warn';
  }

  return {
    baseLimit,
    carriedOver,
    effectiveLimit,
    spent,
    remaining,
    pctUsed,
    rawPct,
    threshold,
    alertState,
    isNearLimit: alertState === 'warn',
    isOverLimit: alertState === 'danger',
    history: Array.isArray(pl.history) ? pl.history : []
  };
}

function getGlobalFinancialSummary() {
  const envelopes = state.envelopes || [];
  const allIncomes = getUnifiedIncomes();
  const allExpenses = state.expenses || [];
  const reserves = state.reserves || [];
  const categories = state.categories || [];
  const budgets = state.budgets || [];
  const periodLimits = state.periodLimits || [];

  const totalBase = envelopes.reduce((sum, e) => sum + Number(e.baseAmount || 0), 0);

  const receivedIncomesTotal = allIncomes
    .filter((i) => !isTransferMovement(i) && (i.status === 'recibido' || !i.status))
    .reduce((sum, i) => sum + Number(i.amount || 0), 0);

  const projectedIncomesTotal = allIncomes
    .filter((i) => !isTransferMovement(i) && i.status === 'pendiente')
    .reduce((sum, i) => sum + Number(i.amount || 0), 0);

  const totalSpent = allExpenses
    .filter((e) => !isTransferMovement(e))
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const totalReserved = reserves.reduce((sum, r) => sum + Math.max(0, Number(r.amount || 0)), 0);

  const totalMoney = totalBase + receivedIncomesTotal - totalSpent;
  const availableMoney = totalMoney - totalReserved;

  // Presupuesto restante (de presupuestos personalizados y categorías con presupuesto)
  let totalBudgeted = 0;
  let totalBudgetUsed = 0;

  if (budgets.length > 0) {
    budgets.forEach((b) => {
      const bt = getBudgetTotals(b);
      if (bt.baseCap > 0) {
        totalBudgeted += bt.baseCap;
        totalBudgetUsed += (bt.spent + bt.reserved);
      }
    });
  }

  categories.forEach((c) => {
    const cs = getCategoryStats(c);
    if (cs.cap > 0) {
      // Evitar duplicar si un presupuesto personalizado ya envuelve exclusivamente esta categoría
      const coveredByCustomBudget = budgets.some((b) => Array.isArray(b.categories) && b.categories.includes(c.name) && (b.targetAmount > 0 || b.spendingLimit > 0));
      if (!coveredByCustomBudget) {
        totalBudgeted += cs.cap;
        totalBudgetUsed += cs.spent;
      }
    }
  });

  const remainingBudget = totalBudgeted > 0 ? (totalBudgeted - totalBudgetUsed) : availableMoney;

  // Progreso de objetivos financieros (en sobres y presupuestos personalizados)
  let goalsCount = 0;
  let totalGoalTarget = 0;
  let totalGoalCurrent = 0;

  envelopes.forEach((env) => {
    const target = Number(env.targetAmount || 0);
    if (target > 0) {
      goalsCount++;
      totalGoalTarget += target;
      const et = getEnvelopeTotals(env);
      totalGoalCurrent += Math.max(0, et.totalBalance);
    }
  });

  budgets.forEach((b) => {
    const target = Number(b.targetAmount || 0);
    if (target > 0) {
      goalsCount++;
      totalGoalTarget += target;
      const bt = getBudgetTotals(b);
      totalGoalCurrent += Math.max(0, bt.goalProgressAmount);
    }
  });

  const goalsPct = totalGoalTarget > 0 ? Math.min(100, Math.max(0, (totalGoalCurrent / totalGoalTarget) * 100)) : 0;

  // Límites de gasto activos y alertas
  let activeLimitsCount = 0;
  let nearLimitsCount = 0;
  let overLimitsCount = 0;
  let totalPeriodLimitCap = 0;
  let totalPeriodLimitSpent = 0;

  periodLimits.forEach((pl) => {
    const st = getPeriodLimitStats(pl);
    if (st.effectiveLimit > 0) {
      activeLimitsCount++;
      totalPeriodLimitCap += st.effectiveLimit;
      totalPeriodLimitSpent += st.spent;
      if (st.isOverLimit) overLimitsCount++;
      else if (st.isNearLimit) nearLimitsCount++;
    }
  });

  categories.forEach((c) => {
    const cs = getCategoryStats(c);
    if (cs.spendingLimit > 0) {
      activeLimitsCount++;
      if (cs.isOverLimit) overLimitsCount++;
      else if (cs.isNearLimit) nearLimitsCount++;
    }
  });

  budgets.forEach((b) => {
    const bt = getBudgetTotals(b);
    if (bt.spendingLimit > 0) {
      activeLimitsCount++;
      if (bt.isOverLimit) overLimitsCount++;
      else if (bt.isNearLimit) nearLimitsCount++;
    }
  });

  envelopes.forEach((env) => {
    const et = getEnvelopeTotals(env);
    if (et.spendingLimit > 0) {
      activeLimitsCount++;
      if (et.spentInPeriod > et.spendingLimit) overLimitsCount++;
      else if (et.pctLimit >= 80) nearLimitsCount++;
    }
  });

  return {
    totalBase,
    receivedIncomesTotal,
    projectedIncomesTotal,
    totalSpent,
    totalReserved,
    totalMoney,
    availableMoney,
    totalBudgeted,
    totalBudgetUsed,
    remainingBudget,
    goalsCount,
    totalGoalTarget,
    totalGoalCurrent,
    goalsPct,
    activeLimitsCount,
    nearLimitsCount,
    overLimitsCount,
    totalPeriodLimitCap,
    totalPeriodLimitSpent
  };
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

  const activeNavTab = tab === 'envelope-detail' ? 'dashboard' : tab;
  $$(`[data-tab="${activeNavTab}"]`).forEach((el) => el.classList.add('active'));

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
   Formula: Total = Base + Ingresos Recibidos - Gastos
            Disponible = Total - Reservado
   ============================================================ */

function getEnvelopeTotals(envOrId) {
  const env = typeof envOrId === 'string' ? (state.envelopes || []).find((e) => e.id === envOrId) : envOrId;
  if (!env) {
    return {
      base: 0, incomes: 0, projected: 0, spent: 0, spentInPeriod: 0,
      reserved: 0, totalFunds: 0, totalBalance: 0, available: 0,
      targetAmount: 0, spendingLimit: 0, pctSpent: 0, pctGoal: 0, pctLimit: 0
    };
  }

  const base = Number(env.baseAmount ?? env.initialAmount ?? env.amount ?? 0);
  const allIncomes = getUnifiedIncomes();

  const envIncomes = allIncomes
    .filter((i) => (i.envelopeId === env.id || i.envelope === env.name) && (i.status === 'recibido' || !i.status))
    .reduce((sum, i) => sum + Number(i.amount || 0), 0);

  const projected = allIncomes
    .filter((i) => (i.envelopeId === env.id || i.envelope === env.name) && i.status === 'pendiente')
    .reduce((sum, i) => sum + Number(i.amount || 0), 0);

  const envExpenses = (state.expenses || [])
    .filter((e) => e.envelopeId === env.id || e.envelope === env.name || e.sourceId === env.id);

  const spent = envExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const spentInPeriod = envExpenses
    .filter((e) => isDateInRange(e.date, env.startDate, env.endDate))
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const reserved = (state.reserves || [])
    .filter((r) => r.envelopeId === env.id)
    .reduce((sum, r) => sum + Math.max(0, Number(r.amount || 0)), 0);

  const totalFunds = base + envIncomes;
  const totalBalance = totalFunds - spent;
  const available = totalBalance - reserved;

  const targetAmount = Number(env.targetAmount || 0);
  const spendingLimit = Number(env.spendingLimit || 0);

  const pctSpent = totalFunds > 0 ? Math.min(100, Math.max(0, (spent / totalFunds) * 100)) : 0;
  const pctGoal = targetAmount > 0 ? Math.min(100, Math.max(0, (Math.max(0, totalBalance) / targetAmount) * 100)) : 0;
  const pctLimit = spendingLimit > 0 ? Math.min(100, Math.max(0, (spentInPeriod / spendingLimit) * 100)) : 0;

  return {
    base,
    incomes: envIncomes,
    projected,
    spent,
    spentInPeriod,
    reserved,
    totalFunds,
    totalBalance,
    available,
    targetAmount,
    spendingLimit,
    pctSpent,
    pctGoal,
    pctLimit
  };
}

function getEnvelopeIconSVG(iconName, color = 'currentColor', size = 16) {
  switch (iconName) {
    case 'wallet':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>`;
    case 'tool':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
    case 'camera':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
    case 'car':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`;
    case 'heart':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`;
    case 'shield':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    case 'lock':
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
    case 'compass':
    default:
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`;
  }
}

/* ============================================================
   INDICADORES FINANCIEROS GLOBALES (KPIs)
   ============================================================ */

function renderFinancialKPIs() {
  const s = getGlobalFinancialSummary();

  const totalWealthEl = $('total-wealth-val');
  const availWealthEl = $('available-wealth-val');
  const totalWealthPatEl = $('total-wealth-val-patrimonio');
  const availWealthPatEl = $('available-wealth-val-patrimonio');

  if (totalWealthEl) totalWealthEl.textContent = money(s.totalMoney);
  if (availWealthEl) availWealthEl.textContent = money(s.availableMoney);
  if (totalWealthPatEl) totalWealthPatEl.textContent = money(s.totalMoney);
  if (availWealthPatEl) availWealthPatEl.textContent = money(s.availableMoney);

  const limitsSubText = s.activeLimitsCount === 0
    ? 'Sin límites configurados'
    : (s.overLimitsCount > 0
      ? `${s.overLimitsCount} excedido(s) · ${s.activeLimitsCount} activo(s)`
      : (s.nearLimitsCount > 0
        ? `${s.nearLimitsCount} cerca del tope · ${s.activeLimitsCount} activo(s)`
        : `${s.activeLimitsCount} límite(s) dentro del rango`));

  const limitsValueText = s.totalPeriodLimitCap > 0
    ? `${money(s.totalPeriodLimitCap - s.totalPeriodLimitSpent)} disp.`
    : `${s.activeLimitsCount} activos`;

  const goalsValueText = s.goalsCount > 0
    ? `${Math.round(s.goalsPct)}%`
    : 'Sin metas';

  const goalsSubText = s.goalsCount > 0
    ? `${money(s.totalGoalCurrent)} de ${money(s.totalGoalTarget)}`
    : 'Configura un objetivo en sobres o presupuestos';

  const kpiCardsHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Dinero Total</div>
      <div class="kpi-value">${money(s.totalMoney)}</div>
      <div class="kpi-sub">Fondos reales acumulados</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Dinero Disponible</div>
      <div class="kpi-value" style="color:${s.availableMoney < 0 ? 'var(--danger)' : 'var(--success)'}">${money(s.availableMoney)}</div>
      <div class="kpi-sub">Libre para gastar (sin reservas)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Dinero Reservado</div>
      <div class="kpi-value">${money(s.totalReserved)}</div>
      <div class="kpi-sub">${(state.reserves || []).filter((r) => r.amount > 0).length} reserva(s) activa(s)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Dinero Gastado</div>
      <div class="kpi-value" style="color:var(--danger)">${money(s.totalSpent)}</div>
      <div class="kpi-sub">${(state.expenses || []).filter((e) => !isTransferMovement(e)).length} movimiento(s)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Presupuesto Restante</div>
      <div class="kpi-value" style="color:${s.remainingBudget < 0 ? 'var(--danger)' : 'var(--text)'}">${money(s.remainingBudget)}</div>
      <div class="kpi-sub">${s.totalBudgeted > 0 ? `De ${money(s.totalBudgeted)} presupuestado` : 'Saldo libre general'}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Progreso de Objetivos</div>
      <div class="kpi-value">${goalsValueText}</div>
      <div class="kpi-sub">${goalsSubText}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Límites de Gasto</div>
      <div class="kpi-value" style="color:${s.overLimitsCount > 0 ? 'var(--danger)' : (s.nearLimitsCount > 0 ? 'var(--warn)' : 'var(--text)')}">${limitsValueText}</div>
      <div class="kpi-sub">${limitsSubText}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Ingresos Proyectados</div>
      <div class="kpi-value" style="color:${s.projectedIncomesTotal > 0 ? 'var(--warn)' : 'var(--text-2)'}">${money(s.projectedIncomesTotal)}</div>
      <div class="kpi-sub">Pendientes (no sumados al disponible)</div>
    </div>
  `;

  const dashKpis = $('dashboard-kpis');
  if (dashKpis) dashKpis.innerHTML = kpiCardsHTML;

  const patKpis = $('patrimonio-kpis');
  if (patKpis) patKpis.innerHTML = kpiCardsHTML;

  const incKpis = $('incomes-kpis');
  if (incKpis) {
    const allInc = getUnifiedIncomes().filter((i) => !isTransferMovement(i));
    const recCount = allInc.filter((i) => i.status === 'recibido' || !i.status).length;
    const pendCount = allInc.filter((i) => i.status === 'pendiente').length;
    incKpis.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label">Ingresos Recibidos</div>
        <div class="kpi-value" style="color:var(--success)">${money(s.receivedIncomesTotal)}</div>
        <div class="kpi-sub">${recCount} confirmado(s) en saldo real</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Ingresos Proyectados</div>
        <div class="kpi-value" style="color:var(--warn)">${money(s.projectedIncomesTotal)}</div>
        <div class="kpi-sub">${pendCount} pendiente(s) por recibir</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Dinero Disponible Real</div>
        <div class="kpi-value">${money(s.availableMoney)}</div>
        <div class="kpi-sub">Excluye pendientes y reservas</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Dinero Total Actual</div>
        <div class="kpi-value">${money(s.totalMoney)}</div>
        <div class="kpi-sub">Incluyendo ${money(s.totalReserved)} reservado</div>
      </div>
    `;
  }

  const expKpis = $('expenses-kpis');
  if (expKpis) {
    expKpis.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label">Dinero Gastado</div>
        <div class="kpi-value" style="color:var(--danger)">${money(s.totalSpent)}</div>
        <div class="kpi-sub">${(state.expenses || []).filter((e) => !isTransferMovement(e)).length} gasto(s) registrado(s)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Presupuesto Restante</div>
        <div class="kpi-value" style="color:${s.remainingBudget < 0 ? 'var(--danger)' : 'var(--success)'}">${money(s.remainingBudget)}</div>
        <div class="kpi-sub">${s.totalBudgeted > 0 ? `De ${money(s.totalBudgeted)} asignado` : 'Sobre saldo disponible'}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Dinero Disponible</div>
        <div class="kpi-value">${money(s.availableMoney)}</div>
        <div class="kpi-sub">Libre para gastar hoy</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Control de Límites</div>
        <div class="kpi-value" style="color:${s.overLimitsCount > 0 ? 'var(--danger)' : (s.nearLimitsCount > 0 ? 'var(--warn)' : 'var(--text)')}">${limitsValueText}</div>
        <div class="kpi-sub">${limitsSubText}</div>
      </div>
    `;
  }
}

/* ============================================================
   PATRIMONIO TOTAL & INTERACTIVE SEGMENTED BAR
   ============================================================ */

function renderPatrimonioBar() {
  renderFinancialKPIs();

  const barEl = $('patrimonio-bar');
  const legendEl = $('patrimonio-legend');
  const summaryTextEl = $('patrimonio-summary-text');

  const envelopes = state.envelopes || [];
  let totalPositiveWealth = 0;

  const envStats = envelopes.map((env) => {
    const t = getEnvelopeTotals(env);
    if (t.totalBalance > 0) totalPositiveWealth += t.totalBalance;
    return { env, ...t };
  });

  if (summaryTextEl) {
    const activeReserves = (state.reserves || []).filter((r) => r.amount > 0).length;
    summaryTextEl.textContent = `${envelopes.length} ${envelopes.length === 1 ? 'sobre' : 'sobres'} · ${activeReserves} ${activeReserves === 1 ? 'reserva activa' : 'reservas activas'}`;
  }

  if (!barEl) return;

  if (!envelopes.length || totalPositiveWealth <= 0) {
    const globalSummary = getGlobalFinancialSummary();
    if (globalSummary.totalMoney > 0) {
      const availPct = Math.max(0, Math.min(100, (globalSummary.availableMoney / globalSummary.totalMoney) * 100));
      const resPct = Math.max(0, Math.min(100, (globalSummary.totalReserved / globalSummary.totalMoney) * 100));
      barEl.innerHTML = `
        ${availPct > 0 ? `<div class="patrimonio-segment" style="width:${availPct}%;background:#10b981" title="Disponible libre: ${money(globalSummary.availableMoney)}"></div>` : ''}
        ${resPct > 0 ? `<div class="patrimonio-segment" style="width:${resPct}%;background:#f59e0b" title="Reservado: ${money(globalSummary.totalReserved)}"></div>` : ''}
      `;
      if (legendEl) {
        legendEl.innerHTML = `
          <div class="patrimonio-legend-item">
            <span class="patrimonio-legend-dot" style="background:#10b981"></span>
            <span class="patrimonio-legend-name">Disponible libre</span>
            <span class="patrimonio-legend-amount">${money(globalSummary.availableMoney)}</span>
            <span class="patrimonio-legend-pct">${availPct.toFixed(1)}%</span>
          </div>
          ${globalSummary.totalReserved > 0 ? `
            <div class="patrimonio-legend-item">
              <span class="patrimonio-legend-dot" style="background:#f59e0b"></span>
              <span class="patrimonio-legend-name">Dinero reservado</span>
              <span class="patrimonio-legend-amount">${money(globalSummary.totalReserved)}</span>
              <span class="patrimonio-legend-pct">${resPct.toFixed(1)}%</span>
            </div>
          ` : ''}
        `;
      }
      return;
    }

    barEl.innerHTML = `<div style="width:100%;height:100%;background:var(--bg-subtle);border-radius:99px;"></div>`;
    if (legendEl) {
      legendEl.innerHTML = `<span style="font-size:0.75rem;color:var(--text-3)">Sin fondos disponibles distribuidos</span>`;
    }
    return;
  }

  // Render segmented bar
  barEl.innerHTML = envStats
    .filter((s) => s.totalBalance > 0)
    .map((s) => {
      const pct = (s.totalBalance / totalPositiveWealth) * 100;
      const color = s.env.color || '#3b82f6';
      const bankLabel = s.env.bank ? ` (${s.env.bank})` : '';
      return `<div class="patrimonio-segment" 
                   style="width:${pct}%;background:${color}" 
                   onclick="openEnvelopeDetail('${s.env.id}')"
                   title="${s.env.name}${bankLabel} — Disponible: ${money(s.available)} / Total: ${money(s.totalBalance)} (${pct.toFixed(1)}%)">
              </div>`;
    }).join('');

  // Render interactive legend pills
  if (legendEl) {
    legendEl.innerHTML = envStats
      .filter((s) => s.totalBalance > 0)
      .map((s) => {
        const pct = ((s.totalBalance / totalPositiveWealth) * 100).toFixed(1);
        const color = s.env.color || '#3b82f6';
        return `
          <div class="patrimonio-legend-item" onclick="openEnvelopeDetail('${s.env.id}')" title="Ver detalle de ${s.env.name}">
            <span class="patrimonio-legend-dot" style="background:${color}"></span>
            <span class="patrimonio-legend-name">${s.env.name}</span>
            ${s.env.bank ? `<span class="patrimonio-legend-bank">${s.env.bank}</span>` : ''}
            <span class="patrimonio-legend-amount">Disp: ${money(s.available)}</span>
            ${s.reserved > 0 ? `<span class="patrimonio-legend-bank">(Res: ${money(s.reserved)})</span>` : ''}
            <span class="patrimonio-legend-pct">${pct}%</span>
          </div>
        `;
      }).join('');
  }
}

/* ============================================================
   TARJETAS DE SOBRES (DASHBOARD)
   ============================================================ */

function renderEnvelopeCards() {
  renderFinancialKPIs();
  const container = $('envelopes-grid') || $('kpis');
  if (!container) return;

  if (!state.envelopes || !state.envelopes.length) {
    container.innerHTML = `
      <div class="envelopes-empty">
        <div class="envelopes-empty-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
        </div>
        <h3 class="envelopes-empty-title">No tienes sobres creados aún</h3>
        <p class="envelopes-empty-text">Crea tus propios sobres indicando propósito, banco opcional, monto objetivo, límites o reservas.</p>
        <button type="button" class="btn-primary" onclick="openCreateEnvelopeModal()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Crear primer sobre
        </button>
      </div>`;
    renderPatrimonioBar();
    return;
  }

  container.innerHTML = state.envelopes.map((env) => {
    const t = getEnvelopeTotals(env);
    const iconSVG = getEnvelopeIconSVG(env.icon || 'compass', env.color || '#3b82f6', 18);
    const bankBadge = env.bank ? `<span class="envelope-bank-badge">${env.bank}</span>` : '';
    const descText = env.description || 'Sin descripción de propósito';
    const hasDates = env.startDate || env.endDate;
    const assocCats = Array.isArray(env.associatedCategories) ? env.associatedCategories : [];

    return `
      <div class="envelope-card" onclick="openEnvelopeDetail('${env.id}')" data-env-id="${env.id}">
        <div class="envelope-card-accent-line" style="background:${env.color || '#3b82f6'}"></div>
        <div>
          <div class="envelope-card-header">
            <div class="envelope-card-header-left">
              <div class="envelope-icon-box" style="background:${env.color || '#3b82f6'}18; color:${env.color || '#3b82f6'}">
                ${iconSVG}
              </div>
              <div class="envelope-meta">
                <span class="envelope-name" title="${env.name}">${env.name}</span>
                ${bankBadge}
              </div>
            </div>
            <div class="envelope-enter-hint" title="Ver detalle y movimientos">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </div>

          <div class="envelope-desc" title="${descText}">${descText}</div>

          <div class="envelope-balance-section">
            <div class="envelope-balance-label">Disponible libre</div>
            <div class="envelope-balance-amount ${t.available < 0 ? 'negative' : ''}">
              ${money(t.available)}
            </div>
            ${t.reserved > 0 ? `<div style="font-size:0.72rem;color:var(--warn);margin-top:0.15rem">Reservado: <b>${money(t.reserved)}</b> · Total: <b>${money(t.totalBalance)}</b></div>` : ''}
            ${t.projected > 0 ? `<div style="font-size:0.72rem;color:var(--text-2);margin-top:0.1rem">Proyectado pendiente: <b>+${money(t.projected)}</b></div>` : ''}
          </div>

          ${(hasDates || assocCats.length > 0) ? `
            <div class="meta-tags-row" style="margin-bottom:0.45rem">
              ${hasDates ? `<span class="meta-chip">${fmt(env.startDate)} → ${fmt(env.endDate)}</span>` : ''}
              ${assocCats.slice(0, 3).map((c) => `<span class="meta-chip accent">${c}</span>`).join('')}
            </div>
          ` : ''}

          ${t.targetAmount > 0 ? `
            <div class="envelope-progress-mini">
              <div class="envelope-progress-mini-row">
                <span>Objetivo: ${money(t.targetAmount)}</span>
                <b>${Math.round(t.pctGoal)}%</b>
              </div>
              <div class="envelope-progress-mini-track">
                <div class="envelope-progress-mini-fill" style="width:${t.pctGoal}%;background:${env.color || '#3b82f6'}"></div>
              </div>
            </div>
          ` : ''}

          ${t.spendingLimit > 0 ? `
            <div class="envelope-progress-mini">
              <div class="envelope-progress-mini-row">
                <span>Límite: ${money(t.spendingLimit)} (Resta: ${money(t.spendingLimit - t.spentInPeriod)})</span>
                <b style="color:${t.spentInPeriod > t.spendingLimit ? 'var(--danger)' : (t.pctLimit >= 80 ? 'var(--warn)' : 'inherit')}">${Math.round(t.pctLimit)}%</b>
              </div>
              <div class="envelope-progress-mini-track">
                <div class="envelope-progress-mini-fill" style="width:${t.pctLimit}%;background:${t.spentInPeriod > t.spendingLimit ? 'var(--danger)' : (t.pctLimit >= 80 ? 'var(--warn)' : 'var(--success)')}"></div>
              </div>
            </div>
          ` : ''}
        </div>

        <div class="envelope-card-bottom">
          <span>Gastado: <b class="envelope-card-spent">-${money(t.spent)}</b></span>
          <span>Base: <b>${money(t.base)}</b></span>
        </div>
      </div>
    `;
  }).join('');

  renderPatrimonioBar();
}

/* ============================================================
   ENVELOPE DETAIL FULL-PAGE VIEW (PÁGINA EXCLUSIVA DEL SOBRE)
   ============================================================ */

let currentEnvelopeDetailId = null;

window.openEnvelopeDetail = function(envId) {
  if (!envId) return;
  const env = (state.envelopes || []).find((e) => e.id === envId);
  if (!env) return;

  currentEnvelopeDetailId = envId;
  const overlay = $('modal-overlay');
  if (overlay) overlay.style.display = 'none';

  renderEnvelopeDetailPage(envId);
  switchTab('envelope-detail');
};

function renderEnvelopeDetailPage(envId) {
  const env = (state.envelopes || []).find((e) => e.id === envId);
  const container = $('envelope-detail-page-content');
  if (!env || !container) return;

  const t = getEnvelopeTotals(env);
  const iconSVG = getEnvelopeIconSVG(env.icon || 'compass', env.color || '#3b82f6', 22);

  // Recopilar movimientos de este sobre (incluyendo ingresos pendientes como proyectados)
  const envExpenses = (state.expenses || [])
    .filter((e) => e.envelopeId === env.id || e.envelope === env.name || e.sourceId === env.id)
    .map((e) => ({ ...e, type: 'expense', desc: e.desc || e.description || 'Gasto' }));

  const allIncomes = getUnifiedIncomes();
  const envIncomes = allIncomes
    .filter((i) => i.envelopeId === env.id || i.envelope === env.name)
    .map((i) => ({ ...i, type: 'income', desc: i.name || 'Ingreso', isPending: i.status === 'pendiente' }));

  const movements = [...envExpenses, ...envIncomes].sort(compareByDateDesc);
  const envReserves = (state.reserves || []).filter((r) => r.envelopeId === env.id && r.amount > 0);
  const hasDates = env.startDate || env.endDate;
  const assocCats = Array.isArray(env.associatedCategories) ? env.associatedCategories : [];

  container.innerHTML = `
    <div class="env-page-container">
      <!-- Barra superior compacta con botón de retorno y acciones del sobre -->
      <div class="env-page-topbar">
        <button type="button" class="env-page-back-btn" onclick="switchTab('dashboard')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="15 18 9 12 15 6"/></svg>
          Sobres
        </button>
        <div class="env-topbar-actions">
          <button type="button" class="btn-ghost btn-sm" onclick="openEditEnvelopeModal('${env.id}')" title="Configurar / Editar sobre">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Configurar / Editar
          </button>
          <button type="button" class="btn-danger btn-sm" onclick="openDeleteEnvelopeModal('${env.id}')" title="Eliminar sobre">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Eliminar
          </button>
        </div>
      </div>

      <!-- Tarjeta Hero Compacta y Unificada -->
      <div class="env-compact-card">
        <div class="env-compact-header">
          <div class="env-compact-identity">
            <div class="env-compact-icon" style="background:${env.color || '#3b82f6'}18; color:${env.color || '#3b82f6'}">
              ${iconSVG}
            </div>
            <div class="env-compact-info">
              <div class="env-compact-name-row">
                <h2>${env.name}</h2>
                ${env.bank ? `<span class="envelope-bank-badge">${env.bank}</span>` : ''}
              </div>
              ${env.description ? `<div class="env-compact-desc">${env.description}</div>` : ''}
            </div>
          </div>
          <div class="env-compact-balance-wrap">
            <span class="env-compact-balance-label">Disponible libre</span>
            <span class="env-compact-balance-amount ${t.available < 0 ? 'negative' : ''}">${money(t.available)}</span>
            ${t.reserved > 0 ? `<span style="font-size:0.72rem;color:var(--text-2)">Total en sobre: <b>${money(t.totalBalance)}</b></span>` : ''}
          </div>
        </div>

        ${(hasDates || assocCats.length > 0) ? `
          <div class="meta-tags-row" style="margin-bottom:0">
            ${hasDates ? `<span class="meta-chip">Periodo: <b>${fmt(env.startDate)} → ${fmt(env.endDate)}</b></span>` : ''}
            ${assocCats.map((c) => `<span class="meta-chip accent">${c}</span>`).join('')}
          </div>
        ` : ''}

        <!-- Tira métrica compacta -->
        <div class="env-compact-metrics-strip" style="grid-template-columns: repeat(auto-fit, minmax(110px, 1fr))">
          <div class="env-metric-item">
            <span class="env-metric-label">Base inicial</span>
            <span class="env-metric-val">${money(t.base)}</span>
          </div>
          <div class="env-metric-item">
            <span class="env-metric-label">Inyectado</span>
            <span class="env-metric-val positive">+${money(t.incomes)}</span>
          </div>
          <div class="env-metric-item">
            <span class="env-metric-label">Gastado</span>
            <span class="env-metric-val negative">-${money(t.spent)}</span>
          </div>
          <div class="env-metric-item">
            <span class="env-metric-label">Reservado</span>
            <span class="env-metric-val" style="color:${t.reserved > 0 ? 'var(--warn)' : 'var(--text-2)'}">${money(t.reserved)}</span>
          </div>
          ${t.projected > 0 ? `
            <div class="env-metric-item">
              <span class="env-metric-label">Proyectado</span>
              <span class="env-metric-val" style="color:var(--warn)">+${money(t.projected)}</span>
            </div>
          ` : ''}
        </div>

        ${(t.targetAmount > 0 || t.spendingLimit > 0) ? `
          <div style="display:flex;flex-direction:column;gap:0.5rem;padding:0.65rem 0.85rem;background:var(--bg-alt);border:1px solid var(--border-subtle);border-radius:var(--radius-sm)">
            ${t.targetAmount > 0 ? `
              <div>
                <div style="display:flex;justify-content:space-between;font-size:0.75rem;margin-bottom:0.25rem">
                  <span>Progreso hacia monto objetivo (<b>${money(t.targetAmount)}</b>)</span>
                  <b>${money(t.totalBalance)} (${Math.round(t.pctGoal)}%)</b>
                </div>
                <div class="progress-bar" style="margin-bottom:0">
                  <div class="progress-fill" style="width:${t.pctGoal}%;background:${env.color || 'var(--primary)'}"></div>
                </div>
              </div>
            ` : ''}
            ${t.spendingLimit > 0 ? `
              <div>
                <div style="display:flex;justify-content:space-between;font-size:0.75rem;margin-bottom:0.25rem">
                  <span>Límite de gasto (<b>${money(t.spendingLimit)}</b>) · Restante: <b>${money(t.spendingLimit - t.spentInPeriod)}</b></span>
                  <b style="color:${t.spentInPeriod > t.spendingLimit ? 'var(--danger)' : (t.pctLimit >= 80 ? 'var(--warn)' : 'var(--success)')}">${Math.round(t.pctLimit)}% usado</b>
                </div>
                <div class="progress-bar" style="margin-bottom:0">
                  <div class="progress-fill" style="width:${t.pctLimit}%;background:${t.spentInPeriod > t.spendingLimit ? 'var(--danger)' : (t.pctLimit >= 80 ? 'var(--warn)' : 'var(--success)')}"></div>
                </div>
              </div>
            ` : ''}
          </div>
        ` : ''}

        <!-- Botones de Acción integrados -->
        <div class="env-compact-actions">
          <button type="button" class="btn-primary btn-sm" onclick="openIncomeModal('${env.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Inyectar ingreso
          </button>
          <button type="button" class="btn-secondary btn-sm" onclick="openExpenseModal('${env.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Registrar gasto
          </button>
          <button type="button" class="btn-outline btn-sm" onclick="openReserveModal(null, '${env.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Reservar dinero
          </button>
          <button type="button" class="btn-outline btn-sm" onclick="openTransferModal('${env.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
            Transferir
          </button>
        </div>
      </div>

      ${envReserves.length > 0 ? `
        <div class="env-page-movements-card">
          <div class="env-page-movements-header">
            <h3>Dinero reservado en este sobre (${envReserves.length})</h3>
          </div>
          <div class="env-page-movements-list">
            ${envReserves.map((r) => `
              <div class="env-movement-row">
                <div class="env-movement-left">
                  <div class="env-movement-info">
                    <span class="env-movement-desc">${r.name}</span>
                    <span class="env-movement-date">Saldo reservado: <b>${money(r.amount)}</b> (Inicial: ${money(r.initialAmount)})</span>
                  </div>
                </div>
                <div class="env-movement-right">
                  <button type="button" class="btn-secondary btn-sm" onclick="openUseReserveModal('${r.id}')">Utilizar</button>
                  <button type="button" class="btn-ghost btn-sm" onclick="openReleaseReserveModal('${r.id}')">Liberar</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Listado de Movimientos del Sobre -->
      <div class="env-page-movements-card">
        <div class="env-page-movements-header">
          <h3>Movimientos (${movements.length})</h3>
        </div>
        <div class="env-page-movements-list">
          ${movements.length === 0 ? `
            <div class="env-movements-empty" style="padding:2rem 1rem;text-align:center;color:var(--text-3)">
              <span>No hay ingresos ni gastos registrados en este sobre aún.</span>
            </div>
          ` : movements.map((m) => {
            const isInc = m.type === 'income';
            const isPending = !!m.isPending;
            return `
              <div class="env-movement-row">
                <div class="env-movement-left">
                  <div class="env-movement-type-badge ${isInc ? 'income' : 'expense'}" style="${isPending ? 'background:var(--warn-bg);color:var(--warn)' : ''}">
                    ${isInc 
                      ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`
                      : `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>`
                    }
                  </div>
                  <div class="env-movement-info">
                    <span class="env-movement-desc">
                      ${m.desc}
                      ${isPending ? `<span class="badge badge-pending" style="margin-left:0.35rem">Pendiente (Proyectado)</span>` : ''}
                      ${m.category ? `<span class="meta-chip" style="margin-left:0.35rem">${m.category}</span>` : ''}
                    </span>
                    <span class="env-movement-date">${m.date ? fmt(m.date) : 'Sin fecha estimada'}</span>
                  </div>
                </div>
                <div class="env-movement-right">
                  ${isPending ? `
                    <button type="button" class="btn-success btn-sm" onclick="confirmIncomeReception('${m.id}')">Confirmar</button>
                  ` : ''}
                  <span class="env-movement-amount ${isInc ? 'income' : 'expense'}" style="${isPending ? 'color:var(--warn)' : ''}">
                    ${isInc ? '+' : '-'}${money(m.amount)}
                  </span>
                  <button type="button" class="btn-ghost btn-sm" onclick="${isInc ? `deleteIncome('${m.id}')` : `deleteExpense('${m.id}')`}" title="Eliminar movimiento">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

window.renderEnvelopeDetailPage = renderEnvelopeDetailPage;
window.deleteIncome = window.deleteSource;

/* ============================================================
   TRANSFERIR ENTRE SOBRES
   ============================================================ */

window.openTransferModal = function(fromEnvId) {
  if ((state.envelopes || []).length <= 1) {
    toast('Necesitas al menos 2 sobres para realizar transferencias');
    return;
  }

  const fromEnv = state.envelopes.find((e) => e.id === fromEnvId) || state.envelopes[0];
  const otherEnvelopes = state.envelopes.filter((e) => e.id !== fromEnv.id);
  const fromTotals = getEnvelopeTotals(fromEnv);

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  const targetOptions = otherEnvelopes
    .map((e) => `<option value="${e.id}">${e.name} (${e.bank || 'Sin banco'} · Disp: ${money(getEnvelopeTotals(e).available)})</option>`)
    .join('');

  content.innerHTML = `
    <div class="modal-info-content compact-modal" style="max-width:400px">
      <div class="modal-info-header">
        <h3>Transferir entre sobres</h3>
        <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form id="transfer-form" class="compact-form">
        <div class="transfer-origin-pill">
          <div>
            <div class="pill-label">Sobre Origen</div>
            <div class="pill-val">${fromEnv.name}</div>
          </div>
          <div style="text-align:right">
            <div class="pill-label">Disponible</div>
            <div class="pill-val">${money(fromTotals.available)}</div>
          </div>
        </div>

        <div class="field">
          <label>Hacia sobre destino</label>
          <select id="transfer-target-env" required>
            ${targetOptions}
          </select>
        </div>

        <div class="field">
          <label>Monto a transferir (₡)</label>
          <div class="amount-input-wrap">
            <span class="currency-symbol">₡</span>
            <input type="text" id="transfer-amount" inputmode="decimal" placeholder="0.00" required />
          </div>
        </div>

        <div class="field">
          <label>Nota o motivo (opcional)</label>
          <input type="text" id="transfer-note" placeholder="Ej. Rebalanceo de fondo" />
        </div>

        <div class="modal-actions-compact">
          <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
          <button type="submit" class="btn-primary btn-sm">Transferir fondos</button>
        </div>
      </form>
    </div>
  `;

  attachAmountFormatter($('transfer-amount'));
  overlay.style.display = 'flex';
  overlay.onclick = (ev) => { if (ev.target === overlay) overlay.style.display = 'none'; };

  $('transfer-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseAmount($('transfer-amount').value);
    if (!amount || amount <= 0) {
      toast('Ingresa un monto válido mayor a 0');
      return;
    }
    if (amount > fromTotals.available) {
      if (!confirm(`El monto transferido (${money(amount)}) excede el disponible de ${fromEnv.name} (${money(fromTotals.available)}). ¿Deseas continuar?`)) {
        return;
      }
    }

    const targetId = $('transfer-target-env').value;
    const targetEnv = state.envelopes.find((env) => env.id === targetId);
    if (!targetEnv) return;

    const note = $('transfer-note').value.trim();
    const date = new Date().toISOString().slice(0, 10);

    // Gasto en sobre origen
    state.expenses.push({
      id: uid(),
      envelopeId: fromEnv.id,
      envelope: fromEnv.name,
      amount,
      desc: note ? `Transferencia a ${targetEnv.name}: ${note}` : `Transferencia a ${targetEnv.name}`,
      date,
      isTransfer: true
    });

    // Ingreso en sobre destino
    const newInc = {
      id: uid(),
      name: note ? `Transferencia desde ${fromEnv.name}: ${note}` : `Transferencia desde ${fromEnv.name}`,
      amount,
      envelopeId: targetEnv.id,
      date,
      status: 'recibido',
      isTransfer: true
    };
    if (!Array.isArray(state.incomes)) state.incomes = [];
    if (!Array.isArray(state.sources)) state.sources = [];
    state.incomes.push(newInc);
    state.sources.push(newInc);

    overlay.style.display = 'none';
    renderAll();
    toast(`Transferido ${money(amount)} de ${fromEnv.name} a ${targetEnv.name}`);
    if (fromEnvId && currentEnvelopeDetailId === fromEnvId) {
      renderEnvelopeDetailPage(fromEnvId);
    }
  });
};

/* ============================================================
   GESTIÓN MANUAL DE SOBRES (CREAR, EDITAR, ELIMINAR)
   ============================================================ */

const AVAILABLE_ENVELOPE_ICONS = ['compass', 'wallet', 'tool', 'camera', 'car', 'heart', 'shield', 'lock'];
const PRESET_BANKS = ['Sin banco específico', 'BAC Credomatic', 'Banco Nacional (BNCR)', 'Banco de Costa Rica (BCR)', 'Davivienda', 'Scotiabank', 'Efectivo', 'Otro'];

window.openCreateEnvelopeModal = function() {
  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  const PRESET_ENVELOPE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#6366f1', '#ef4444'];
  let selectedColor = PRESET_ENVELOPE_COLORS[0];
  let selectedIcon = 'compass';
  const selectedCats = new Set();

  content.innerHTML = `
    <div class="modal-info-content compact-modal" style="max-width:460px">
      <div class="modal-info-header">
        <h3>Nuevo sobre / presupuesto</h3>
        <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form id="create-env-form" class="compact-form">
        <div class="field">
          <label>Nombre del sobre o presupuesto</label>
          <input id="modal-env-name" placeholder="Escribe un nombre..." required />
        </div>

        <div class="field">
          <label>Descripción o propósito (opcional)</label>
          <input id="modal-env-desc" placeholder="Describe el propósito..." />
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Entidad / Banco (opcional)</label>
            <select id="modal-env-bank">
              ${PRESET_BANKS.map((b) => `<option value="${b === 'Sin banco específico' ? '' : b}">${b}</option>`).join('')}
            </select>
            <input id="modal-env-custom-bank" placeholder="Nombre del banco..." style="display:none;margin-top:0.35rem" />
          </div>

          <div class="field">
            <label>Fondo base inicial (₡, opcional)</label>
            <div class="amount-input-wrap">
              <span class="currency-symbol">₡</span>
              <input id="modal-env-base" type="text" inputmode="decimal" placeholder="0.00" />
            </div>
          </div>
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Monto objetivo (₡, opcional)</label>
            <div class="amount-input-wrap">
              <span class="currency-symbol">₡</span>
              <input id="modal-env-target" type="text" inputmode="decimal" placeholder="0.00" />
            </div>
          </div>

          <div class="field">
            <label>Límite de gasto (₡, opcional)</label>
            <div class="amount-input-wrap">
              <span class="currency-symbol">₡</span>
              <input id="modal-env-limit" type="text" inputmode="decimal" placeholder="0.00" />
            </div>
          </div>
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Fecha de inicio (opcional)</label>
            <input id="modal-env-start" type="date" />
          </div>

          <div class="field">
            <label>Fecha límite (opcional)</label>
            <input id="modal-env-end" type="date" />
          </div>
        </div>

        <div class="field">
          <label>Dinero reservado inicial (₡, opcional)</label>
          <div class="amount-input-wrap">
            <span class="currency-symbol">₡</span>
            <input id="modal-env-reserved" type="text" inputmode="decimal" placeholder="0.00" />
          </div>
        </div>

        ${(state.categories || []).length > 0 ? `
          <div class="field">
            <label>Categorías asociadas (opcional)</label>
            <div class="category-picker-chips" id="create-env-cats">
              ${state.categories.map((c) => `
                <span class="cat-select-chip" data-cat="${c.name}">
                  <span class="cat-dot" style="background:${c.color};width:7px;height:7px"></span>
                  ${c.name}
                </span>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="form-row-2 compact-pickers-row">
          <div class="field">
            <label>Icono</label>
            <div class="icon-picker-grid compact-picker" id="create-env-icon-grid">
              ${AVAILABLE_ENVELOPE_ICONS.map((ic) => `
                <div class="icon-picker-item ${ic === selectedIcon ? 'selected' : ''}" data-icon="${ic}">
                  ${getEnvelopeIconSVG(ic, 'currentColor', 16)}
                </div>
              `).join('')}
            </div>
          </div>

          <div class="field">
            <label>Color</label>
            <div class="color-picker-grid compact-picker" id="env-color-grid">
              ${PRESET_ENVELOPE_COLORS.map((c) => `
                <div class="color-swatch ${c === selectedColor ? 'selected' : ''}" style="background:${c}" data-color="${c}"></div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="modal-actions-compact">
          <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
          <button type="submit" class="btn-primary btn-sm">Crear sobre</button>
        </div>
      </form>
    </div>
  `;

  attachAmountFormatter($('modal-env-base'));
  attachAmountFormatter($('modal-env-target'));
  attachAmountFormatter($('modal-env-limit'));
  attachAmountFormatter($('modal-env-reserved'));
  _buildCsel('modal-env-bank', {});

  const bankSelect = $('modal-env-bank');
  const customBankInput = $('modal-env-custom-bank');
  bankSelect.addEventListener('change', () => {
    if (bankSelect.value === 'Otro') {
      customBankInput.style.display = 'block';
      customBankInput.focus();
    } else {
      customBankInput.style.display = 'none';
    }
  });

  content.querySelectorAll('#create-env-cats .cat-select-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const cat = chip.getAttribute('data-cat');
      if (selectedCats.has(cat)) {
        selectedCats.delete(cat);
        chip.classList.remove('selected');
      } else {
        selectedCats.add(cat);
        chip.classList.add('selected');
      }
    });
  });

  const swatches = content.querySelectorAll('#env-color-grid .color-swatch');
  swatches.forEach((sw) => {
    sw.addEventListener('click', () => {
      swatches.forEach((s) => s.classList.remove('selected'));
      sw.classList.add('selected');
      selectedColor = sw.getAttribute('data-color');
    });
  });

  const iconItems = content.querySelectorAll('#create-env-icon-grid .icon-picker-item');
  iconItems.forEach((item) => {
    item.addEventListener('click', () => {
      iconItems.forEach((i) => i.classList.remove('selected'));
      item.classList.add('selected');
      selectedIcon = item.getAttribute('data-icon');
    });
  });

  overlay.style.display = 'flex';
  $('modal-env-name').focus();

  $('create-env-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = $('modal-env-name').value.trim();
    const baseAmount = parseAmount($('modal-env-base').value || 0);
    const targetAmount = parseAmount($('modal-env-target').value || 0);
    const spendingLimit = parseAmount($('modal-env-limit').value || 0);
    const reservedInit = parseAmount($('modal-env-reserved').value || 0);
    const startDate = $('modal-env-start').value || '';
    const endDate = $('modal-env-end').value || '';
    const selectedBankVal = bankSelect.value;
    const bank = selectedBankVal === 'Otro' ? (customBankInput.value.trim() || 'Otro') : selectedBankVal;
    const description = $('modal-env-desc').value.trim();

    if (!name || isNaN(baseAmount) || baseAmount < 0) {
      toast('Ingresa un nombre válido');
      return;
    }

    if (startDate && endDate && endDate < startDate) {
      toast('La fecha límite no puede ser anterior a la fecha de inicio');
      return;
    }

    const newEnv = {
      id: uid(),
      name,
      bank,
      description,
      baseAmount,
      targetAmount,
      spendingLimit,
      startDate,
      endDate,
      associatedCategories: Array.from(selectedCats),
      color: selectedColor,
      icon: selectedIcon
    };

    state.envelopes.push(newEnv);

    if (reservedInit > 0) {
      if (!Array.isArray(state.reserves)) state.reserves = [];
      state.reserves.push({
        id: uid(),
        name: `Reserva en ${name}`,
        initialAmount: reservedInit,
        amount: reservedInit,
        usedAmount: 0,
        releasedAmount: 0,
        envelopeId: newEnv.id,
        budgetId: '',
        category: '',
        date: new Date().toISOString().slice(0, 10),
        usages: []
      });
    }

    overlay.style.display = 'none';
    renderAll();
    toast(`Sobre "${name}" creado con éxito`);
  });
};

window.openEditEnvelopeModal = function(envId) {
  const env = (state.envelopes || []).find((e) => e.id === envId);
  if (!env) return;

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  const PRESET_ENVELOPE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#6366f1', '#ef4444'];
  let selectedColor = env.color || '#3b82f6';
  let selectedIcon = env.icon || 'compass';
  const selectedCats = new Set(Array.isArray(env.associatedCategories) ? env.associatedCategories : []);

  const isCustomBank = env.bank && !PRESET_BANKS.includes(env.bank);

  content.innerHTML = `
    <div class="modal-info-content compact-modal" style="max-width:460px">
      <div class="modal-info-header">
        <h3>Configurar sobre / presupuesto</h3>
        <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form id="edit-env-form" class="compact-form">
        <div class="field">
          <label>Nombre del sobre</label>
          <input id="modal-edit-env-name" value="${env.name}" required />
        </div>

        <div class="field">
          <label>Propósito o descripción (opcional)</label>
          <input id="modal-edit-env-desc" value="${env.description || ''}" placeholder="Propósito..." />
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Banco (opcional)</label>
            <select id="modal-edit-env-bank">
              ${PRESET_BANKS.map((b) => {
                const val = b === 'Sin banco específico' ? '' : b;
                const isSelected = (val === (env.bank || '')) || (b === 'Otro' && isCustomBank);
                return `<option value="${val}" ${isSelected ? 'selected' : ''}>${b}</option>`;
              }).join('')}
            </select>
            <input id="modal-edit-env-custom-bank" value="${isCustomBank ? env.bank : ''}" placeholder="Nombre del banco..." style="${isCustomBank ? 'display:block;' : 'display:none;'}margin-top:0.35rem" />
          </div>

          <div class="field">
            <label>Fondo base (₡)</label>
            <div class="amount-input-wrap">
              <span class="currency-symbol">₡</span>
              <input id="modal-edit-env-base" type="text" inputmode="decimal" value="${env.baseAmount ? formatAmountString(env.baseAmount) : ''}" placeholder="0.00" />
            </div>
          </div>
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Monto objetivo (₡, opcional)</label>
            <div class="amount-input-wrap">
              <span class="currency-symbol">₡</span>
              <input id="modal-edit-env-target" type="text" inputmode="decimal" value="${env.targetAmount ? formatAmountString(env.targetAmount) : ''}" placeholder="0.00" />
            </div>
          </div>

          <div class="field">
            <label>Límite de gasto (₡, opcional)</label>
            <div class="amount-input-wrap">
              <span class="currency-symbol">₡</span>
              <input id="modal-edit-env-limit" type="text" inputmode="decimal" value="${env.spendingLimit ? formatAmountString(env.spendingLimit) : ''}" placeholder="0.00" />
            </div>
          </div>
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Fecha de inicio (opcional)</label>
            <input id="modal-edit-env-start" type="date" value="${env.startDate || ''}" />
          </div>

          <div class="field">
            <label>Fecha límite (opcional)</label>
            <input id="modal-edit-env-end" type="date" value="${env.endDate || ''}" />
          </div>
        </div>

        ${(state.categories || []).length > 0 ? `
          <div class="field">
            <label>Categorías asociadas (opcional)</label>
            <div class="category-picker-chips" id="edit-env-cats">
              ${state.categories.map((c) => `
                <span class="cat-select-chip ${selectedCats.has(c.name) ? 'selected' : ''}" data-cat="${c.name}">
                  <span class="cat-dot" style="background:${c.color};width:7px;height:7px"></span>
                  ${c.name}
                </span>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="form-row-2 compact-pickers-row">
          <div class="field">
            <label>Icono</label>
            <div class="icon-picker-grid compact-picker" id="edit-env-icon-grid">
              ${AVAILABLE_ENVELOPE_ICONS.map((ic) => `
                <div class="icon-picker-item ${ic === selectedIcon ? 'selected' : ''}" data-icon="${ic}">
                  ${getEnvelopeIconSVG(ic, 'currentColor', 16)}
                </div>
              `).join('')}
            </div>
          </div>

          <div class="field">
            <label>Color</label>
            <div class="color-picker-grid compact-picker" id="edit-env-color-grid">
              ${PRESET_ENVELOPE_COLORS.map((c) => `
                <div class="color-swatch ${c.toLowerCase() === selectedColor.toLowerCase() ? 'selected' : ''}" style="background:${c}" data-color="${c}"></div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="modal-actions-compact">
          <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
          <button type="submit" class="btn-primary btn-sm">Guardar cambios</button>
        </div>
      </form>
    </div>
  `;

  attachAmountFormatter($('modal-edit-env-base'));
  attachAmountFormatter($('modal-edit-env-target'));
  attachAmountFormatter($('modal-edit-env-limit'));
  _buildCsel('modal-edit-env-bank', {});

  const bankSelect = $('modal-edit-env-bank');
  const customBankInput = $('modal-edit-env-custom-bank');
  bankSelect.addEventListener('change', () => {
    if (bankSelect.value === 'Otro') {
      customBankInput.style.display = 'block';
      customBankInput.focus();
    } else {
      customBankInput.style.display = 'none';
    }
  });

  content.querySelectorAll('#edit-env-cats .cat-select-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const cat = chip.getAttribute('data-cat');
      if (selectedCats.has(cat)) {
        selectedCats.delete(cat);
        chip.classList.remove('selected');
      } else {
        selectedCats.add(cat);
        chip.classList.add('selected');
      }
    });
  });

  const swatches = content.querySelectorAll('#edit-env-color-grid .color-swatch');
  swatches.forEach((sw) => {
    sw.addEventListener('click', () => {
      swatches.forEach((s) => s.classList.remove('selected'));
      sw.classList.add('selected');
      selectedColor = sw.getAttribute('data-color');
    });
  });

  const iconItems = content.querySelectorAll('#edit-env-icon-grid .icon-picker-item');
  iconItems.forEach((item) => {
    item.addEventListener('click', () => {
      iconItems.forEach((i) => i.classList.remove('selected'));
      item.classList.add('selected');
      selectedIcon = item.getAttribute('data-icon');
    });
  });

  overlay.style.display = 'flex';
  $('modal-edit-env-name').focus();

  $('edit-env-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = $('modal-edit-env-name').value.trim();
    const baseAmount = parseAmount($('modal-edit-env-base').value || 0);
    const targetAmount = parseAmount($('modal-edit-env-target').value || 0);
    const spendingLimit = parseAmount($('modal-edit-env-limit').value || 0);
    const startDate = $('modal-edit-env-start').value || '';
    const endDate = $('modal-edit-env-end').value || '';
    const selectedBankVal = bankSelect.value;
    const bank = selectedBankVal === 'Otro' ? (customBankInput.value.trim() || 'Otro') : selectedBankVal;
    const description = $('modal-edit-env-desc').value.trim();

    if (!name || isNaN(baseAmount) || baseAmount < 0) {
      toast('Ingresa datos válidos');
      return;
    }

    if (startDate && endDate && endDate < startDate) {
      toast('La fecha límite no puede ser anterior a la fecha de inicio');
      return;
    }

    env.name = name;
    env.bank = bank;
    env.description = description;
    env.baseAmount = baseAmount;
    env.targetAmount = targetAmount;
    env.spendingLimit = spendingLimit;
    env.startDate = startDate;
    env.endDate = endDate;
    env.associatedCategories = Array.from(selectedCats);
    env.color = selectedColor;
    env.icon = selectedIcon;

    overlay.style.display = 'none';
    renderAll();
    toast(`Sobre "${name}" actualizado`);
    if (currentTab === 'envelope-detail') {
      openEnvelopeDetail(env.id);
    }
  });
};

window.openDeleteEnvelopeModal = function(envId) {
  const env = (state.envelopes || []).find((e) => e.id === envId);
  if (!env) return;

  const t = getEnvelopeTotals(env);
  const remaining = t.totalBalance;
  const otherEnvelopes = state.envelopes.filter((e) => e.id !== envId);

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  const targetOpts = `<option value="">No transferir (Desvincular)</option>` +
    otherEnvelopes.map((e) => `<option value="${e.id}">${e.name}${e.bank ? ` (${e.bank})` : ''}</option>`).join('');

  content.innerHTML = `
    <div class="modal-info-content" style="max-width:440px">
      <div class="modal-info-header">
        <h3>Eliminar sobre</h3>
        <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form id="delete-env-form" style="display:flex;flex-direction:column;gap:1rem;margin-top:0.5rem">
        <p style="font-size:0.85rem;color:var(--text);line-height:1.4">
          ¿Estás seguro de que deseas eliminar el sobre <b>"${env.name}"</b>?
        </p>

        ${(remaining > 0 && otherEnvelopes.length > 0) ? `
          <div style="padding:0.75rem 0.85rem;background:var(--bg-alt);border:1px solid var(--border);border-radius:var(--radius-sm)">
            <p style="font-size:0.78rem;color:var(--text-2);margin-bottom:0.5rem">
              Este sobre cuenta con un saldo de <b>${money(remaining)}</b>. Selecciona si deseas transferir estos fondos a otro sobre:
            </p>
            <div class="field">
              <label>Sobre destino de los fondos</label>
              <select id="modal-delete-reassign-to">
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

  if (remaining > 0 && otherEnvelopes.length > 0) {
    _buildCsel('modal-delete-reassign-to', {});
  }

  overlay.style.display = 'flex';

  $('delete-env-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const targetId = $('modal-delete-reassign-to')?.value || '';
    if (remaining > 0 && targetId) {
      const targetEnv = state.envelopes.find((e) => e.id === targetId);
      if (targetEnv) {
        targetEnv.baseAmount = Number(targetEnv.baseAmount || 0) + remaining;
      }
    }

    state.expenses.forEach((e) => {
      if (e.envelopeId === envId) {
        e.envelopeId = targetId || '';
      }
    });
    state.incomes.forEach((i) => {
      if (i.envelopeId === envId) {
        i.envelopeId = targetId || '';
      }
    });
    state.reserves.forEach((r) => {
      if (r.envelopeId === envId) {
        r.envelopeId = targetId || '';
      }
    });

    state.envelopes = state.envelopes.filter((e) => e.id !== envId);
    overlay.style.display = 'none';
    currentEnvelopeDetailId = null;
    switchTab('dashboard');
    renderAll();
    toast(`Sobre "${env.name}" eliminado`);
  });
};

/* ============================================================
   RENDER CHARTS (ADAPTADOS A DATOS REALES DEL USUARIO)
   ============================================================ */

let categoriesChart, balanceChart;

function renderCharts() {
  if (typeof Chart === 'undefined') return;
  const envs = state.envelopes || [];
  const cats = state.categories || [];
  const s = getGlobalFinancialSummary();

  const isDark = state.theme === 'dark';
  const gridColor  = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const labelColor = isDark ? '#9999a1' : '#5c5c64';

  Chart.defaults.color = labelColor;
  Chart.defaults.font.family = "'Geist', -apple-system, BlinkMacSystemFont, sans-serif";

  categoriesChart?.destroy();
  const catCanvas = $('chart-categories');
  if (catCanvas) {
    let chartLabels = [];
    let chartValues = [];
    let chartColors = [];

    if (cats.length > 0) {
      cats.forEach((c) => {
        const st = getCategoryStats(c);
        const val = st.spent > 0 ? st.spent : st.effectiveBudget;
        if (val > 0) {
          chartLabels.push(c.name);
          chartValues.push(val);
          chartColors.push(c.color || '#3b82f6');
        }
      });
    }

    if (chartLabels.length === 0 && envs.length > 0) {
      envs.forEach((e) => {
        const et = getEnvelopeTotals(e);
        const val = et.spent > 0 ? et.spent : et.totalBalance;
        if (val > 0) {
          chartLabels.push(e.name);
          chartValues.push(val);
          chartColors.push(e.color || '#3b82f6');
        }
      });
    }

    const hasRealData = chartValues.some((v) => v > 0);

    categoriesChart = new Chart(catCanvas, {
      type: 'doughnut',
      data: {
        labels: hasRealData ? chartLabels : ['Sin datos registrados'],
        datasets: [{
          data: hasRealData ? chartValues : [1],
          backgroundColor: hasRealData ? chartColors : [isDark ? '#27272a' : '#e5e5e7'],
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
              label: (c) => hasRealData ? ` ${c.label}: ${money(chartValues[c.dataIndex] || 0)}` : ' Sin movimientos registrados'
            }
          }
        }
      }
    });
  }

  balanceChart?.destroy();
  const balCanvas = $('chart-balance');
  if (balCanvas) {
    const finLabels = ['Total', 'Disponible', 'Reservado', 'Gastado', 'Proyectado'];
    const finData = [
      Math.max(0, s.totalMoney),
      Math.max(0, s.availableMoney),
      Math.max(0, s.totalReserved),
      Math.max(0, s.totalSpent),
      Math.max(0, s.projectedIncomesTotal)
    ];
    const finColors = ['#3b82f6cc', '#10b981cc', '#f59e0bcc', '#e11d48cc', '#8b5cf6cc'];

    balanceChart = new Chart(balCanvas, {
      type: 'bar',
      data: {
        labels: finLabels,
        datasets: [
          {
            label: 'Monto (₡)',
            data: finData,
            backgroundColor: finColors,
            borderRadius: 4,
            borderWidth: 0
          }
        ]
      },
      options: {
        responsive: true,
        scales: {
          x: { grid: { color: gridColor }, ticks: { font: { size: 10 } } },
          y: { grid: { color: gridColor }, ticks: { callback: (v) => money(v), font: { size: 10 } } }
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: (c) => ` ${money(c.raw || 0)}`
            }
          }
        }
      }
    });
  }
}

/* ============================================================
   RENDER RECENT EXPENSES (dashboard / patrimonio)
   ============================================================ */

function renderRecentExpenses() {
  const recent = [...(state.expenses || [])].sort(compareByDateDesc).slice(0, 5);
  const el = $('recent-expenses-list');
  if (!el) return;

  if (!recent.length) {
    el.innerHTML = `<div class="empty-state">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>
      <p>Sin gastos registrados</p><span>Registra tus gastos para ver la actividad reciente</span></div>`;
    return;
  }

  el.innerHTML = recent.map((e) => {
    const env = (state.envelopes || []).find((x) => x.id === e.envelopeId || x.name === e.envelope);
    const envColor = env?.color || '#3b82f6';
    const envName = env?.name || 'Fondo general';
    const envBank = env?.bank ? ` (${env.bank})` : '';
    const catObj = e.category ? (state.categories || []).find((c) => c.name === e.category) : null;

    return `<div class="recent-row">
      <div class="recent-left">
        <div class="recent-desc">${e.desc}</div>
        <div class="recent-meta">${fmt(e.date)} · <span style="display:inline-flex;align-items:center;gap:.25rem">
          <span style="width:7px;height:7px;border-radius:50%;background:${envColor};display:inline-block"></span>
          ${envName}${envBank}</span>
          ${e.category ? ` · <span style="display:inline-flex;align-items:center;gap:.25rem"><span style="width:6px;height:6px;border-radius:50%;background:${catObj?.color || '#64748b'};display:inline-block"></span>${e.category}</span>` : ''}
        </div>
      </div>
      <div class="recent-amount">-${money(e.amount)}</div>
    </div>`;
  }).join('');
}

/* ============================================================
   RENDER INGRESOS Y ENTRADAS DE DINERO (RECIBIDOS Y FUTUROS)
   ============================================================ */

function renderSources() {
  renderFinancialKPIs();
  const el = $('sources');
  if (!el) return;

  const filterEnv = $('filter-income-envelope')?.value || '';
  const filterStatus = $('filter-income-status')?.value || '';

  let allIncomes = getUnifiedIncomes();

  if (filterEnv) {
    allIncomes = allIncomes.filter((i) => i.envelopeId === filterEnv || i.envelope === filterEnv);
  }
  if (filterStatus) {
    allIncomes = allIncomes.filter((i) => (i.status || 'recibido') === filterStatus);
  }

  if (!allIncomes.length) {
    el.innerHTML = `<div class="empty-state" style="padding:2rem">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <p>Sin ingresos registrados</p><span>Registra ingresos recibidos o ingresos futuros pendientes con el botón superior</span></div>`;
    return;
  }

  el.innerHTML = allIncomes.sort(compareByDateDesc).map((s) => {
    const env = (state.envelopes || []).find((e) => e.id === s.envelopeId || e.name === s.envelope);
    const envColor = env?.color || 'var(--text-3)';
    const envName = env?.name || 'Fondo general';
    const envBank = env?.bank ? ` (${env.bank})` : '';
    const isPending = s.status === 'pendiente';

    return `<div class="source-card" data-income-id="${s.id}">
      <div class="source-header">
        <div class="source-title-wrap">
          <span class="source-name">${s.name}</span>
          ${isPending ? `
            <span class="badge badge-pending">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Pendiente (Proyectado)
            </span>
          ` : `
            <span class="badge badge-received">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              Recibido
            </span>
          `}
          <span class="exp-tag">
            <span class="exp-tag-dot" style="background:${envColor}"></span>
            ${envName}${envBank}
          </span>
        </div>
        <div class="source-meta">
          <div class="source-actions">
            ${isPending ? `
              <button type="button" class="btn-success btn-sm" onclick="confirmIncomeReception('${s.id}')" title="Confirmar recepción de este ingreso">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                Confirmar recepción
              </button>
            ` : ''}
            <button type="button" class="btn-secondary btn-sm" onclick="openIncomeModal(null, '${s.id}')">
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
            <span class="label">${isPending ? 'Monto esperado (proyectado):' : 'Monto recibido:'}</span>
            <span class="val total" style="color:${isPending ? 'var(--warn)' : 'var(--success)'}">+${money(s.amount)}</span>
          </div>
          <div class="compact-metric">
            <span class="label">Destino:</span>
            <span class="val">${envName}${envBank}</span>
          </div>
          <div class="compact-metric">
            <span class="label">${isPending ? 'Fecha estimada:' : 'Fecha:'}</span>
            <span class="val">${s.date ? fmt(s.date) : 'Sin fecha estimada'}</span>
          </div>
          ${isPending ? `
            <div class="compact-metric">
              <span class="label" style="color:var(--warn)">Nota: No sumado al saldo disponible hasta confirmar recepción</span>
            </div>
          ` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

window.confirmIncomeReception = function(id) {
  ensureEnvelopes();
  const incInIncomes = (state.incomes || []).find((x) => x.id === id);
  const incInSources = (state.sources || []).find((x) => x.id === id);
  const target = incInIncomes || incInSources;
  if (!target) return;

  if (target.status === 'recibido') {
    toast('Este ingreso ya fue confirmado previamente');
    return;
  }

  const receivedDate = target.date || new Date().toISOString().slice(0, 10);
  if (incInIncomes) {
    incInIncomes.status = 'recibido';
    incInIncomes.date = receivedDate;
  }
  if (incInSources) {
    incInSources.status = 'recibido';
    incInSources.date = receivedDate;
  }

  ensureEnvelopes();
  renderAll();
  if (currentTab === 'envelope-detail' && currentEnvelopeDetailId) {
    renderEnvelopeDetailPage(currentEnvelopeDetailId);
  }
  toast(`Recepción confirmada: +${money(target.amount)} disponibles en tu saldo real`);
};

window.deleteIncome = function(id) {
  if (!confirm('¿Eliminar este registro de ingreso?')) return;
  state.incomes = (state.incomes || []).filter((x) => x.id !== id);
  state.sources = (state.sources || []).filter((x) => x.id !== id);
  renderAll();
  toast('Ingreso eliminado');
};

/* ============================================================
   INCOME MODAL (REGISTRAR INGRESO RECIBIDO O FUTURO PENDIENTE)
   ============================================================ */

window.openIncomeModal = window.openSourceModal = function(envIdOrIncomeId = null, maybeEnvId = null) {
  let incomeId = null;
  let preselectedEnvId = null;

  if (envIdOrIncomeId) {
    const isIncome = (state.incomes || []).some((i) => i.id === envIdOrIncomeId) || (state.sources || []).some((s) => s.id === envIdOrIncomeId);
    const isEnv = (state.envelopes || []).some((e) => e.id === envIdOrIncomeId);
    if (isIncome) {
      incomeId = envIdOrIncomeId;
      preselectedEnvId = maybeEnvId;
    } else if (isEnv) {
      preselectedEnvId = envIdOrIncomeId;
      incomeId = maybeEnvId;
    } else {
      incomeId = envIdOrIncomeId;
    }
  }

  if (!preselectedEnvId && currentTab === 'envelope-detail' && currentEnvelopeDetailId) {
    preselectedEnvId = currentEnvelopeDetailId;
  }

  const isEdit = !!incomeId;
  const s = isEdit ? getUnifiedIncomes().find((x) => x.id === incomeId) : null;
  const targetEnvId = s ? (s.envelopeId || s.envelope || '') : (preselectedEnvId || state.envelopes[0]?.id || '');
  const targetEnv = (state.envelopes || []).find((e) => e.id === targetEnvId);
  const isContextual = !!targetEnv && (!!preselectedEnvId || currentTab === 'envelope-detail') && !isEdit;

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  const envOpts = `<option value="" ${!targetEnvId ? 'selected' : ''}>Fondo general (Sin sobre específico)</option>` +
    (state.envelopes || []).map((e) => {
      return `<option value="${e.id}" ${e.id === targetEnvId ? 'selected' : ''}>${e.name}${e.bank ? ` (${e.bank})` : ''}</option>`;
    }).join('');

  const curStatus = s ? (s.status || 'recibido') : 'recibido';

  content.innerHTML = `
    <div class="modal-info-content compact-modal" style="max-width:430px">
      <div class="modal-info-header">
        <h3>${isEdit ? 'Editar ingreso' : 'Registrar ingreso'}</h3>
        <button type="button" class="btn-ghost btn-sm" id="source-modal-close" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form id="source-modal-form" class="compact-form">
        ${isContextual ? `
          <div class="context-env-badge" style="border-left-color:${targetEnv.color || '#3b82f6'}">
            <div class="context-env-left">
              <span class="context-dot" style="background:${targetEnv.color || '#3b82f6'}"></span>
              <span class="context-env-name">Sobre: <b>${targetEnv.name}</b></span>
              ${targetEnv.bank ? `<span class="context-env-bank">${targetEnv.bank}</span>` : ''}
            </div>
            <span class="context-env-disp">Disp: <b>${money(getEnvelopeTotals(targetEnv).available)}</b></span>
          </div>
          <input type="hidden" id="modal-src-envelope" value="${targetEnv.id}" />
        ` : `
          <div class="field">
            <label>Sobre destino (opcional)</label>
            <select id="modal-src-envelope">
              ${envOpts}
            </select>
          </div>
        `}

        <div class="field">
          <label>Descripción / Concepto</label>
          <input id="modal-src-name" placeholder="Ej. Salario, Beca, Pago de cliente..." value="${s ? s.name : ''}" required />
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Monto esperado / recibido (₡)</label>
            <div class="amount-input-wrap">
              <span class="currency-symbol">₡</span>
              <input id="modal-src-amount" type="text" inputmode="decimal" placeholder="0.00" value="${s ? formatAmountString(s.amount) : ''}" required />
            </div>
          </div>

          <div class="field">
            <label>Estado del ingreso</label>
            <select id="modal-src-status">
              <option value="recibido" ${curStatus === 'recibido' ? 'selected' : ''}>Recibido (Disponible)</option>
              <option value="pendiente" ${curStatus === 'pendiente' ? 'selected' : ''}>Pendiente (Proyectado)</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label>Fecha o fecha estimada (opcional)</label>
          <input id="modal-src-date" type="date" value="${s ? (s.date || '') : ''}" />
        </div>

        <div id="modal-src-sim-box" class="expense-sim-box compact-sim" style="display:none"></div>

        <div class="modal-actions-compact">
          <button type="button" class="btn-ghost btn-sm" id="source-modal-cancel" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
          <button type="submit" class="btn-primary btn-sm">${isEdit ? 'Guardar cambios' : 'Guardar ingreso'}</button>
        </div>
      </form>
    </div>
  `;

  if (!isContextual) {
    _buildCsel('modal-src-envelope', {});
  }
  _buildCsel('modal-src-status', { isStatus: true });
  attachAmountFormatter($('modal-src-amount'));

  const envSelect = $('modal-src-envelope');
  const statusSelect = $('modal-src-status');
  const amountInput = $('modal-src-amount');
  const simBox = $('modal-src-sim-box');

  function updateIncomeSimulation() {
    const envId = envSelect.value;
    const statusVal = statusSelect.value;
    const env = (state.envelopes || []).find((e) => e.id === envId);
    const amount = parseAmount(amountInput.value || 0);

    if (!amount || amount <= 0) {
      if (simBox) simBox.style.display = 'none';
      return;
    }

    simBox.style.display = 'flex';
    if (statusVal === 'pendiente') {
      simBox.innerHTML = `
        <div class="sim-row">
          <span style="color:var(--warn);font-weight:600">Ingreso futuro proyectado:</span>
          <span style="font-weight:700;color:var(--warn)">+${money(amount)}</span>
        </div>
        <div style="font-size:0.72rem;color:var(--text-2);line-height:1.35">
          Se registrará como <b>Pendiente</b> y no se sumará al dinero realmente disponible hasta que confirmes su recepción.
        </div>
      `;
      return;
    }

    const globalSum = getGlobalFinancialSummary();
    const baseCurrent = env ? getEnvelopeTotals(env).available : globalSum.availableMoney;
    const wasAlreadyReceived = (isEdit && s && (s.status === 'recibido' || !s.status) && (!env || s.envelopeId === envId))
      ? Number(s.amount || 0)
      : 0;
    const currentAvailable = baseCurrent - wasAlreadyReceived;
    const newAvailable = currentAvailable + amount;

    simBox.innerHTML = `
      <div class="sim-row">
        <span style="color:var(--text-2)">Disponible actual${env ? ` (${env.name})` : ''}:</span>
        <span style="font-weight:600">${money(currentAvailable)}</span>
      </div>
      <div class="sim-row">
        <span style="font-weight:600;color:var(--text)">Nuevo disponible real:</span>
        <div class="sim-calc-flow">
          <span>${money(currentAvailable)}</span>
          <span class="arrow">+ ${money(amount)} →</span>
          <span class="new-bal" style="color:var(--success)">${money(newAvailable)}</span>
        </div>
      </div>
    `;
  }

  if (!isContextual && envSelect && envSelect.tagName === 'SELECT') {
    envSelect.addEventListener('change', () => {
      _refreshCsel('modal-src-envelope');
      updateIncomeSimulation();
    });
  }
  statusSelect?.addEventListener('change', () => {
    _refreshCsel('modal-src-status');
    updateIncomeSimulation();
  });
  amountInput.addEventListener('input', updateIncomeSimulation);
  updateIncomeSimulation();

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
    const envelopeId = $('modal-src-envelope').value || '';
    const status = $('modal-src-status').value || 'recibido';
    const rawDate = $('modal-src-date').value || '';
    const date = rawDate || (status === 'recibido' ? new Date().toISOString().slice(0, 10) : '');

    if (!name || !amount || amount <= 0) {
      toast('Ingresa una descripción y un monto válido mayor a 0');
      return;
    }

    const targetEnvObj = (state.envelopes || []).find((e) => e.id === envelopeId);

    if (isEdit) {
      const inc1 = (state.incomes || []).find((x) => x.id === incomeId);
      const inc2 = (state.sources || []).find((x) => x.id === incomeId);
      if (inc1) Object.assign(inc1, { name, amount, envelopeId, date, status });
      if (inc2) Object.assign(inc2, { name, amount, envelopeId, date, status });
      ensureEnvelopes();
      toast(`Ingreso "${name}" actualizado (${status === 'pendiente' ? 'Pendiente' : 'Recibido'})`);
    } else {
      const newInc = { id: uid(), name, amount, envelopeId, date, status };
      state.incomes.push(newInc);
      state.sources.push(newInc);
      ensureEnvelopes();
      if (status === 'pendiente') {
        toast(`Ingreso proyectado "${name}" (${money(amount)}) registrado como pendiente`);
      } else {
        toast(`Ingreso de ${money(amount)} registrado en ${targetEnvObj?.name || 'fondo disponible'}`);
      }
    }

    overlay.style.display = 'none';
    renderAll();
    const finalEnvId = preselectedEnvId || (currentTab === 'envelope-detail' ? currentEnvelopeDetailId : null);
    if (finalEnvId) {
      renderEnvelopeDetailPage(finalEnvId);
    }
  });
};

window.deleteSource = function(id) {
  if (!confirm('¿Eliminar este registro de ingreso?')) return;
  state.incomes = (state.incomes || []).filter((s) => s.id !== id);
  state.sources = (state.sources || []).filter((s) => s.id !== id);
  state.assignments = (state.assignments || []).filter((a) => a.sourceId !== id);
  renderAll();
  if (currentTab === 'envelope-detail' && currentEnvelopeDetailId) {
    renderEnvelopeDetailPage(currentEnvelopeDetailId);
  }
  toast('Ingreso eliminado');
};

/* ============================================================
   SOURCE INFO & ASSIGNMENTS MODALS (COMPATIBILIDAD)
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
            Estado: <b>${s.status === 'recibido' ? 'Recibido' : 'Pendiente'}</b> · Fecha: <b>${fmt(s.date)}</b>
          </p>
        </div>
        <button type="button" class="btn-ghost btn-sm" id="modal-info-close" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="info-bars-container">
        <div class="info-bar-item">
          <div class="info-bar-header">
            <span class="name">Total Presupuestado</span>
            <span class="val">${money(total)}</span>
          </div>
          <div class="info-bar-track">
            <div class="info-bar-fill" style="width:100%; background:var(--accent)"></div>
          </div>
        </div>
        <div class="info-bar-item">
          <div class="info-bar-header">
            <span class="name">Asignado a categorías (${Math.round(pctAssigned)}%)</span>
            <span class="val">${money(t.assigned)}</span>
          </div>
          <div class="info-bar-track">
            <div class="info-bar-fill" style="width:${pctAssigned}%; background:var(--text)"></div>
          </div>
        </div>
        <div class="info-bar-item">
          <div class="info-bar-header">
            <span class="name">Sin asignar (${Math.round(pctUnassigned)}%)</span>
            <span class="val" style="color:${t.unassigned < 0 ? 'var(--danger)' : 'var(--success)'}">${money(t.unassigned)}</span>
          </div>
          <div class="info-bar-track">
            <div class="info-bar-fill" style="width:${pctUnassigned}%; background:${t.unassigned < 0 ? 'var(--danger)' : 'var(--success)'}"></div>
          </div>
        </div>
        <div class="info-bar-item">
          <div class="info-bar-header">
            <span class="name">Gastado real (${Math.round(pctSpentOfAssigned)}% de lo asignado)</span>
            <span class="val" style="color:var(--danger)">${money(t.spent)}</span>
          </div>
          <div class="info-bar-track">
            <div class="info-bar-fill" style="width:${pctSpentOfTotal}%; background:var(--danger)"></div>
          </div>
        </div>
      </div>
      ${cats.length ? `<div class="info-cat-breakdown">${cats.map(([cat, amt]) => `<div class="info-cat-row"><b>${cat}</b><span>${money(amt)}</span></div>`).join('')}</div>` : ''}
    </div>
  `;

  overlay.style.display = 'flex';
  overlay.onclick = (ev) => { if (ev.target === overlay) overlay.style.display = 'none'; };
};

window.openSourceAssignmentsModal = function(sourceId) {
  const s = state.sources.find((x) => x.id === sourceId);
  if (!s) return;
  openSourceInfoModal(sourceId);
};

/* ============================================================
   PRESUPUESTOS PERSONALIZADOS Y OBJETIVOS (REQ 3)
   ============================================================ */

const PRESET_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6',
  '#6366f1', '#f97316', '#64748b', '#84cc16'
];

function renderBudgets() {
  const el = $('budgets-list');
  const countEl = $('budgets-count');
  if (!el) return;

  const budgets = state.budgets || [];
  if (countEl) countEl.textContent = String(budgets.length);

  if (!budgets.length) {
    el.innerHTML = `<div class="empty-state" style="padding:1.5rem">
      <p>Sin presupuestos personalizados configurados</p>
      <span>Establece presupuestos con monto objetivo, fechas de inicio y límite, categorías asociadas, límites de gasto y reservas</span>
    </div>`;
    return;
  }

  el.innerHTML = budgets.map((b) => {
    const bt = getBudgetTotals(b);
    const env = b.envelopeId ? (state.envelopes || []).find((e) => e.id === b.envelopeId) : null;
    const hasDates = b.startDate || b.endDate;
    const assocCats = Array.isArray(b.categories) ? b.categories : [];

    return `
      <div class="category-card" data-budget-id="${b.id}">
        <div class="category-header">
          <div class="category-title">
            <span class="cat-dot" style="background:${b.color || '#3b82f6'}"></span>
            <div>
              <div>${b.name}</div>
              ${b.description ? `<div style="font-size:0.73rem;font-weight:400;color:var(--text-2)">${b.description}</div>` : ''}
            </div>
          </div>
          <div class="category-card-actions">
            <button type="button" class="btn-secondary btn-sm" onclick="openExpenseModal('${b.envelopeId || ''}', null, '${assocCats[0] || ''}', '${b.id}')" title="Registrar gasto en este presupuesto">
              + Gasto
            </button>
            <button type="button" class="btn-secondary btn-sm" onclick="openBudgetModal('${b.id}')">
              Editar
            </button>
            <button type="button" class="btn-danger btn-sm" onclick="deleteBudget('${b.id}')">
              Eliminar
            </button>
          </div>
        </div>

        <div class="category-body">
          ${(hasDates || env || assocCats.length > 0) ? `
            <div class="meta-tags-row">
              ${hasDates ? `<span class="meta-chip">Fechas: <b>${fmt(b.startDate)} → ${fmt(b.endDate)}</b></span>` : ''}
              ${env ? `<span class="meta-chip">Sobre: <b>${env.name}</b></span>` : ''}
              ${assocCats.map((c) => `<span class="meta-chip accent">${c}</span>`).join('')}
            </div>
          ` : ''}

          <div class="category-metrics-grid cols-5">
            <div class="cat-metric-box">
              <span class="label">Monto Objetivo</span>
              <span class="val">${bt.targetAmount > 0 ? money(bt.targetAmount) : 'No definido'}</span>
            </div>
            <div class="cat-metric-box">
              <span class="label">Límite de Gasto</span>
              <span class="val">${bt.spendingLimit > 0 ? money(bt.spendingLimit) : 'Sin tope'}</span>
            </div>
            <div class="cat-metric-box">
              <span class="label">Dinero Reservado</span>
              <span class="val" style="color:${bt.reserved > 0 ? 'var(--warn)' : 'var(--text-2)'}">${money(bt.reserved)}</span>
            </div>
            <div class="cat-metric-box">
              <span class="label">Dinero Gastado</span>
              <span class="val spent">${money(bt.spent)}</span>
            </div>
            <div class="cat-metric-box">
              <span class="label">Presupuesto Restante</span>
              <span class="val ${bt.remainingBudget < 0 ? 'over' : 'remaining'}">${money(bt.remainingBudget)}</span>
            </div>
          </div>

          ${bt.baseCap > 0 ? `
            <div class="cat-progress-wrap">
              <div class="progress-bar" style="flex:1;margin-bottom:0">
                <div class="progress-fill" style="width:${bt.pctLimit}%;background:${bt.isOverLimit ? 'var(--danger)' : (bt.isNearLimit ? 'var(--warn)' : (b.color || 'var(--primary)'))}"></div>
              </div>
              <span class="cat-pct">${Math.round(bt.rawLimitPct)}%</span>
            </div>
          ` : ''}

          ${bt.isOverLimit ? `
            <div class="limit-alert-banner danger">
              <span>Alerta: Se ha superado el límite o monto objetivo de este presupuesto.</span>
              <b>Exceso: ${money(Math.abs(bt.limitRemaining !== null && bt.limitRemaining < 0 ? bt.limitRemaining : bt.remainingBudget))}</b>
            </div>
          ` : (bt.isNearLimit ? `
            <div class="limit-alert-banner warn">
              <span>Atención: Estás llegando al límite establecido (${Math.round(bt.rawLimitPct)}% utilizado).</span>
              <b>Restante: ${money(bt.limitRemaining !== null ? bt.limitRemaining : bt.remainingBudget)}</b>
            </div>
          ` : '')}
        </div>
      </div>
    `;
  }).join('');
}

window.openBudgetModal = function(budgetId = null) {
  const isEdit = !!budgetId;
  const existing = isEdit ? (state.budgets || []).find((b) => b.id === budgetId) : null;

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  let selectedColor = existing ? (existing.color || '#3b82f6') : PRESET_COLORS[0];
  const selectedCats = new Set(existing && Array.isArray(existing.categories) ? existing.categories : []);
  const linkedReserve = existing ? (state.reserves || []).find((r) => r.budgetId === existing.id) : null;
  const currentReservedVal = linkedReserve ? linkedReserve.amount : (existing ? existing.reservedAmount : 0);

  const envOpts = `<option value="">Sin sobre específico (General)</option>` +
    (state.envelopes || []).map((e) => `<option value="${e.id}" ${existing && existing.envelopeId === e.id ? 'selected' : ''}>${e.name}${e.bank ? ` (${e.bank})` : ''}</option>`).join('');

  content.innerHTML = `
    <div class="modal-info-content compact-modal" style="max-width:460px">
      <div class="modal-info-header">
        <h3>${isEdit ? 'Editar presupuesto personalizado' : 'Nuevo presupuesto personalizado'}</h3>
        <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form id="budget-modal-form" class="compact-form">
        <div class="field">
          <label>Nombre o título</label>
          <input id="budget-modal-name" placeholder="Escribe el nombre del presupuesto u objetivo..." value="${existing ? existing.name : ''}" required />
        </div>

        <div class="field">
          <label>Descripción (opcional)</label>
          <input id="budget-modal-desc" placeholder="Detalles o notas del presupuesto..." value="${existing ? (existing.description || '') : ''}" />
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Monto objetivo (₡, opcional)</label>
            <div class="amount-input-wrap">
              <span class="currency-symbol">₡</span>
              <input id="budget-modal-target" type="text" inputmode="decimal" placeholder="0.00" value="${existing && existing.targetAmount ? formatAmountString(existing.targetAmount) : ''}" />
            </div>
          </div>

          <div class="field">
            <label>Límite de gasto (₡, opcional)</label>
            <div class="amount-input-wrap">
              <span class="currency-symbol">₡</span>
              <input id="budget-modal-limit" type="text" inputmode="decimal" placeholder="0.00" value="${existing && existing.spendingLimit ? formatAmountString(existing.spendingLimit) : ''}" />
            </div>
          </div>
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Fecha de inicio (opcional)</label>
            <input id="budget-modal-start" type="date" value="${existing ? (existing.startDate || '') : ''}" />
          </div>

          <div class="field">
            <label>Fecha límite (opcional)</label>
            <input id="budget-modal-end" type="date" value="${existing ? (existing.endDate || '') : ''}" />
          </div>
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Dinero reservado (₡, opcional)</label>
            <div class="amount-input-wrap">
              <span class="currency-symbol">₡</span>
              <input id="budget-modal-reserved" type="text" inputmode="decimal" placeholder="0.00" value="${currentReservedVal ? formatAmountString(currentReservedVal) : ''}" />
            </div>
          </div>

          <div class="field">
            <label>Sobre asociado (opcional)</label>
            <select id="budget-modal-env">
              ${envOpts}
            </select>
          </div>
        </div>

        <div class="field">
          <label>Categorías asociadas (opcional)</label>
          ${(state.categories || []).length > 0 ? `
            <div class="category-picker-chips" id="budget-modal-cats">
              ${state.categories.map((c) => `
                <span class="cat-select-chip ${selectedCats.has(c.name) ? 'selected' : ''}" data-cat="${c.name}">
                  <span class="cat-dot" style="background:${c.color};width:7px;height:7px"></span>
                  ${c.name}
                </span>
              `).join('')}
            </div>
          ` : `
            <div style="font-size:0.75rem;color:var(--text-3);padding:0.4rem 0.6rem;background:var(--bg-alt);border-radius:var(--radius-sm)">
              Aún no has creado categorías personalizadas. Puedes crearlas desde la sección de Categorías.
            </div>
          `}
        </div>

        <div class="field">
          <label>Color</label>
          <div class="color-picker-grid compact-picker" id="budget-color-grid">
            ${PRESET_COLORS.map((c) => `
              <div class="color-swatch ${c.toLowerCase() === selectedColor.toLowerCase() ? 'selected' : ''}" style="background:${c}" data-color="${c}"></div>
            `).join('')}
          </div>
        </div>

        <div class="modal-actions-compact">
          <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
          <button type="submit" class="btn-primary btn-sm">${isEdit ? 'Guardar cambios' : 'Crear presupuesto'}</button>
        </div>
      </form>
    </div>
  `;

  attachAmountFormatter($('budget-modal-target'));
  attachAmountFormatter($('budget-modal-limit'));
  attachAmountFormatter($('budget-modal-reserved'));
  _buildCsel('budget-modal-env', {});

  content.querySelectorAll('#budget-modal-cats .cat-select-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const cat = chip.getAttribute('data-cat');
      if (selectedCats.has(cat)) {
        selectedCats.delete(cat);
        chip.classList.remove('selected');
      } else {
        selectedCats.add(cat);
        chip.classList.add('selected');
      }
    });
  });

  const swatches = content.querySelectorAll('#budget-color-grid .color-swatch');
  swatches.forEach((sw) => {
    sw.addEventListener('click', () => {
      swatches.forEach((s) => s.classList.remove('selected'));
      sw.classList.add('selected');
      selectedColor = sw.getAttribute('data-color');
    });
  });

  overlay.style.display = 'flex';
  $('budget-modal-name').focus();
  overlay.onclick = (ev) => { if (ev.target === overlay) overlay.style.display = 'none'; };

  $('budget-modal-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = $('budget-modal-name').value.trim();
    const description = $('budget-modal-desc').value.trim();
    const targetAmount = parseAmount($('budget-modal-target').value || 0);
    const spendingLimit = parseAmount($('budget-modal-limit').value || 0);
    const reservedAmount = parseAmount($('budget-modal-reserved').value || 0);
    const startDate = $('budget-modal-start').value || '';
    const endDate = $('budget-modal-end').value || '';
    const envelopeId = $('budget-modal-env').value || '';
    const categories = Array.from(selectedCats);

    if (!name) {
      toast('Ingresa un nombre para el presupuesto');
      return;
    }

    if (startDate && endDate && endDate < startDate) {
      toast('La fecha límite no puede ser anterior a la fecha de inicio');
      return;
    }

    let savedBudgetId = budgetId;
    if (isEdit && existing) {
      Object.assign(existing, {
        name,
        description,
        targetAmount,
        spendingLimit,
        reservedAmount,
        startDate,
        endDate,
        envelopeId,
        categories,
        color: selectedColor
      });
    } else {
      savedBudgetId = uid();
      state.budgets.push({
        id: savedBudgetId,
        name,
        description,
        targetAmount,
        spendingLimit,
        reservedAmount,
        startDate,
        endDate,
        envelopeId,
        categories,
        color: selectedColor
      });
    }

    // Sincronizar reserva vinculada para que se refleje en Dinero Reservado y Disponible
    const existingRes = (state.reserves || []).find((r) => r.budgetId === savedBudgetId);
    if (reservedAmount > 0) {
      if (existingRes) {
        existingRes.name = `Reserva: ${name}`;
        existingRes.amount = reservedAmount;
        existingRes.initialAmount = Math.max(existingRes.initialAmount || 0, reservedAmount);
        existingRes.envelopeId = envelopeId;
      } else {
        state.reserves.push({
          id: uid(),
          name: `Reserva: ${name}`,
          initialAmount: reservedAmount,
          amount: reservedAmount,
          usedAmount: 0,
          releasedAmount: 0,
          envelopeId,
          budgetId: savedBudgetId,
          category: categories[0] || '',
          date: new Date().toISOString().slice(0, 10),
          usages: []
        });
      }
    } else if (existingRes) {
      state.reserves = state.reserves.filter((r) => r.id !== existingRes.id);
    }

    overlay.style.display = 'none';
    renderAll();
    toast(isEdit ? `Presupuesto "${name}" actualizado` : `Presupuesto "${name}" creado`);
  });
};

window.deleteBudget = function(budgetId) {
  const b = (state.budgets || []).find((x) => x.id === budgetId);
  if (!b) return;
  if (!confirm(`¿Eliminar el presupuesto "${b.name}"?`)) return;
  state.budgets = (state.budgets || []).filter((x) => x.id !== budgetId);
  state.reserves = (state.reserves || []).filter((r) => r.budgetId !== budgetId);
  renderAll();
  toast(`Presupuesto "${b.name}" eliminado`);
};

/* ============================================================
   CATEGORÍAS CONFIGURABLES (REQ 4)
   ============================================================ */

window.openCategoryModal = function(catName = null) {
  const isEdit = !!catName;
  const existing = isEdit ? (state.categories || []).find((c) => c.name === catName) : null;

  let selectedColor = existing ? existing.color : PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];
  const isCustomColor = !PRESET_COLORS.some((c) => c.toLowerCase() === selectedColor.toLowerCase());

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  const curPeriod = existing ? (existing.periodType || '') : '';

  content.innerHTML = `
    <div class="modal-info-content compact-modal" style="max-width:460px">
      <div class="modal-info-header">
        <h3>${isEdit ? 'Editar categoría' : 'Nueva categoría personalizada'}</h3>
        <button type="button" class="btn-ghost btn-sm" id="cat-modal-close" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form id="cat-modal-form" class="compact-form">
        <div class="field">
          <label>Nombre de la categoría</label>
          <input id="cat-modal-name" placeholder="Escribe el nombre de la categoría..." value="${existing ? existing.name : ''}" required />
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Presupuesto asignado (₡, opcional)</label>
            <div class="amount-input-wrap">
              <span class="currency-symbol">₡</span>
              <input id="cat-modal-budget" type="text" inputmode="decimal" placeholder="0.00" value="${existing && existing.budget ? formatAmountString(existing.budget) : ''}" />
            </div>
          </div>

          <div class="field">
            <label>Límite de gasto (₡, opcional)</label>
            <div class="amount-input-wrap">
              <span class="currency-symbol">₡</span>
              <input id="cat-modal-limit" type="text" inputmode="decimal" placeholder="0.00" value="${existing && existing.spendingLimit ? formatAmountString(existing.spendingLimit) : ''}" />
            </div>
          </div>
        </div>

        <div class="field">
          <label>Periodo (opcional)</label>
          <select id="cat-modal-period">
            <option value="" ${curPeriod === '' ? 'selected' : ''}>Sin periodo fijo</option>
            <option value="dia" ${curPeriod === 'dia' ? 'selected' : ''}>Diario</option>
            <option value="semana" ${curPeriod === 'semana' ? 'selected' : ''}>Semanal</option>
            <option value="quincena" ${curPeriod === 'quincena' ? 'selected' : ''}>Quincenal</option>
            <option value="mes" ${curPeriod === 'mes' ? 'selected' : ''}>Mensual</option>
            <option value="personalizado" ${curPeriod === 'personalizado' ? 'selected' : ''}>Periodo personalizado</option>
          </select>
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Fecha de inicio (opcional)</label>
            <input id="cat-modal-start" type="date" value="${existing ? (existing.startDate || '') : ''}" />
          </div>

          <div class="field">
            <label>Fecha límite (opcional)</label>
            <input id="cat-modal-end" type="date" value="${existing ? (existing.endDate || '') : ''}" />
          </div>
        </div>

        <div class="field">
          <label>Color representativo</label>
          <div class="color-picker-grid" id="cat-preset-grid">
            ${PRESET_COLORS.map((c) => `
              <div class="color-swatch ${c.toLowerCase() === selectedColor.toLowerCase() ? 'selected' : ''}" style="background:${c}" data-color="${c}"></div>
            `).join('')}

            <label class="color-swatch custom-color-picker ${isCustomColor ? 'selected' : ''}" id="gotero-swatch" title="Color personalizado con gotero" style="background:${isCustomColor ? selectedColor : 'var(--bg-alt)'}">
              <input type="color" id="cat-native-color" value="${selectedColor}" class="sr-only-color-input" />
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m2 22 5-5"/><path d="M9.5 14.5 16 8"/><path d="m17 7 3-3a2.12 2.12 0 0 1 3 3l-3 3"/><path d="m14.5 9.5 3 3"/><path d="M11.5 12.5 4 20v2h2l7.5-7.5"/>
              </svg>
            </label>
          </div>
        </div>

        <div style="padding:0.5rem 0.75rem;background:var(--bg-alt);border:1px solid var(--border);border-radius:var(--radius-sm);display:flex;align-items:center;gap:0.6rem">
          <span style="font-size:0.75rem;color:var(--text-3)">Vista previa:</span>
          <span class="badge" id="cat-preview-badge" style="background:${selectedColor};color:#fff;font-weight:600;padding:0.2rem 0.55rem">
            ${existing ? existing.name : 'Categoría'}
          </span>
        </div>

        <div class="modal-actions-compact">
          <button type="button" class="btn-ghost btn-sm" id="cat-modal-cancel" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
          <button type="submit" class="btn-primary btn-sm">${isEdit ? 'Guardar cambios' : 'Crear categoría'}</button>
        </div>
      </form>
    </div>
  `;

  attachAmountFormatter($('cat-modal-budget'));
  attachAmountFormatter($('cat-modal-limit'));
  _buildCsel('cat-modal-period', {});

  const periodSel = $('cat-modal-period');
  const startInp = $('cat-modal-start');
  const endInp = $('cat-modal-end');

  const autoUpdateEndDate = () => {
    const pType = periodSel.value;
    if (pType && pType !== 'personalizado') {
      if (!startInp.value) {
        startInp.value = new Date().toISOString().slice(0, 10);
      }
      const computed = computePeriodEndDate(startInp.value, pType);
      if (computed) endInp.value = computed;
    }
  };

  periodSel?.addEventListener('change', () => {
    _refreshCsel('cat-modal-period');
    autoUpdateEndDate();
  });
  startInp?.addEventListener('change', () => {
    if (periodSel.value && periodSel.value !== 'personalizado') {
      autoUpdateEndDate();
    }
  });

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
    previewBadge.textContent = ev.target.value.trim() || 'Categoría';
  });

  overlay.style.display = 'flex';
  nameInput.focus();

  $('cat-modal-close')?.addEventListener('click', () => { overlay.style.display = 'none'; });
  $('cat-modal-cancel')?.addEventListener('click', () => { overlay.style.display = 'none'; });
  overlay.onclick = (ev) => { if (ev.target === overlay) overlay.style.display = 'none'; };

  $('cat-modal-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;

    const budget = parseAmount($('cat-modal-budget').value || 0);
    const spendingLimit = parseAmount($('cat-modal-limit').value || 0);
    const periodType = $('cat-modal-period').value || '';
    const startDate = $('cat-modal-start').value || '';
    const endDate = $('cat-modal-end').value || '';

    if (startDate && endDate && endDate < startDate) {
      toast('La fecha límite no puede ser anterior a la fecha de inicio');
      return;
    }

    if (!isEdit && state.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast('Esa categoría ya existe');
      return;
    }

    if (isEdit) {
      const cat = state.categories.find((c) => c.name === catName);
      if (cat) {
        cat.name = name;
        cat.color = selectedColor;
        cat.budget = budget;
        cat.spendingLimit = spendingLimit;
        cat.periodType = periodType;
        cat.startDate = startDate;
        cat.endDate = endDate;
      }
      state.expenses.forEach((ex) => { if (ex.category === catName) ex.category = name; });
      state.assignments.forEach((a) => { if (a.category === catName) a.category = name; });
      state.budgets.forEach((b) => {
        if (Array.isArray(b.categories)) {
          b.categories = b.categories.map((c) => c === catName ? name : c);
        }
      });
      state.periodLimits.forEach((pl) => {
        if (pl.category === catName) pl.category = name;
      });
      state.sources.forEach((s) => {
        if (s.distribution && s.distribution[catName] !== undefined) {
          s.distribution[name] = s.distribution[catName];
          if (name !== catName) delete s.distribution[catName];
        }
      });
      toast(`Categoría "${name}" actualizada`);
    } else {
      state.categories.push({
        id: uid(),
        name,
        color: selectedColor,
        budget,
        spendingLimit,
        periodType,
        startDate,
        endDate
      });
      toast(`Categoría "${name}" creada`);
    }

    overlay.style.display = 'none';
    renderAll();
  });
};

function renderCategories() {
  const el = $('categories');
  const countEl = $('categories-count');
  const filterCatEl = $('filter-category');

  const opts = (state.categories || []).map((c) => `<option value="${c.name}">${c.name}</option>`).join('');
  if (filterCatEl) {
    const curVal = filterCatEl.value;
    filterCatEl.innerHTML = `<option value="">Todas las categorías</option>${opts}`;
    if (curVal) filterCatEl.value = curVal;
    _refreshCsel('filter-category');
  }

  if (countEl) countEl.textContent = String((state.categories || []).length);
  if (!el) return;

  const map = categoryMap();
  const entries = Object.entries(map);
  if (!entries.length) {
    el.innerHTML = `<div class="empty-state" style="padding:1.5rem">
      <p>Sin categorías personalizadas</p>
      <span>Crea tus categorías y asígnales presupuesto, límites de gasto y fechas según tus necesidades</span>
    </div>`;
    return;
  }

  const periodLabels = {
    dia: 'Diario',
    semana: 'Semanal',
    quincena: 'Quincenal',
    mes: 'Mensual',
    personalizado: 'Personalizado'
  };

  el.innerHTML = entries.map(([cat, d]) => {
    const hasDates = d.startDate || d.endDate;
    const periodLabel = d.periodType ? (periodLabels[d.periodType] || d.periodType) : '';
    const detail = Object.values(d.bySource || {}).filter((x) => x.assigned > 0 || x.spent > 0).map((x) => `
      <div class="breakdown-row">
        <span class="src-name">${x.sourceName}</span>
        <div class="src-vals">
          <span>Asig: <b>${money(x.assigned)}</b></span>
          <span>Gast: <b>${money(x.spent)}</b></span>
          <span>Disp: <b>${money(x.assigned - x.spent)}</b></span>
        </div>
      </div>`).join('');

    const barColor = d.isOverLimit ? 'var(--danger)' : (d.isNearLimit ? 'var(--warn)' : d.color);

    return `<div class="category-card" data-category-name="${cat}">
      <div class="category-header">
        <div class="category-title">
          <span class="cat-dot" style="background:${d.color}"></span>
          <span>${cat}</span>
          ${periodLabel ? `<span class="meta-chip">${periodLabel}</span>` : ''}
          ${hasDates ? `<span class="meta-chip">${fmt(d.startDate)} → ${fmt(d.endDate)}</span>` : ''}
        </div>
        <div class="category-card-actions">
          <button type="button" class="btn-secondary btn-sm" onclick="openExpenseModal('', null, '${cat.replace(/'/g, "\\'")}')" title="Registrar gasto en esta categoría">
            + Gasto
          </button>
          <button type="button" class="btn-secondary btn-sm" onclick="openCategoryModal('${cat.replace(/'/g, "\\'")}')" title="Editar presupuesto, límite o fechas de la categoría">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Configurar / Editar
          </button>
          <button type="button" class="btn-danger btn-sm" onclick="deleteCategory('${cat.replace(/'/g, "\\'")}')" title="Eliminar categoría de forma segura">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Eliminar
          </button>
        </div>
      </div>

      <div class="category-body">
        <div class="category-metrics-grid ${d.spendingLimit > 0 ? 'cols-4' : ''}">
          <div class="cat-metric-box">
            <span class="label">Presupuesto asignado</span>
            <span class="val">${money(d.effectiveBudget)}</span>
          </div>
          ${d.spendingLimit > 0 ? `
            <div class="cat-metric-box">
              <span class="label">Límite de gasto</span>
              <span class="val">${money(d.spendingLimit)}</span>
            </div>
          ` : ''}
          <div class="cat-metric-box">
            <span class="label">Gastado</span>
            <span class="val spent">${money(d.spent)}</span>
          </div>
          <div class="cat-metric-box">
            <span class="label">Queda disponible</span>
            <span class="val ${d.remaining < 0 ? 'over' : 'remaining'}">${money(d.remaining)}</span>
          </div>
        </div>

        <div class="cat-progress-wrap">
          <div class="progress-bar" style="flex:1;margin-bottom:0">
            <div class="progress-fill" style="width:${d.pct}%; background:${barColor}"></div>
          </div>
          <span class="cat-pct">${Math.round(d.rawPct)}%</span>
        </div>

        ${d.isOverLimit ? `
          <div class="limit-alert-banner danger">
            <span>Límite o presupuesto excedido en "${cat}"</span>
            <b>Exceso: ${money(Math.abs(d.remaining))}</b>
          </div>
        ` : (d.isNearLimit ? `
          <div class="limit-alert-banner warn">
            <span>Cerca del límite en "${cat}" (${Math.round(d.rawPct)}% utilizado)</span>
            <b>Queda: ${money(d.remaining)}</b>
          </div>
        ` : '')}

        ${detail ? `<details><summary>Desglose por origen</summary><div class="source-breakdown">${detail}</div></details>` : ''}
      </div>
    </div>`;
  }).join('');
}

window.deleteCategory = function(name) {
  const associatedExpenses = (state.expenses || []).filter((e) => e.category === name);
  const msg = associatedExpenses.length > 0
    ? `¿Eliminar la categoría "${name}"? Los ${associatedExpenses.length} gasto(s) registrados se conservarán de forma segura en tu historial sin categoría asignada.`
    : `¿Eliminar la categoría "${name}"?`;

  if (!confirm(msg)) return;

  state.categories = (state.categories || []).filter((c) => c.name !== name);
  state.assignments = (state.assignments || []).filter((a) => a.category !== name);
  // Conservar los gastos de forma segura desvinculando la categoría eliminada
  state.expenses.forEach((e) => {
    if (e.category === name) e.category = '';
  });
  state.budgets.forEach((b) => {
    if (Array.isArray(b.categories)) {
      b.categories = b.categories.filter((c) => c !== name);
    }
  });
  state.periodLimits.forEach((pl) => {
    if (pl.category === name) pl.category = '';
  });
  state.sources.forEach((s) => {
    if (s.distribution && s.distribution[name] !== undefined) {
      delete s.distribution[name];
    }
  });
  rebuildDistributionsFromAssignments();
  renderAll();
  toast(`Categoría "${name}" eliminada de forma segura`);
};

/* ============================================================
   CONTROL DE GASTOS POR PERIODO (REQ 5)
   ============================================================ */

const PERIOD_TYPE_LABELS = {
  dia: 'Día',
  semana: 'Semana',
  quincena: 'Quincena',
  mes: 'Mes',
  personalizado: 'Periodo personalizado'
};

function renderPeriodLimits() {
  const el = $('period-limits-list');
  const countEl = $('period-limits-count');
  if (!el) return;

  const list = state.periodLimits || [];
  if (countEl) countEl.textContent = String(list.length);

  if (!list.length) {
    el.innerHTML = `<div class="empty-state" style="padding:1.5rem">
      <p>Sin límites de gasto por periodo configurados</p>
      <span>Establece topes por día, semana, quincena, mes o fechas personalizadas y conserva el saldo no utilizado entre periodos</span>
    </div>`;
    return;
  }

  el.innerHTML = list.map((pl) => {
    const st = getPeriodLimitStats(pl);
    const pLabel = PERIOD_TYPE_LABELS[pl.periodType] || pl.periodType || 'Periodo';
    const env = pl.envelopeId ? (state.envelopes || []).find((e) => e.id === pl.envelopeId) : null;
    const barColor = st.isOverLimit ? 'var(--danger)' : (st.isNearLimit ? 'var(--warn)' : 'var(--success)');

    const historyRows = (st.history || []).map((h) => `
      <div class="breakdown-row">
        <span class="src-name">${fmt(h.startDate)} → ${fmt(h.endDate)}</span>
        <div class="src-vals">
          <span>Límite: <b>${money(h.effectiveLimit)}</b></span>
          <span>Gastado: <b style="color:var(--danger)">${money(h.spent)}</b></span>
          <span>Restante: <b style="color:${h.remaining < 0 ? 'var(--danger)' : 'var(--success)'}">${money(h.remaining)}</b></span>
          <span>Uso: <b>${Math.round(h.pctUsed || 0)}%</b></span>
        </div>
      </div>
    `).join('');

    return `
      <div class="category-card" data-period-limit-id="${pl.id}">
        <div class="category-header">
          <div class="category-title">
            <span class="meta-chip accent">${pLabel}</span>
            <span>${pl.name}</span>
          </div>
          <div class="category-card-actions">
            <button type="button" class="btn-secondary btn-sm" onclick="advancePeriodLimit('${pl.id}')" title="Cerrar periodo actual, guardar en historial y avanzar al siguiente periodo">
              Siguiente periodo →
            </button>
            <button type="button" class="btn-secondary btn-sm" onclick="openPeriodLimitModal('${pl.id}')">
              Editar
            </button>
            <button type="button" class="btn-danger btn-sm" onclick="deletePeriodLimit('${pl.id}')">
              Eliminar
            </button>
          </div>
        </div>

        <div class="category-body">
          <div class="meta-tags-row">
            <span class="meta-chip">Fechas: <b>${fmt(pl.startDate)} → ${fmt(pl.endDate)}</b></span>
            ${pl.rolloverUnused ? `<span class="meta-chip success">Conserva sobrante${st.carriedOver > 0 ? ` (+${money(st.carriedOver)} acum.)` : ''}</span>` : ''}
            ${pl.category ? `<span class="meta-chip">Categoría: <b>${pl.category}</b></span>` : ''}
            ${env ? `<span class="meta-chip">Sobre: <b>${env.name}</b></span>` : ''}
          </div>

          <div class="category-metrics-grid cols-4">
            <div class="cat-metric-box">
              <span class="label">Límite establecido</span>
              <span class="val">${money(st.effectiveLimit)}</span>
            </div>
            <div class="cat-metric-box">
              <span class="label">Dinero gastado</span>
              <span class="val spent">${money(st.spent)}</span>
            </div>
            <div class="cat-metric-box">
              <span class="label">Dinero restante</span>
              <span class="val ${st.remaining < 0 ? 'over' : 'remaining'}">${money(st.remaining)}</span>
            </div>
            <div class="cat-metric-box">
              <span class="label">Porcentaje utilizado</span>
              <span class="val" style="color:${barColor}">${st.rawPct.toFixed(1)}%</span>
            </div>
          </div>

          <div class="cat-progress-wrap">
            <div class="progress-bar" style="flex:1;margin-bottom:0">
              <div class="progress-fill" style="width:${st.pctUsed}%;background:${barColor}"></div>
            </div>
            <span class="cat-pct">${Math.round(st.rawPct)}%</span>
          </div>

          ${st.isOverLimit ? `
            <div class="limit-alert-banner danger">
              <span>¡Alerta de límite superado! Has excedido el límite de este periodo (${pLabel}).</span>
              <b>Exceso: ${money(Math.abs(st.remaining))}</b>
            </div>
          ` : (st.isNearLimit ? `
            <div class="limit-alert-banner warn">
              <span>Alerta preventiva: Estás llegando al límite del periodo (${st.rawPct.toFixed(1)}% utilizado).</span>
              <b>Disponible: ${money(st.remaining)}</b>
            </div>
          ` : '')}

          <details>
            <summary>Historial de periodos anteriores (${st.history.length})</summary>
            <div class="source-breakdown">
              ${historyRows || `<div style="font-size:0.75rem;color:var(--text-3);padding:0.4rem">Sin periodos anteriores archivados aún. Usa "Siguiente periodo →" al concluir el ciclo actual.</div>`}
            </div>
          </details>
        </div>
      </div>
    `;
  }).join('');
}

window.openPeriodLimitModal = function(limitId = null) {
  const isEdit = !!limitId;
  const existing = isEdit ? (state.periodLimits || []).find((x) => x.id === limitId) : null;

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  const curType = existing ? existing.periodType : 'semana';
  const todayStr = new Date().toISOString().slice(0, 10);
  const initStart = existing ? existing.startDate : todayStr;
  const initEnd = existing ? existing.endDate : computePeriodEndDate(initStart, curType);

  const envOpts = `<option value="">Todos los sobres (General)</option>` +
    (state.envelopes || []).map((e) => `<option value="${e.id}" ${existing && existing.envelopeId === e.id ? 'selected' : ''}>${e.name}</option>`).join('');

  const catOpts = `<option value="">Todas las categorías</option>` +
    (state.categories || []).map((c) => `<option value="${c.name}" ${existing && existing.category === c.name ? 'selected' : ''}>${c.name}</option>`).join('');

  content.innerHTML = `
    <div class="modal-info-content compact-modal" style="max-width:450px">
      <div class="modal-info-header">
        <h3>${isEdit ? 'Editar límite por periodo' : 'Nuevo límite de gasto por periodo'}</h3>
        <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form id="period-limit-form" class="compact-form">
        <div class="field">
          <label>Nombre o descripción del límite</label>
          <input id="pl-modal-name" placeholder="Ej. Límite semanal, Tope mensual..." value="${existing ? existing.name : ''}" required />
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Tipo de periodo</label>
            <select id="pl-modal-type">
              <option value="dia" ${curType === 'dia' ? 'selected' : ''}>Día</option>
              <option value="semana" ${curType === 'semana' ? 'selected' : ''}>Semana</option>
              <option value="quincena" ${curType === 'quincena' ? 'selected' : ''}>Quincena</option>
              <option value="mes" ${curType === 'mes' ? 'selected' : ''}>Mes</option>
              <option value="personalizado" ${curType === 'personalizado' ? 'selected' : ''}>Periodo personalizado</option>
            </select>
          </div>

          <div class="field">
            <label>Monto límite (₡)</label>
            <div class="amount-input-wrap">
              <span class="currency-symbol">₡</span>
              <input id="pl-modal-amount" type="text" inputmode="decimal" placeholder="0.00" value="${existing ? formatAmountString(existing.amount) : ''}" required />
            </div>
          </div>
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Fecha de inicio</label>
            <input id="pl-modal-start" type="date" value="${initStart}" required />
          </div>

          <div class="field">
            <label>Fecha límite</label>
            <input id="pl-modal-end" type="date" value="${initEnd}" required />
          </div>
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Categoría (opcional)</label>
            <select id="pl-modal-cat">${catOpts}</select>
          </div>

          <div class="field">
            <label>Sobre (opcional)</label>
            <select id="pl-modal-env">${envOpts}</select>
          </div>
        </div>

        <label class="checkbox-row">
          <input type="checkbox" id="pl-modal-rollover" ${existing && existing.rolloverUnused ? 'checked' : ''} />
          <span>Conservar el dinero no utilizado para periodos posteriores</span>
        </label>

        <div class="modal-actions-compact">
          <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
          <button type="submit" class="btn-primary btn-sm">${isEdit ? 'Guardar cambios' : 'Establecer límite'}</button>
        </div>
      </form>
    </div>
  `;

  attachAmountFormatter($('pl-modal-amount'));
  _buildCsel('pl-modal-type', {});
  _buildCsel('pl-modal-cat', { isCategory: true });
  _buildCsel('pl-modal-env', {});

  const typeSel = $('pl-modal-type');
  const startInp = $('pl-modal-start');
  const endInp = $('pl-modal-end');

  const syncDates = () => {
    const t = typeSel.value;
    if (t !== 'personalizado' && startInp.value) {
      const nextEnd = computePeriodEndDate(startInp.value, t);
      if (nextEnd) endInp.value = nextEnd;
    }
  };

  typeSel.addEventListener('change', () => {
    _refreshCsel('pl-modal-type');
    syncDates();
  });
  startInp.addEventListener('change', syncDates);

  overlay.style.display = 'flex';
  $('pl-modal-name').focus();
  overlay.onclick = (ev) => { if (ev.target === overlay) overlay.style.display = 'none'; };

  $('period-limit-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = $('pl-modal-name').value.trim();
    const periodType = typeSel.value;
    const amount = parseAmount($('pl-modal-amount').value);
    const startDate = startInp.value;
    const endDate = endInp.value;
    const category = $('pl-modal-cat').value || '';
    const envelopeId = $('pl-modal-env').value || '';
    const rolloverUnused = !!$('pl-modal-rollover').checked;

    if (!name || !amount || amount <= 0 || !startDate || !endDate) {
      toast('Completa el nombre, monto válido y fechas del periodo');
      return;
    }

    if (endDate < startDate) {
      toast('La fecha límite no puede ser anterior a la fecha de inicio');
      return;
    }

    if (isEdit && existing) {
      Object.assign(existing, {
        name,
        periodType,
        amount,
        startDate,
        endDate,
        category,
        envelopeId,
        rolloverUnused
      });
      toast(`Límite "${name}" actualizado`);
    } else {
      state.periodLimits.push({
        id: uid(),
        name,
        periodType,
        amount,
        startDate,
        endDate,
        category,
        envelopeId,
        rolloverUnused,
        carriedOverAmount: 0,
        alertThreshold: 80,
        history: []
      });
      toast(`Límite "${name}" (${PERIOD_TYPE_LABELS[periodType] || periodType}) creado`);
    }

    overlay.style.display = 'none';
    renderAll();
  });
};

window.advancePeriodLimit = function(limitId) {
  const pl = (state.periodLimits || []).find((x) => x.id === limitId);
  if (!pl) return;

  const st = getPeriodLimitStats(pl);
  if (!Array.isArray(pl.history)) pl.history = [];

  pl.history.unshift({
    id: uid(),
    periodType: pl.periodType,
    startDate: pl.startDate,
    endDate: pl.endDate,
    baseLimit: st.baseLimit,
    carriedIn: st.carriedOver,
    effectiveLimit: st.effectiveLimit,
    spent: st.spent,
    remaining: st.remaining,
    pctUsed: st.rawPct,
    closedAt: new Date().toISOString().slice(0, 10)
  });

  // Calcular nuevo rango de fechas consecutivo
  let nextStart = new Date().toISOString().slice(0, 10);
  let nextEnd = nextStart;
  if (pl.endDate && /^\d{4}-\d{2}-\d{2}$/.test(pl.endDate)) {
    const [y, m, d] = pl.endDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + 1);
    nextStart = dt.toISOString().slice(0, 10);

    if (pl.periodType !== 'personalizado') {
      nextEnd = computePeriodEndDate(nextStart, pl.periodType) || nextStart;
    } else if (pl.startDate && /^\d{4}-\d{2}-\d{2}$/.test(pl.startDate)) {
      const [sy, sm, sd] = pl.startDate.split('-').map(Number);
      const sDt = new Date(Date.UTC(sy, sm - 1, sd));
      const eDt = new Date(Date.UTC(y, m - 1, d));
      const diffDays = Math.max(0, Math.round((eDt - sDt) / (1000 * 60 * 60 * 24)));
      const nEndDt = new Date(dt.getTime());
      nEndDt.setUTCDate(nEndDt.getUTCDate() + diffDays);
      nextEnd = nEndDt.toISOString().slice(0, 10);
    }
  }

  pl.carriedOverAmount = (pl.rolloverUnused && st.remaining > 0) ? st.remaining : 0;
  pl.startDate = nextStart;
  pl.endDate = nextEnd;

  renderAll();
  const rolloverMsg = pl.carriedOverAmount > 0 ? ` · Conservaron ${money(pl.carriedOverAmount)} no utilizados` : '';
  toast(`Periodo archivado en historial. Nuevo ciclo activo${rolloverMsg}`);
};

window.deletePeriodLimit = function(limitId) {
  const pl = (state.periodLimits || []).find((x) => x.id === limitId);
  if (!pl) return;
  if (!confirm(`¿Eliminar el límite por periodo "${pl.name}"?`)) return;
  state.periodLimits = (state.periodLimits || []).filter((x) => x.id !== limitId);
  renderAll();
  toast('Límite por periodo eliminado');
};

/* ============================================================
   CONTROL DE DINERO RESERVADO (REQ 7)
   ============================================================ */

function renderReserves() {
  const el = $('reserves-list');
  const countEl = $('reserves-count');
  if (!el) return;

  const reserves = state.reserves || [];
  const activeCount = reserves.filter((r) => r.amount > 0).length;
  if (countEl) countEl.textContent = String(activeCount);

  if (!reserves.length) {
    el.innerHTML = `<div class="empty-state" style="padding:1.5rem">
      <p>No tienes dinero reservado actualmente</p>
      <span>Reserva dinero para propósitos específicos sin que aparezca como dinero libre para gastar</span>
    </div>`;
    return;
  }

  el.innerHTML = reserves.map((r) => {
    const env = r.envelopeId ? (state.envelopes || []).find((e) => e.id === r.envelopeId) : null;
    const budget = r.budgetId ? (state.budgets || []).find((b) => b.id === r.budgetId) : null;
    const initial = Number(r.initialAmount || r.amount || 0);
    const used = Number(r.usedAmount || 0);
    const released = Number(r.releasedAmount || 0);
    const current = Math.max(0, Number(r.amount || 0));
    const usages = Array.isArray(r.usages) ? r.usages : [];

    return `
      <div class="category-card" data-reserve-id="${r.id}">
        <div class="category-header">
          <div class="category-title">
            <span class="cat-dot" style="background:${current > 0 ? 'var(--warn)' : 'var(--text-3)'}"></span>
            <span>${r.name}</span>
            ${current === 0 ? `<span class="meta-chip">Completada / Liberada</span>` : `<span class="meta-chip warn">Reserva activa</span>`}
          </div>
          <div class="category-card-actions">
            ${current > 0 ? `
              <button type="button" class="btn-primary btn-sm" onclick="openUseReserveModal('${r.id}')" title="Registrar uso o gasto con fondos de esta reserva">
                Utilizar reserva
              </button>
              <button type="button" class="btn-secondary btn-sm" onclick="openReleaseReserveModal('${r.id}')" title="Liberar dinero de vuelta al saldo disponible">
                Liberar dinero
              </button>
            ` : ''}
            <button type="button" class="btn-ghost btn-sm" onclick="openReserveModal('${r.id}')">
              Editar
            </button>
            <button type="button" class="btn-danger btn-sm" onclick="deleteReserve('${r.id}')">
              Eliminar
            </button>
          </div>
        </div>

        <div class="category-body">
          ${(env || budget || r.category) ? `
            <div class="meta-tags-row">
              ${env ? `<span class="meta-chip">Sobre: <b>${env.name}</b></span>` : ''}
              ${budget ? `<span class="meta-chip accent">Presupuesto: <b>${budget.name}</b></span>` : ''}
              ${r.category ? `<span class="meta-chip">Categoría: <b>${r.category}</b></span>` : ''}
            </div>
          ` : ''}

          <div class="category-metrics-grid cols-4">
            <div class="cat-metric-box">
              <span class="label">Saldo reservado actual</span>
              <span class="val" style="color:${current > 0 ? 'var(--warn)' : 'var(--text-2)'}">${money(current)}</span>
            </div>
            <div class="cat-metric-box">
              <span class="label">Monto reservado inicial</span>
              <span class="val">${money(initial)}</span>
            </div>
            <div class="cat-metric-box">
              <span class="label">Utilizado en gastos</span>
              <span class="val spent">${money(used)}</span>
            </div>
            <div class="cat-metric-box">
              <span class="label">Liberado al disponible</span>
              <span class="val remaining">${money(released)}</span>
            </div>
          </div>

          ${usages.length > 0 ? `
            <details>
              <summary>Historial de utilizaciones y liberaciones (${usages.length})</summary>
              <div class="source-breakdown">
                ${usages.map((u) => `
                  <div class="breakdown-row">
                    <span class="src-name">${u.desc || (u.type === 'release' ? 'Liberación de reserva' : 'Uso de reserva')} (${fmt(u.date)})</span>
                    <div class="src-vals">
                      <span style="color:${u.type === 'release' ? 'var(--success)' : 'var(--danger)'}">
                        <b>${u.type === 'release' ? 'Liberado: ' : 'Utilizado: '}${money(u.amount)}</b>
                      </span>
                    </div>
                  </div>
                `).join('')}
              </div>
            </details>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

window.openReserveModal = function(reserveId = null, preselectedEnvId = null) {
  const isEdit = !!reserveId;
  const existing = isEdit ? (state.reserves || []).find((r) => r.id === reserveId) : null;

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  const targetEnvId = existing ? existing.envelopeId : (preselectedEnvId || '');
  const envOpts = `<option value="">Fondo general (Sin sobre específico)</option>` +
    (state.envelopes || []).map((e) => `<option value="${e.id}" ${e.id === targetEnvId ? 'selected' : ''}>${e.name} (Disp: ${money(getEnvelopeTotals(e).available)})</option>`).join('');

  const catOpts = `<option value="">Sin categoría específica</option>` +
    (state.categories || []).map((c) => `<option value="${c.name}" ${existing && existing.category === c.name ? 'selected' : ''}>${c.name}</option>`).join('');

  content.innerHTML = `
    <div class="modal-info-content compact-modal" style="max-width:420px">
      <div class="modal-info-header">
        <h3>${isEdit ? 'Editar reserva de dinero' : 'Reservar dinero'}</h3>
        <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form id="reserve-modal-form" class="compact-form">
        <div class="field">
          <label>Nombre o propósito de la reserva</label>
          <input id="res-modal-name" placeholder="Ej. Pago de matrícula, Reparación, Impuestos..." value="${existing ? existing.name : ''}" required />
        </div>

        <div class="field">
          <label>Monto a mantener reservado (₡)</label>
          <div class="amount-input-wrap">
            <span class="currency-symbol">₡</span>
            <input id="res-modal-amount" type="text" inputmode="decimal" placeholder="0.00" value="${existing ? formatAmountString(existing.amount) : ''}" required />
          </div>
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Sobre origen (opcional)</label>
            <select id="res-modal-env">${envOpts}</select>
          </div>

          <div class="field">
            <label>Categoría (opcional)</label>
            <select id="res-modal-cat">${catOpts}</select>
          </div>
        </div>

        <div class="modal-actions-compact">
          <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
          <button type="submit" class="btn-primary btn-sm">${isEdit ? 'Guardar cambios' : 'Crear reserva'}</button>
        </div>
      </form>
    </div>
  `;

  attachAmountFormatter($('res-modal-amount'));
  _buildCsel('res-modal-env', {});
  _buildCsel('res-modal-cat', { isCategory: true });

  overlay.style.display = 'flex';
  $('res-modal-name').focus();
  overlay.onclick = (ev) => { if (ev.target === overlay) overlay.style.display = 'none'; };

  $('reserve-modal-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = $('res-modal-name').value.trim();
    const amount = parseAmount($('res-modal-amount').value);
    const envelopeId = $('res-modal-env').value || '';
    const category = $('res-modal-cat').value || '';

    if (!name || isNaN(amount) || amount < 0) {
      toast('Ingresa un nombre y monto válidos para la reserva');
      return;
    }

    if (isEdit && existing) {
      existing.name = name;
      existing.amount = amount;
      if (amount > existing.initialAmount) existing.initialAmount = amount;
      existing.envelopeId = envelopeId;
      existing.category = category;
      if (existing.budgetId) {
        const linkedB = (state.budgets || []).find((b) => b.id === existing.budgetId);
        if (linkedB) linkedB.reservedAmount = amount;
      }
      toast(`Reserva "${name}" actualizada`);
    } else {
      state.reserves.push({
        id: uid(),
        name,
        initialAmount: amount,
        amount,
        usedAmount: 0,
        releasedAmount: 0,
        envelopeId,
        budgetId: '',
        category,
        date: new Date().toISOString().slice(0, 10),
        usages: []
      });
      toast(`Reservados ${money(amount)} para "${name}"`);
    }

    overlay.style.display = 'none';
    renderAll();
    if (currentTab === 'envelope-detail' && currentEnvelopeDetailId) {
      renderEnvelopeDetailPage(currentEnvelopeDetailId);
    }
  });
};

window.openUseReserveModal = function(reserveId) {
  const r = (state.reserves || []).find((x) => x.id === reserveId);
  if (!r || r.amount <= 0) {
    toast('Esta reserva no tiene saldo pendiente por utilizar');
    return;
  }

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  const todayStr = new Date().toISOString().slice(0, 10);

  content.innerHTML = `
    <div class="modal-info-content compact-modal" style="max-width:410px">
      <div class="modal-info-header">
        <h3>Utilizar reserva: ${r.name}</h3>
        <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form id="use-reserve-form" class="compact-form">
        <div class="transfer-origin-pill">
          <div>
            <div class="pill-label">Reserva</div>
            <div class="pill-val">${r.name}</div>
          </div>
          <div style="text-align:right">
            <div class="pill-label">Saldo reservado</div>
            <div class="pill-val" style="color:var(--warn)">${money(r.amount)}</div>
          </div>
        </div>

        <div class="field">
          <label>Descripción de la utilización</label>
          <input id="use-res-desc" placeholder="Ej. Pago de ${r.name}" value="Uso de reserva: ${r.name}" required />
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Monto a utilizar (₡)</label>
            <div class="amount-input-wrap">
              <span class="currency-symbol">₡</span>
              <input id="use-res-amount" type="text" inputmode="decimal" value="${formatAmountString(r.amount)}" required />
            </div>
          </div>

          <div class="field">
            <label>Fecha</label>
            <input id="use-res-date" type="date" value="${todayStr}" required />
          </div>
        </div>

        <div class="modal-actions-compact">
          <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
          <button type="submit" class="btn-primary btn-sm">Registrar utilización</button>
        </div>
      </form>
    </div>
  `;

  attachAmountFormatter($('use-res-amount'));
  overlay.style.display = 'flex';
  $('use-res-amount').focus();
  overlay.onclick = (ev) => { if (ev.target === overlay) overlay.style.display = 'none'; };

  $('use-reserve-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const useAmt = parseAmount($('use-res-amount').value);
    const desc = $('use-res-desc').value.trim() || `Uso de reserva: ${r.name}`;
    const date = $('use-res-date').value || todayStr;

    if (!useAmt || useAmt <= 0 || useAmt > r.amount) {
      toast(`Ingresa un monto válido hasta ${money(r.amount)}`);
      return;
    }

    const expId = uid();
    const env = r.envelopeId ? (state.envelopes || []).find((e) => e.id === r.envelopeId) : null;

    // Registrar el gasto real vinculado a la reserva (se contabiliza una sola vez)
    state.expenses.push({
      id: expId,
      envelopeId: r.envelopeId || '',
      envelope: env ? env.name : '',
      sourceId: r.envelopeId || '',
      category: r.category || '',
      budgetId: r.budgetId || '',
      reserveId: r.id,
      amount: useAmt,
      desc,
      date
    });

    r.amount = Math.max(0, Number(r.amount) - useAmt);
    r.usedAmount = Number(r.usedAmount || 0) + useAmt;
    if (!Array.isArray(r.usages)) r.usages = [];
    r.usages.unshift({
      id: uid(),
      type: 'use',
      amount: useAmt,
      desc,
      date,
      expenseId: expId
    });

    if (r.budgetId) {
      const linkedB = (state.budgets || []).find((b) => b.id === r.budgetId);
      if (linkedB) linkedB.reservedAmount = r.amount;
    }

    overlay.style.display = 'none';
    renderAll();
    if (currentTab === 'envelope-detail' && currentEnvelopeDetailId) {
      renderEnvelopeDetailPage(currentEnvelopeDetailId);
    }
    toast(`Utilizados ${money(useAmt)} de la reserva "${r.name}"`);
  });
};

window.openReleaseReserveModal = function(reserveId) {
  const r = (state.reserves || []).find((x) => x.id === reserveId);
  if (!r || r.amount <= 0) {
    toast('Esta reserva ya no tiene fondos retenidos');
    return;
  }

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  content.innerHTML = `
    <div class="modal-info-content compact-modal" style="max-width:400px">
      <div class="modal-info-header">
        <h3>Liberar dinero reservado</h3>
        <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form id="release-reserve-form" class="compact-form">
        <p style="font-size:0.78rem;color:var(--text-2);line-height:1.4">
          El monto liberado de <b>"${r.name}"</b> volverá a estar disponible como dinero libre para gastar.
        </p>

        <div class="field">
          <label>Monto a liberar (₡, máx. ${money(r.amount)})</label>
          <div class="amount-input-wrap">
            <span class="currency-symbol">₡</span>
            <input id="release-res-amount" type="text" inputmode="decimal" value="${formatAmountString(r.amount)}" required />
          </div>
        </div>

        <div class="modal-actions-compact">
          <button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
          <button type="submit" class="btn-primary btn-sm">Liberar al disponible</button>
        </div>
      </form>
    </div>
  `;

  attachAmountFormatter($('release-res-amount'));
  overlay.style.display = 'flex';
  $('release-res-amount').focus();
  overlay.onclick = (ev) => { if (ev.target === overlay) overlay.style.display = 'none'; };

  $('release-reserve-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const relAmt = parseAmount($('release-res-amount').value);
    if (!relAmt || relAmt <= 0 || relAmt > r.amount) {
      toast(`Ingresa un monto válido hasta ${money(r.amount)}`);
      return;
    }

    r.amount = Math.max(0, Number(r.amount) - relAmt);
    r.releasedAmount = Number(r.releasedAmount || 0) + relAmt;
    if (!Array.isArray(r.usages)) r.usages = [];
    r.usages.unshift({
      id: uid(),
      type: 'release',
      amount: relAmt,
      desc: 'Liberado al saldo disponible',
      date: new Date().toISOString().slice(0, 10)
    });

    if (r.budgetId) {
      const linkedB = (state.budgets || []).find((b) => b.id === r.budgetId);
      if (linkedB) linkedB.reservedAmount = r.amount;
    }

    overlay.style.display = 'none';
    renderAll();
    if (currentTab === 'envelope-detail' && currentEnvelopeDetailId) {
      renderEnvelopeDetailPage(currentEnvelopeDetailId);
    }
    toast(`Liberados ${money(relAmt)} de "${r.name}" al saldo disponible`);
  });
};

window.deleteReserve = function(reserveId) {
  const r = (state.reserves || []).find((x) => x.id === reserveId);
  if (!r) return;
  if (!confirm(`¿Eliminar la reserva "${r.name}"? Si aún tenía saldo reservado (${money(r.amount)}), volverá a estar disponible.`)) return;
  if (r.budgetId) {
    const linkedB = (state.budgets || []).find((b) => b.id === r.budgetId);
    if (linkedB) linkedB.reservedAmount = 0;
  }
  state.reserves = (state.reserves || []).filter((x) => x.id !== reserveId);
  renderAll();
  if (currentTab === 'envelope-detail' && currentEnvelopeDetailId) {
    renderEnvelopeDetailPage(currentEnvelopeDetailId);
  }
  toast(`Reserva "${r.name}" eliminada`);
};

/* ============================================================
   EXPENSE MODAL (REGISTRAR GASTO POR SOBRE, CATEGORÍA Y PRESUPUESTO)
   ============================================================ */

window.openExpenseModal = function(envIdOrExpenseId = null, maybeExpenseId = null, preselectedCategory = '', preselectedBudgetId = '') {
  let expenseId = null;
  let preselectedEnvId = null;

  if (envIdOrExpenseId) {
    const isExpense = (state.expenses || []).some((x) => x.id === envIdOrExpenseId);
    const isEnv = (state.envelopes || []).some((e) => e.id === envIdOrExpenseId);
    if (isExpense) {
      expenseId = envIdOrExpenseId;
    } else if (isEnv) {
      preselectedEnvId = envIdOrExpenseId;
      expenseId = maybeExpenseId;
    } else if (maybeExpenseId) {
      expenseId = maybeExpenseId;
    } else {
      expenseId = envIdOrExpenseId;
    }
  }

  if (!preselectedEnvId && currentTab === 'envelope-detail' && currentEnvelopeDetailId) {
    preselectedEnvId = currentEnvelopeDetailId;
  }

  const isEdit = !!expenseId;
  const ex = isEdit ? (state.expenses || []).find((x) => x.id === expenseId) : null;

  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  const todayStr = new Date().toISOString().slice(0, 10);
  const initialEnvId = ex ? (ex.envelopeId || ex.sourceId || '') : (preselectedEnvId || state.envelopes[0]?.id || '');
  const targetEnv = (state.envelopes || []).find((e) => e.id === initialEnvId);
  const isContextual = !!targetEnv && (!!preselectedEnvId || currentTab === 'envelope-detail') && !isEdit;

  const initialCat = ex ? (ex.category || '') : (preselectedCategory || '');
  const initialBudgetId = ex ? (ex.budgetId || '') : (preselectedBudgetId || '');

  const envOpts = `<option value="" ${!initialEnvId ? 'selected' : ''}>Fondo general (Sin sobre específico)</option>` +
    (state.envelopes || []).map((env) => {
      const t = getEnvelopeTotals(env);
      const bankLabel = env.bank ? ` [${env.bank}]` : '';
      return `<option value="${env.id}" ${env.id === initialEnvId ? 'selected' : ''}>${env.name}${bankLabel} (Disp: ${money(t.available)})</option>`;
    }).join('');

  const catOpts = `<option value="" ${!initialCat ? 'selected' : ''}>Sin categoría</option>` +
    (state.categories || []).map((c) => {
      const cs = getCategoryStats(c);
      const remTxt = cs.cap > 0 ? ` (Queda: ${money(cs.remaining)})` : '';
      return `<option value="${c.name}" ${c.name === initialCat ? 'selected' : ''}>${c.name}${remTxt}</option>`;
    }).join('');

  const budgetOpts = `<option value="" ${!initialBudgetId ? 'selected' : ''}>Ninguno en específico</option>` +
    (state.budgets || []).map((b) => `<option value="${b.id}" ${b.id === initialBudgetId ? 'selected' : ''}>${b.name}</option>`).join('');

  content.innerHTML = `
    <div class="modal-info-content compact-modal" style="max-width:440px">
      <div class="modal-info-header">
        <h3>${isEdit ? 'Editar gasto' : 'Registrar gasto'}</h3>
        <button type="button" class="btn-ghost btn-sm" id="expense-modal-close" onclick="document.getElementById('modal-overlay').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form id="expense-modal-form" class="compact-form">
        ${isContextual ? `
          <div class="context-env-badge" style="border-left-color:${targetEnv.color || '#3b82f6'}">
            <div class="context-env-left">
              <span class="context-dot" style="background:${targetEnv.color || '#3b82f6'}"></span>
              <span class="context-env-name">Sobre: <b>${targetEnv.name}</b></span>
              ${targetEnv.bank ? `<span class="context-env-bank">${targetEnv.bank}</span>` : ''}
            </div>
            <span class="context-env-disp">Disp: <b>${money(getEnvelopeTotals(targetEnv).available)}</b></span>
          </div>
          <input type="hidden" id="modal-exp-envelope" value="${targetEnv.id}" />
        ` : `
          <div class="field">
            <label>Sobre a debitar (opcional)</label>
            <select id="modal-exp-envelope">${envOpts}</select>
          </div>
        `}

        <div class="form-row-2">
          <div class="field">
            <label>Categoría</label>
            <select id="modal-exp-category">${catOpts}</select>
          </div>

          <div class="field">
            <label>Presupuesto (opcional)</label>
            <select id="modal-exp-budget">${budgetOpts}</select>
          </div>
        </div>

        <div class="field">
          <label>Concepto o descripción</label>
          <input id="modal-exp-desc" placeholder="Ej. Supermercado, taller, recibo..." value="${ex ? ex.desc : ''}" required />
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Monto (₡)</label>
            <div class="amount-input-wrap">
              <span class="currency-symbol">₡</span>
              <input id="modal-exp-amount" type="text" inputmode="decimal" placeholder="0.00" value="${ex ? formatAmountString(ex.amount) : ''}" required autocomplete="off" />
            </div>
          </div>

          <div class="field">
            <label>Fecha</label>
            <input id="modal-exp-date" type="date" value="${ex ? ex.date : todayStr}" required />
          </div>
        </div>

        <!-- Live Simulation Box -->
        <div id="modal-exp-sim-box" class="expense-sim-box compact-sim" style="display:none"></div>

        <div class="modal-actions-compact">
          <button type="button" class="btn-ghost btn-sm" id="expense-modal-cancel" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
          <button type="submit" class="btn-primary btn-sm">${isEdit ? 'Actualizar' : 'Registrar gasto'}</button>
        </div>
      </form>
    </div>
  `;

  if (!isContextual) {
    _buildCsel('modal-exp-envelope', {});
  }
  _buildCsel('modal-exp-category', { isCategory: true });
  _buildCsel('modal-exp-budget', {});

  const envSelect = $('modal-exp-envelope');
  const catSelect = $('modal-exp-category');
  const budgetSelect = $('modal-exp-budget');
  const simBox = $('modal-exp-sim-box');
  const amountInput = $('modal-exp-amount');

  function updateModalSimulation() {
    const envId = envSelect.value;
    const catName = catSelect.value;
    const env = (state.envelopes || []).find((e) => e.id === envId);
    const amount = parseAmount(amountInput.value || 0);

    if (!amount || amount <= 0) {
      if (simBox) simBox.style.display = 'none';
      return;
    }

    const globalSum = getGlobalFinancialSummary();
    const existingAmount = (isEdit && ex) ? Number(ex.amount || 0) : 0;
    const currentAvailable = (env ? getEnvelopeTotals(env).available : globalSum.availableMoney) + existingAmount;
    const newAvailable = currentAvailable - amount;
    const isOver = newAvailable < 0;

    let catRowHTML = '';
    if (catName) {
      const cs = getCategoryStats(catName);
      if (cs.cap > 0) {
        const prevCatExp = (isEdit && ex && ex.category === catName) ? Number(ex.amount || 0) : 0;
        const catRemBefore = cs.remaining + prevCatExp;
        const catRemAfter = catRemBefore - amount;
        catRowHTML = `
          <div class="sim-row">
            <span style="color:var(--text-2)">Restante en "${catName}":</span>
            <span style="font-weight:600;color:${catRemAfter < 0 ? 'var(--danger)' : 'var(--success)'}">${money(catRemBefore)} → ${money(catRemAfter)}</span>
          </div>
        `;
      }
    }

    simBox.style.display = 'flex';
    simBox.innerHTML = `
      <div class="sim-row">
        <span style="color:var(--text-2)">Disponible actual${env ? ` (${env.name})` : ''}:</span>
        <span style="font-weight:600">${money(currentAvailable)}</span>
      </div>
      <div class="sim-row">
        <span style="font-weight:600;color:var(--text)">Balance resultante:</span>
        <div class="sim-calc-flow">
          <span>${money(currentAvailable)}</span>
          <span class="arrow">− ${money(amount)} →</span>
          <span class="new-bal ${isOver ? 'over' : ''}">${money(newAvailable)}</span>
        </div>
      </div>
      ${catRowHTML}
    `;
  }

  if (!isContextual && envSelect && envSelect.tagName === 'SELECT') {
    envSelect.addEventListener('change', () => {
      _refreshCsel('modal-exp-envelope');
      updateModalSimulation();
    });
  }
  catSelect?.addEventListener('change', () => {
    _refreshCsel('modal-exp-category');
    updateModalSimulation();
  });
  budgetSelect?.addEventListener('change', () => {
    _refreshCsel('modal-exp-budget');
  });
  amountInput.addEventListener('input', updateModalSimulation);

  updateModalSimulation();
  attachAmountFormatter(amountInput);

  overlay.style.display = 'flex';
  amountInput.focus();

  $('expense-modal-close')?.addEventListener('click', () => { overlay.style.display = 'none'; });
  $('expense-modal-cancel')?.addEventListener('click', () => { overlay.style.display = 'none'; });
  overlay.onclick = (ev) => { if (ev.target === overlay) overlay.style.display = 'none'; };

  $('expense-modal-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const envId = envSelect.value || '';
    const category = catSelect.value || '';
    const budgetId = budgetSelect.value || '';
    const amount = parseAmount(amountInput.value);
    const date = $('modal-exp-date').value || todayStr;
    const desc = $('modal-exp-desc').value.trim();

    if (!amount || amount <= 0 || !desc) {
      toast('Ingresa una descripción y un monto válido mayor a 0');
      return;
    }

    const env = (state.envelopes || []).find((e) => e.id === envId);
    if (!Array.isArray(state.expenses)) state.expenses = [];

    if (isEdit) {
      const existingExp = state.expenses.find((x) => x.id === expenseId);
      if (existingExp) {
        Object.assign(existingExp, {
          envelopeId: envId,
          envelope: env ? env.name : '',
          sourceId: envId,
          category,
          budgetId,
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
        envelope: env ? env.name : '',
        sourceId: envId,
        category,
        budgetId,
        amount,
        desc,
        date
      });
      toast(`Gasto de ${money(amount)} registrado${category ? ` en ${category}` : ''}`);
    }

    overlay.style.display = 'none';
    renderAll();
    const finalEnvId = preselectedEnvId || (currentTab === 'envelope-detail' ? currentEnvelopeDetailId : null);
    if (finalEnvId) {
      renderEnvelopeDetailPage(finalEnvId);
    }
  });
};

/* ============================================================
   RENDER EXPENSES LIST
   ============================================================ */

function renderExpensesList() {
  renderFinancialKPIs();
  const filterEnv = $('filter-envelope')?.value || '';
  const filterCat = $('filter-category')?.value || '';

  let list = [...(state.expenses || [])].sort(compareByDateDesc);
  if (filterEnv) {
    list = list.filter((e) => e.envelopeId === filterEnv || e.envelope === filterEnv || e.sourceId === filterEnv);
  }
  if (filterCat) {
    list = list.filter((e) => e.category === filterCat);
  }

  const el = $('expenses-list');
  if (!el) return;

  if (!list.length) {
    el.innerHTML = `<div class="empty-state">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>
      <p>Sin gastos registrados</p><span>Ajusta los filtros o registra un gasto con el botón superior</span></div>`;
    return;
  }

  el.innerHTML = `
    <div class="expense-table-header" style="grid-template-columns: 1.8fr 1fr 1fr 0.8fr 0.9fr 0.8fr 120px">
      <span>Descripción</span><span>Categoría</span><span>Sobre</span><span>Banco</span><span>Monto</span><span>Fecha</span><span>Acciones</span>
    </div>` +
    list.map((e) => {
      const env = (state.envelopes || []).find((x) => x.id === e.envelopeId || x.name === e.envelope) || (state.sources || []).find((s) => s.id === e.sourceId);
      const envColor = env?.color || '#3b82f6';
      const envName = env?.name || 'General';
      const envBank = env?.bank || '—';
      const catObj = e.category ? (state.categories || []).find((c) => c.name === e.category) : null;
      const catColor = catObj?.color || '#64748b';
      const catName = e.category || 'Sin categoría';

      return `<div class="expense-row" style="grid-template-columns: 1.8fr 1fr 1fr 0.8fr 0.9fr 0.8fr 120px" data-expense-id="${e.id}">
        <div class="exp-col-desc">
          <div class="exp-desc">${e.desc}</div>
          <div class="exp-meta-inline">
            <span class="exp-tag"><span class="exp-tag-dot" style="background:${envColor}"></span>${envName}</span>
            ${e.category ? `<span class="exp-tag"><span class="exp-tag-dot" style="background:${catColor}"></span>${catName}</span>` : ''}
            <span class="exp-date">${fmt(e.date)}</span>
          </div>
        </div>
        <div class="exp-col-cat"><span class="exp-tag"><span class="exp-tag-dot" style="background:${catColor}"></span>${catName}</span></div>
        <div class="exp-col-src"><span class="exp-tag"><span class="exp-tag-dot" style="background:${envColor}"></span>${envName}</span></div>
        <div class="exp-col-bank"><span class="envelope-bank-badge">${envBank}</span></div>
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
  const exp = (state.expenses || []).find((x) => x.id === id);
  if (exp && exp.reserveId) {
    const res = (state.reserves || []).find((r) => r.id === exp.reserveId);
    if (res) {
      res.amount = Number(res.amount || 0) + Number(exp.amount || 0);
      res.usedAmount = Math.max(0, Number(res.usedAmount || 0) - Number(exp.amount || 0));
      if (Array.isArray(res.usages)) {
        res.usages = res.usages.filter((u) => u.expenseId !== id);
      }
    }
  }
  state.expenses = (state.expenses || []).filter((x) => x.id !== id);
  renderAll();
  if (currentTab === 'envelope-detail' && currentEnvelopeDetailId) {
    renderEnvelopeDetailPage(currentEnvelopeDetailId);
  }
  toast('Gasto eliminado');
};

/* ============================================================
   RENDER ALL / PER TAB
   ============================================================ */

function renderTab(tab) {
  ensureEnvelopes();
  renderFinancialKPIs();

  switch (tab) {
    case 'dashboard':
      renderEnvelopeCards();
      renderBudgets();
      renderCategories();
      renderPeriodLimits();
      renderReserves();
      break;
    case 'patrimonio':
      renderPatrimonioBar();
      renderCharts();
      renderCatSummary();
      renderRecentExpenses();
      break;
    case 'envelope-detail':
      if (currentEnvelopeDetailId) {
        renderEnvelopeDetailPage(currentEnvelopeDetailId);
      } else {
        switchTab('dashboard');
      }
      break;
    case 'sources':
      renderFilters();
      renderSources();
      break;
    case 'expenses':
      renderFilters();
      renderExpensesList();
      break;
  }
}

function renderOnly() {
  ensureEnvelopes();
  applyTheme();
  renderTab(currentTab);
  renderFilters();
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

// Close calculator when tapping outside
document.addEventListener('pointerdown', (e) => {
  const panel = $('calc-panel');
  const fab = $('calc-fab');
  if (!panel || panel.style.display === 'none') return;
  if (!panel.contains(e.target) && !fab.contains(e.target)) {
    panel.style.display = 'none';
    fab.style.display = '';
  }
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
  renderOnly();
  initCustomSelects();
  switchTab(currentTab || 'dashboard');
}

let _unsubscribeFirestore = null;

window.startOfflineGuestMode = function() {
  localStorage.setItem('bf_guest_mode', 'true');
  const guestUser = {
    uid: 'guest',
    displayName: 'Modo Local',
    email: '',
    isGuest: true,
    isOffline: !navigator.onLine
  };

  SyncManager.setUser(guestUser, true);

  if (window.Auth) {
    window.Auth.hideAuthPortal();
    window.Auth.updateUserProfile(guestUser);
  }

  const cached = localStorage.getItem('budget_state_local');
  if (cached) {
    try {
      Object.assign(state, JSON.parse(cached), { editingSourceId: null });
    } catch (_) {}
  } else {
    const prev = localStorage.getItem('budget_state');
    if (prev) {
      try {
        Object.assign(state, JSON.parse(prev), { editingSourceId: null });
      } catch (_) {}
    } else {
      Object.assign(state, {
        envelopes: [],
        sources: [],
        incomes: [],
        expenses: [],
        transfers: [],
        categories: [],
        assignments: [],
        budgets: [],
        periodLimits: [],
        reserves: []
      });
    }
  }

  ensureEnvelopes();
  migrateAssignmentsIfNeeded();
  reconcileAssignmentsWithDistributions();
  rebuildDistributionsFromAssignments();

  const shell = document.querySelector('.app-shell');
  const sidebar = document.getElementById('sidebar');
  const bottomNav = document.getElementById('bottom-nav');
  if (shell) shell.style.visibility = 'visible';
  if (sidebar) sidebar.style.visibility = 'visible';
  if (bottomNav) bottomNav.style.visibility = 'visible';

  _startApp();
  toast('Iniciado en Modo Local (los datos se guardan en este dispositivo)', 3200);
};

async function handleUserSession(user) {
  const shell = document.querySelector('.app-shell');
  const sidebar = document.getElementById('sidebar');
  const bottomNav = document.getElementById('bottom-nav');

  // Si no hay usuario activo pero estamos offline, intentar restaurar sesión previa o modo local
  if (!user && !navigator.onLine) {
    const lastUser = window.FBAuth?.getLastStoredUser();
    if (lastUser) {
      console.log('BudgetFlow: Restaurando sesión offline para:', lastUser.email);
      user = { ...lastUser, isOffline: true };
    } else if (localStorage.getItem('bf_guest_mode') === 'true') {
      window.startOfflineGuestMode();
      return;
    }
  }

  if (!user) {
    SyncManager.setUser(null, false);
    if (_unsubscribeFirestore) {
      _unsubscribeFirestore();
      _unsubscribeFirestore = null;
    }

    Object.assign(state, {
      envelopes: [],
      sources: [],
      incomes: [],
      expenses: [],
      transfers: [],
      categories: [],
      assignments: [],
      budgets: [],
      periodLimits: [],
      reserves: [],
      editingSourceId: null,
      editingExpenseId: null,
      editingCategoryName: null
    });

    if (shell) shell.style.visibility = 'hidden';
    if (sidebar) sidebar.style.visibility = 'hidden';
    if (bottomNav) bottomNav.style.visibility = 'hidden';

    if (window.Auth) {
      window.Auth.updateUserProfile(null);
      window.Auth.showAuthPortal({
        defaultTab: 'login',
        onAuthSuccess: (newUser) => handleUserSession(newUser)
      });
    }
    return;
  }

  // Usuario autenticado (u offline restaurado)
  SyncManager.setUser(user, false);
  if (window.Auth) {
    window.Auth.hideAuthPortal();
    window.Auth.updateUserProfile(user);
  }

  // PASO 1: Carga local inmediata desde localStorage (cero latencia, offline garantizado)
  const cached = localStorage.getItem('budget_state_' + user.uid);
  if (cached) {
    try {
      Object.assign(state, JSON.parse(cached), { editingSourceId: null });
    } catch (_) {}
  } else {
    // Si viene de modo local con datos previos, migrarlos automáticamente a la cuenta
    const localGuestData = localStorage.getItem('budget_state_local');
    if (localGuestData) {
      try {
        Object.assign(state, JSON.parse(localGuestData), { editingSourceId: null });
        SyncManager.markDirty();
        localStorage.removeItem('budget_state_local');
        localStorage.removeItem('bf_guest_mode');
      } catch (_) {}
    } else {
      const legacy = localStorage.getItem('budget_state');
      if (legacy) {
        try {
          Object.assign(state, JSON.parse(legacy), { editingSourceId: null });
        } catch (_) {}
      } else {
        Object.assign(state, {
          envelopes: [],
          sources: [],
          incomes: [],
          expenses: [],
          transfers: [],
          categories: [],
          assignments: [],
          budgets: [],
          periodLimits: [],
          reserves: []
        });
      }
    }
  }

  ensureEnvelopes();
  migrateAssignmentsIfNeeded();
  reconcileAssignmentsWithDistributions();
  rebuildDistributionsFromAssignments();

  // Mostrar la interfaz inmediatamente
  if (shell) shell.style.visibility = 'visible';
  if (sidebar) sidebar.style.visibility = 'visible';
  if (bottomNav) bottomNav.style.visibility = 'visible';
  _startApp();

  // PASO 2: Sincronización en segundo plano con Cloud Firestore si hay red
  if (SyncManager.isOnline && !user.isOffline && window.FBAuth) {
    (async () => {
      try {
        const remoteState = await window.FBAuth.loadUserState(user.uid, 4000);
        if (remoteState) {
          const remoteTime = remoteState.clientUpdatedAt || remoteState.lastModifiedAt || '';
          const localTime = state.lastModifiedAt || '';

          // Si el estado remoto es más nuevo o si no hay cambios locales pendientes no sincronizados
          if (!SyncManager.pendingChanges || (remoteTime && remoteTime >= localTime)) {
            Object.assign(state, remoteState, { editingSourceId: null });
            ensureEnvelopes();
            reconcileAssignmentsWithDistributions();
            rebuildDistributionsFromAssignments();
            localStorage.setItem('budget_state_' + user.uid, JSON.stringify(state));
            SyncManager._setPendingMeta(false);
            renderOnly();
          } else if (SyncManager.pendingChanges) {
            await SyncManager.syncPending();
          }
        } else if (SyncManager.pendingChanges) {
          await SyncManager.syncPending();
        }
      } catch (err) {
        console.warn('BudgetFlow: No se pudo refrescar de Firestore en segundo plano:', err);
      }
    })();
  }

  // Escuchar cambios en Firestore en tiempo real
  if (_unsubscribeFirestore) _unsubscribeFirestore();
  if (window.FBAuth && !user.isOffline) {
    _unsubscribeFirestore = window.FBAuth.subscribeToUserState(user.uid, (remote, metadata) => {
      if (!remote || remote._deviceId === _deviceId) return;
      // Si tenemos cambios locales pendientes que son más nuevos, proteger nuestro trabajo local
      if (SyncManager.pendingChanges && (!remote.clientUpdatedAt || remote.clientUpdatedAt < (state.lastModifiedAt || ''))) {
        console.warn('BudgetFlow: Se omitió actualización remota para proteger cambios locales pendientes.');
        return;
      }
      Object.assign(state, remote, { editingSourceId: state.editingSourceId });
      ensureEnvelopes();
      reconcileAssignmentsWithDistributions();
      localStorage.setItem('budget_state_' + user.uid, JSON.stringify(state));
      renderOnly();
      toast('Sincronizado');
    });
  }
}

(async () => {
  try {
    applyTheme();
    SyncManager.init();

    if (window.Auth && window.Auth._initInactivityTracker) {
      window.Auth._initInactivityTracker();
    }

    // Si el usuario estaba previamente en modo local/invitado
    if (localStorage.getItem('bf_guest_mode') === 'true' && !window.FBAuth?.currentUser) {
      window.startOfflineGuestMode();
      return;
    }

    if (window.FBAuth) {
      const initialized = await window.FBAuth.init();
      if (initialized) {
        window.FBAuth.onChange((user) => {
          handleUserSession(user);
        });
      } else {
        // Si no hay red o falta configurar Firebase, comprobar si hay usuario guardado previamente
        const lastUser = window.FBAuth.getLastStoredUser();
        if (lastUser) {
          handleUserSession({ ...lastUser, isOffline: true });
        } else if (localStorage.getItem('bf_guest_mode') === 'true') {
          window.startOfflineGuestMode();
        } else if (window.Auth) {
          window.Auth.showAuthPortal({
            defaultTab: 'login',
            onAuthSuccess: (user) => handleUserSession(user)
          });
        } else {
          window.startOfflineGuestMode();
        }
      }
    } else {
      window.startOfflineGuestMode();
    }
  } catch (err) {
    console.error('BudgetFlow: Error en arranque inicial, activando interfaz de respaldo:', err);
    window.startOfflineGuestMode();
  }
})();
