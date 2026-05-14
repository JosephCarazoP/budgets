'use strict';

/* ============================================================
   SUPABASE CONFIG
   Reemplazá estos dos valores con los de tu proyecto:
   Supabase Dashboard → Settings → API
   ============================================================ */

const SUPABASE_URL = 'https://jljdudxbggewxvqmxlvj.supabase.co/rest/v1/'; 
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsamR1ZHhiZ2dld3h2cW14bHZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MDMwNjYsImV4cCI6MjA5NDI3OTA2Nn0.eJAmo8cxkOr5em89domd0NWimI17TUAfaUH0Xo4Pncc';
const STATE_ROW_ID = 'default';

/* ============================================================
   STATE
   ============================================================ */

const DEFAULT_CATEGORIES = [
  { name: 'Alimentación', color: '#ef4444' },
  { name: 'Mascotas',     color: '#f59e0b' },
  { name: 'Transporte',   color: '#10b981' },
  { name: 'Ahorro',       color: '#3b82f6' },
  { name: 'Diversión',    color: '#8b5cf6' }
];

const INITIAL = {
  sources: [], expenses: [], categories: DEFAULT_CATEGORIES,
  theme: 'light', editingSourceId: null
};

const state = { ...INITIAL, ...JSON.parse(localStorage.getItem('budget_state') || '{}') };
if (!state.categories?.length) state.categories = DEFAULT_CATEGORIES;

/* ============================================================
   SUPABASE CLIENT
   ============================================================ */

const _supabaseReady = SUPABASE_URL !== 'YOUR_SUPABASE_URL' && SUPABASE_KEY !== 'YOUR_SUPABASE_ANON_KEY';
const db = _supabaseReady ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

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
      localStorage.setItem('budget_state', JSON.stringify(state));
      renderOnly();
      toast('🔄 Sincronizado con otro dispositivo');
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
const fmt   = (iso) => { if (!iso) return '—'; const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; };

// ID único por pestaña/dispositivo — se regenera con cada recarga
const _deviceId = Math.random().toString(36).slice(2, 8);

/** Guarda en localStorage (inmediato) y en Supabase (async, sin bloquear). */
function save() {
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

let toastTimer;
function toast(msg, duration = 2800) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
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
      map[cat].bySource[s.id] = { sourceName: s.name, assigned: Number(amount || 0), spent: 0 };
    });
  });
  state.expenses.forEach((e) => {
    if (!map[e.category]) map[e.category] = { assigned: 0, spent: 0, color: '#64748b', bySource: {} };
    map[e.category].spent += Number(e.amount);
    if (!map[e.category].bySource[e.sourceId]) {
      const src = state.sources.find((s) => s.id === e.sourceId);
      map[e.category].bySource[e.sourceId] = { sourceName: src?.name || 'Fuente eliminada', assigned: 0, spent: 0 };
    }
    map[e.category].bySource[e.sourceId].spent += Number(e.amount);
  });
  return map;
}

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
}

function toggleTheme() { state.theme = state.theme === 'dark' ? 'light' : 'dark'; applyTheme(); save(); }
$('theme-toggle').addEventListener('click', toggleTheme);
$('theme-toggle-mobile').addEventListener('click', toggleTheme);

/* ============================================================
   RENDER KPIs
   ============================================================ */

function renderKPIs() {
  const income      = state.sources.reduce((a, b) => a + Number(b.amount), 0);
  const distributed = state.sources.reduce((a, s) => a + Object.values(s.distribution || {}).reduce((x, y) => x + Number(y || 0), 0), 0);
  const expenses    = state.expenses.reduce((a, b) => a + Number(b.amount), 0);
  const available   = income - expenses;
  const unassigned  = income - distributed;

  const kpis = [
    { label: 'Ingresos totales', value: money(income), sub: `${state.sources.length} fuente(s)`,
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>` },
    { label: 'Distribuido', value: money(distributed), sub: `Sin asignar: ${money(unassigned)}`,
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>` },
    { label: 'Gastos totales', value: money(expenses), sub: `${state.expenses.length} transacción(es)`,
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>` },
    { label: 'Disponible', value: money(available), sub: income > 0 ? `${Math.round((available/income)*100)}% del ingreso` : '—',
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>` }
  ];

  $('kpis').innerHTML = kpis.map(({ label, value, sub, icon }) => `
    <div class="kpi-card">
      <div class="kpi-label">${icon}${label}</div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-sub">${sub}</div>
    </div>`).join('');
}

/* ============================================================
   RENDER CHARTS
   ============================================================ */

let categoriesChart, balanceChart;

function renderCharts() {
  const map    = categoryMap();
  const labels = Object.keys(map).filter((k) => map[k].assigned > 0 || map[k].spent > 0);
  if (!labels.length) { labels.push(...Object.keys(map).slice(0, 5)); }

  const assignedData = labels.map((l) => map[l].assigned);
  const spentData    = labels.map((l) => map[l].spent);
  const colors       = labels.map((l) => map[l].color || '#64748b');

  const isDark = state.theme === 'dark';
  const gridColor  = isDark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.06)';
  const labelColor = isDark ? '#a1a1aa' : '#71717a';

  Chart.defaults.color = labelColor;

  categoriesChart?.destroy();
  categoriesChart = new Chart($('chart-categories'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: assignedData, backgroundColor: colors, borderWidth: 2,
      borderColor: isDark ? '#18181b' : '#fff' }] },
    options: {
      cutout: '65%',
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 11, family: 'Geist, system-ui' } } },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${money(c.raw)}` } }
      }
    }
  });

  balanceChart?.destroy();
  balanceChart = new Chart($('chart-balance'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Asignado', data: assignedData, backgroundColor: colors.map((c) => c + 'aa'), borderRadius: 4 },
        { label: 'Gastado',  data: spentData,    backgroundColor: '#ef444477',                borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      scales: {
        x: { grid: { color: gridColor }, ticks: { font: { size: 10, family: 'Geist, system-ui' } } },
        y: { grid: { color: gridColor }, ticks: { callback: (v) => `₡${(v/1000).toFixed(0)}k`, font: { size: 10, family: 'Geist, system-ui' } } }
      },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } } }
    }
  });
}

/* ============================================================
   RENDER RECENT EXPENSES (dashboard)
   ============================================================ */

function renderRecentExpenses() {
  const recent = [...state.expenses].sort((a, b) => b.date?.localeCompare(a.date)).slice(0, 5);
  const el     = $('recent-expenses-list');

  if (!recent.length) {
    el.innerHTML = `<div class="empty-state">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>
      <p>Sin gastos registrados</p><span>Añade tu primer gasto en la sección Gastos</span></div>`;
    return;
  }

  el.innerHTML = recent.map((e) => {
    const src = state.sources.find((s) => s.id === e.sourceId);
    const cat = state.categories.find((c) => c.name === e.category);
    return `<div class="recent-row">
      <div class="recent-left">
        <div class="recent-desc">${e.desc}</div>
        <div class="recent-meta">${fmt(e.date)} · <span style="display:inline-flex;align-items:center;gap:.25rem">
          <span style="width:7px;height:7px;border-radius:50%;background:${cat?.color || '#888'};display:inline-block"></span>
          ${e.category}</span> · ${src?.name || '—'}</div>
      </div>
      <div class="recent-amount">-${money(e.amount)}</div>
    </div>`;
  }).join('');
}

/* ============================================================
   RENDER SOURCES
   ============================================================ */

function renderSources() {
  const el = $('sources');
  if (!state.sources.length) {
    el.innerHTML = `<div class="empty-state" style="padding:2rem">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
      <p>Sin fuentes de ingreso</p><span>Crea tu primera fuente arriba</span></div>`;
    return;
  }

  el.innerHTML = state.sources.map((s) => {
    const t   = sourceTotals(s);
    const pct = Number(s.amount) ? Math.min(100, (t.assigned / Number(s.amount)) * 100) : 0;
    const badge = s.status === 'recibido'
      ? `<span class="badge badge-received">✓ Recibido</span>`
      : `<span class="badge badge-pending">⏳ Pendiente</span>`;

    const distChips = Object.entries(s.distribution || {}).map(([cat, amt]) => {
      const color = state.categories.find((c) => c.name === cat)?.color || '#64748b';
      return `<span class="dist-chip"><span class="dot" style="background:${color}"></span>${cat}: ${money(amt)}</span>`;
    }).join('');

    return `<div class="source-card">
      <div class="source-header">
        <div>
          <div class="source-name">${s.name}</div>
          <div class="exp-sub" style="margin-top:.15rem">Esperado: ${fmt(s.date)}</div>
        </div>
        <div class="source-meta">
          ${badge}
          <div class="source-actions">
            <button class="btn-ghost" style="padding:.35rem .65rem;font-size:.8rem" onclick="startEditSource('${s.id}')">Editar</button>
            <button class="btn-danger" onclick="deleteSource('${s.id}')">Eliminar</button>
          </div>
        </div>
      </div>

      <div class="source-body">
        <div class="source-stats">
          <div class="stat"><span class="stat-label">Total</span><span class="stat-value">${money(s.amount)}</span></div>
          <div class="stat"><span class="stat-label">Asignado</span><span class="stat-value">${money(t.assigned)}</span></div>
          <div class="stat"><span class="stat-label">Sin asignar</span><span class="stat-value" style="color:${t.unassigned < 0 ? 'var(--danger)' : 'inherit'}">${money(t.unassigned)}</span></div>
          <div class="stat"><span class="stat-label">Gastado</span><span class="stat-value" style="color:var(--danger)">${money(t.spent)}</span></div>
        </div>

        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>

        ${distChips ? `<div class="dist-list">${distChips}</div>` : ''}

        <form class="dist-form" style="margin-top:.75rem" onsubmit="addDistribution(event,'${s.id}')">
          <select name="category" required>
            ${state.categories.map((c) => `<option value="${c.name}">${c.name}</option>`).join('')}
          </select>
          <input name="amount" type="number" min="0" step="0.01" placeholder="Monto a asignar" required />
          <button type="submit" class="btn-primary" style="white-space:nowrap">Asignar</button>
        </form>
      </div>
    </div>`;
  }).join('');
}

/* ============================================================
   SOURCE CRUD
   ============================================================ */

window.startEditSource = function(id) {
  const s = state.sources.find((x) => x.id === id);
  if (!s) return;
  state.editingSourceId = id;
  $('source-name').value   = s.name;
  $('source-amount').value = s.amount;
  $('source-date').value   = s.date;
  $('source-status').value = s.status;
  $('source-submit-btn').textContent  = 'Actualizar fuente';
  $('source-form-title').textContent  = 'Editar fuente';
  $('cancel-edit-btn').style.display  = '';
  switchTab('sources');
  $('source-name').focus();
};

window.deleteSource = function(id) {
  if (!confirm('¿Eliminar esta fuente y todos sus gastos asociados?')) return;
  state.sources  = state.sources.filter((s) => s.id !== id);
  state.expenses = state.expenses.filter((e) => e.sourceId !== id);
  if (state.editingSourceId === id) cancelEdit();
  renderAll();
  toast('Fuente eliminada');
};

function cancelEdit() {
  state.editingSourceId = null;
  $('source-form').reset();
  $('source-date').valueAsDate         = new Date();
  $('source-submit-btn').textContent   = 'Guardar fuente';
  $('source-form-title').textContent   = 'Nueva fuente';
  $('cancel-edit-btn').style.display   = 'none';
}

$('cancel-edit-btn').addEventListener('click', cancelEdit);

$('source-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const payload = {
    name:   $('source-name').value.trim(),
    amount: Number($('source-amount').value),
    date:   $('source-date').value,
    status: $('source-status').value
  };
  if (state.editingSourceId) {
    const s = state.sources.find((x) => x.id === state.editingSourceId);
    Object.assign(s, payload);
    toast(`Fuente "${payload.name}" actualizada`);
    cancelEdit();
  } else {
    state.sources.push({ id: uid(), ...payload, distribution: {} });
    toast(`Fuente "${payload.name}" creada`);
    e.target.reset();
    $('source-date').valueAsDate = new Date();
  }
  renderAll();
});

/* ============================================================
   DISTRIBUTION
   ============================================================ */

window.addDistribution = function(e, sourceId) {
  e.preventDefault();
  const category = e.target.category.value;
  const amount   = Number(e.target.amount.value);
  const source   = state.sources.find((s) => s.id === sourceId);
  if (!source || !category || amount < 0) return;
  const dist  = { ...(source.distribution || {}) };
  dist[category] = (dist[category] || 0) + amount;
  const total = Object.values(dist).reduce((a, b) => a + Number(b || 0), 0);
  if (total > Number(source.amount)) {
    toast(`⚠️ Excede el total de la fuente (${money(source.amount)})`); return;
  }
  source.distribution = dist;
  e.target.reset();
  renderAll();
  toast(`Asignado ${money(amount)} a ${category}`);
};

/* ============================================================
   RENDER CATEGORIES
   ============================================================ */

function renderCategories() {
  // chips
  $('category-list').innerHTML = state.categories.map((c) =>
    `<span class="chip" style="background:${c.color}">${c.name}</span>`).join('');

  // selects
  const opts = state.categories.map((c) => `<option value="${c.name}">${c.name}</option>`).join('');
  $('expense-category').innerHTML  = opts;
  $('filter-category').innerHTML   = `<option value="">Todas las categorías</option>${opts}`;

  const map = categoryMap();
  const el  = $('categories');

  const entries = Object.entries(map);
  if (!entries.length) { el.innerHTML = ''; return; }

  el.innerHTML = entries.map(([cat, d]) => {
    const pct    = d.assigned > 0 ? Math.min(100, (d.spent / d.assigned) * 100) : 0;
    const detail = Object.values(d.bySource).map((x) => `
      <div class="breakdown-row">
        <span class="src-name">${x.sourceName}</span>
        <div class="src-vals">
          <span>Asig: <b>${money(x.assigned)}</b></span>
          <span>Gast: <b>${money(x.spent)}</b></span>
          <span>Disp: <b>${money(x.assigned - x.spent)}</b></span>
        </div>
      </div>`).join('');

    return `<div class="category-card">
      <div class="category-header">
        <div class="category-title">
          <span class="cat-dot" style="background:${d.color}"></span>
          ${cat}
        </div>
        <div class="category-amounts">
          <span class="spent">-${money(d.spent)}</span>
          <span class="sep">/</span>
          ${money(d.assigned)}
        </div>
      </div>
      <div class="category-body">
        <div class="cat-progress-wrap">
          <div class="progress-bar" style="flex:1">
            <div class="progress-fill" style="width:${pct}%;background:${d.color}"></div>
          </div>
          <span class="cat-pct">${Math.round(pct)}%</span>
        </div>
        ${detail ? `<details><summary>Desglose por fuente</summary><div class="source-breakdown">${detail}</div></details>` : ''}
      </div>
    </div>`;
  }).join('');
}

$('category-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name  = $('category-name').value.trim();
  const color = $('category-color').value;
  if (!name) return;
  if (state.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    toast('⚠️ Esa categoría ya existe'); return;
  }
  state.categories.push({ name, color });
  e.target.reset();
  $('category-color').value = '#3b82f6';
  renderAll();
  toast(`Categoría "${name}" creada`);
});

/* ============================================================
   RENDER EXPENSES
   ============================================================ */

function renderExpensesList() {
  const filterSrc = $('filter-source').value;
  const filterCat = $('filter-category').value;

  let list = [...state.expenses].sort((a, b) => b.date?.localeCompare(a.date));
  if (filterSrc) list = list.filter((e) => e.sourceId === filterSrc);
  if (filterCat) list = list.filter((e) => e.category === filterCat);

  const el = $('expenses-list');

  if (!list.length) {
    el.innerHTML = `<div class="empty-state">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>
      <p>Sin gastos</p><span>Ajusta los filtros o registra un nuevo gasto</span></div>`;
    return;
  }

  el.innerHTML = `
    <div class="expense-table-header">
      <span>Descripción</span><span>Categoría</span><span>Fuente</span><span>Monto</span><span>Fecha</span>
    </div>` +
    list.map((e) => {
      const src = state.sources.find((s) => s.id === e.sourceId);
      const cat = state.categories.find((c) => c.name === e.category);
      return `<div class="expense-row">
        <div><div class="exp-desc">${e.desc}</div></div>
        <div><span class="exp-tag"><span style="width:7px;height:7px;border-radius:50%;background:${cat?.color || '#888'}"></span>${e.category}</span></div>
        <div class="exp-tag" style="width:fit-content">${src?.name || '—'}</div>
        <div class="exp-amount">-${money(e.amount)}</div>
        <div class="exp-date">${fmt(e.date)}</div>
      </div>`;
    }).join('');
}

function renderFilters() {
  $('expense-source').innerHTML   = state.sources.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
  $('filter-source').innerHTML    = `<option value="">Todas las fuentes</option>` +
    state.sources.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
}

$('filter-source').addEventListener('change', renderExpensesList);
$('filter-category').addEventListener('change', renderExpensesList);

$('expense-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const sourceId = $('expense-source').value;
  const category = $('expense-category').value;
  const amount   = Number($('expense-amount').value);
  const desc     = $('expense-desc').value.trim();
  if (!sourceId) { toast('⚠️ Selecciona una fuente'); return; }
  const source   = state.sources.find((s) => s.id === sourceId);
  const assigned = Number(source?.distribution?.[category] || 0);
  const spent    = state.expenses
    .filter((x) => x.sourceId === sourceId && x.category === category)
    .reduce((a, b) => a + Number(b.amount), 0);
  if (spent + amount > assigned) {
    toast(`⚠️ Excede el límite asignado (${money(assigned - spent)} disponible)`); return;
  }
  state.expenses.push({ id: uid(), sourceId, category, amount, desc, date: new Date().toISOString().slice(0, 10) });
  e.target.reset();
  renderAll();
  toast(`Gasto de ${money(amount)} registrado`);
});

/* ============================================================
   RENDER ALL / PER TAB
   ============================================================ */

function renderTab(tab) {
  switch (tab) {
    case 'dashboard':
      renderKPIs();
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

const calcState = { expr: '', result: '0', justEvaled: false };

function calcRender() {
  $('calc-expr').textContent    = calcState.expr;
  $('calc-display').textContent = calcState.result;
}

function calcInput(val) {
  if (calcState.justEvaled && !'+-×÷'.includes(val)) {
    calcState.expr = ''; calcState.result = '0';
  }
  calcState.justEvaled = false;
  const ops = ['+', '−', '×', '÷'];
  const lastChar = calcState.expr.slice(-1);
  if (ops.includes(val) && ops.includes(lastChar)) return; // no double ops
  if (val === '.' && /[0-9]*\.[0-9]*$/.test(calcState.expr.split(/[+\-×÷]/).pop())) return;
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
    if (!isFinite(r)) { calcState.result = 'Error'; calcState.expr = ''; }
    else {
      calcState.expr   = calcState.result;
      calcState.result = +parseFloat(r.toFixed(10)) + '';
    }
    calcState.justEvaled = true;
  } catch {
    calcState.result = 'Error';
    calcState.expr   = '';
  }
  calcRender();
}

function calcPercent() {
  try {
    const safe = calcState.expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
    // eslint-disable-next-line no-new-func
    const r = Function('"use strict";return (' + safe + ')')();
    calcState.result = +parseFloat((r / 100).toFixed(10)) + '';
    calcState.expr   = calcState.result;
    calcState.justEvaled = true;
  } catch { /* ignore */ }
  calcRender();
}

// FAB toggle
$('calc-fab').addEventListener('click', () => {
  const panel = $('calc-panel');
  const open  = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : '';
  if (!open) {
    // re-trigger animation
    panel.style.animation = 'none';
    requestAnimationFrame(() => { panel.style.animation = ''; });
    calcRender();
  }
});

$('calc-close').addEventListener('click', () => { $('calc-panel').style.display = 'none'; });

// Calculator button delegation
$('calc-panel').addEventListener('click', (e) => {
  const btn = e.target.closest('.calc-btn');
  if (!btn) return;
  const action = btn.dataset.action;
  const val    = btn.dataset.val;
  if (action === 'clear')     { calcState.expr = ''; calcState.result = '0'; calcState.justEvaled = false; calcRender(); }
  else if (action === 'backspace') {
    calcState.expr   = calcState.expr.slice(0, -1);
    calcState.result = calcState.expr || '0';
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
  else if (k === 'back') { calcState.expr = calcState.expr.slice(0,-1); calcState.result = calcState.expr||'0'; calcRender(); }
  else if (k === 'esc') $('calc-panel').style.display = 'none';
  else if (k === '%') calcPercent();
  else calcInput(k);
});

/* ============================================================
   RENDER CATEGORY SUMMARY (dashboard)
   ============================================================ */

function renderCatSummary() {
  const map     = categoryMap();
  const entries = Object.entries(map).filter(([, d]) => d.assigned > 0);
  const el      = $('cat-summary-list');
  const count   = $('cat-summary-count');

  if (!entries.length) {
    el.innerHTML = `<div class="empty-state" style="padding:1.5rem">
      <p>Sin categorías con asignación</p>
      <span>Distribuye montos en tus fuentes primero</span>
    </div>`;
    if (count) count.textContent = '';
    return;
  }

  if (count) count.textContent = `${entries.length} categorías`;

  el.innerHTML = `
    <div class="cat-summary-header">
      <span>Categoría</span>
      <span>Progreso</span>
      <span style="text-align:right">Asignado</span>
      <span style="text-align:right">Gastado</span>
      <span style="text-align:right">Disponible</span>
    </div>` +
    entries.map(([cat, d]) => {
      const pct       = d.assigned > 0 ? Math.min(100, (d.spent / d.assigned) * 100) : 0;
      const remaining = d.assigned - d.spent;
      const over      = remaining < 0;
      return `<div class="cat-summary-row">
        <div class="cat-sum-name">
          <span class="cat-dot" style="background:${d.color}"></span>
          ${cat}
        </div>
        <div class="cat-sum-bar-wrap">
          <div class="cat-sum-bar">
            <div class="cat-sum-bar-fill" style="width:${pct}%;background:${over ? 'var(--danger)' : d.color}"></div>
          </div>
          <span class="cat-sum-pct">${Math.round(pct)}%</span>
        </div>
        <div class="cat-sum-col">
          <div class="label">Asignado</div>
          <div class="val">${money(d.assigned)}</div>
        </div>
        <div class="cat-sum-col">
          <div class="label">Gastado</div>
          <div class="val spent">-${money(d.spent)}</div>
        </div>
        <div class="cat-sum-col">
          <div class="label">Disponible</div>
          <div class="val ${over ? 'over' : 'remaining'}">${over ? '-' : ''}${money(Math.abs(remaining))}</div>
        </div>
      </div>`;
    }).join('');
}

/* ============================================================
   INIT  (async: carga Supabase primero, localStorage como fallback)
   ============================================================ */

(async () => {
  const fromCloud = await loadFromSupabase();
  if (!fromCloud && !_supabaseReady) {
    console.info(
      '%cBudgetFlow: Supabase no configurado.\nEdita SUPABASE_URL y SUPABASE_KEY en app.js para activar la sincronización entre dispositivos.',
      'color:#f59e0b;font-weight:bold'
    );
  }
  setupRealtime();
  $('source-date').valueAsDate = new Date();
  applyTheme();
  renderAll();
  switchTab('dashboard');
})();
