const DEFAULT_CATEGORIES = [
  { name: 'Alimentación', color: '#ef4444' },
  { name: 'Mascotas', color: '#f59e0b' },
  { name: 'Transporte', color: '#10b981' },
  { name: 'Ahorro', color: '#3b82f6' },
  { name: 'Diversión', color: '#8b5cf6' }
];

const initial = { sources: [], expenses: [], categories: DEFAULT_CATEGORIES, theme: 'light', editingSourceId: null };
const state = { ...initial, ...JSON.parse(localStorage.getItem('budget_state') || '{}') };
if (!state.categories?.length) state.categories = DEFAULT_CATEGORIES;

const byId = (id) => document.getElementById(id);
const money = (n) => `₡${Number(n || 0).toLocaleString('es-CR', { maximumFractionDigits: 2 })}`;
const uid = () => Math.random().toString(36).slice(2, 10);
const save = () => localStorage.setItem('budget_state', JSON.stringify(state));

let categoriesChart;
let balanceChart;

function sourceTotals(source) {
  const assigned = Object.values(source.distribution || {}).reduce((a, b) => a + Number(b || 0), 0);
  const spent = state.expenses.filter((e) => e.sourceId === source.id).reduce((a, b) => a + Number(b.amount), 0);
  return { assigned, spent, unassigned: Number(source.amount) - assigned, available: Number(source.amount) - spent };
}

function categoryMap() {
  const map = {};
  state.categories.forEach((c) => { map[c.name] = { assigned: 0, spent: 0, color: c.color, bySource: {} }; });
  state.sources.forEach((s) => Object.entries(s.distribution || {}).forEach(([cat, amount]) => {
    if (!map[cat]) map[cat] = { assigned: 0, spent: 0, color: '#64748b', bySource: {} };
    map[cat].assigned += Number(amount || 0);
    map[cat].bySource[s.id] = { sourceName: s.name, assigned: Number(amount || 0), spent: 0 };
  }));
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

function renderKPIs() {
  const income = state.sources.reduce((a, b) => a + Number(b.amount), 0);
  const distributed = state.sources.reduce((a, s) => a + Object.values(s.distribution || {}).reduce((x, y) => x + Number(y || 0), 0), 0);
  const expenses = state.expenses.reduce((a, b) => a + Number(b.amount), 0);
  const available = income - expenses;
  byId('kpis').innerHTML = [
    ['Ingresos', money(income)],
    ['Distribuido', money(distributed)],
    ['Gastos', money(expenses)],
    ['Disponible', money(available)]
  ].map(([k, v]) => `<div class="kpi"><div class="small">${k}</div><b>${v}</b></div>`).join('');
}

function renderSourceForm() {
  const isEditing = Boolean(state.editingSourceId);
  byId('source-form').querySelector('button').textContent = isEditing ? 'Actualizar' : 'Guardar';
}

function startEditSource(id) {
  const s = state.sources.find((x) => x.id === id);
  if (!s) return;
  state.editingSourceId = id;
  byId('source-name').value = s.name;
  byId('source-amount').value = s.amount;
  byId('source-date').value = s.date;
  byId('source-status').value = s.status;
  renderSourceForm();
}
window.startEditSource = startEditSource;

function deleteSource(id) {
  state.sources = state.sources.filter((s) => s.id !== id);
  state.expenses = state.expenses.filter((e) => e.sourceId !== id);
  if (state.editingSourceId === id) state.editingSourceId = null;
  renderAll();
}
window.deleteSource = deleteSource;

function addDistribution(e, sourceId) {
  e.preventDefault();
  const category = e.target.category.value;
  const amount = Number(e.target.amount.value);
  const source = state.sources.find((s) => s.id === sourceId);
  if (!source || !category || amount < 0) return;
  const dist = { ...(source.distribution || {}) };
  dist[category] = amount;
  const total = Object.values(dist).reduce((a, b) => a + Number(b || 0), 0);
  if (total > Number(source.amount)) return alert('La suma no puede exceder la fuente.');
  source.distribution = dist;
  e.target.reset();
  renderAll();
}
window.addDistribution = addDistribution;

function renderSources() {
  byId('sources').innerHTML = state.sources.map((s) => {
    const t = sourceTotals(s);
    const pct = Number(s.amount) ? Math.min(100, (t.assigned / Number(s.amount)) * 100) : 0;
    return `<div class="source">
      <div class="row"><b>${s.name}</b><span class="small">${s.status} · ${s.date}</span></div>
      <div class="small">Total ${money(s.amount)} · Asignado ${money(t.assigned)} · Sin asignar ${money(t.unassigned)}</div>
      <div class="progress"><span style="width:${pct}%"></span></div>
      <form class="grid grid-3" onsubmit="addDistribution(event,'${s.id}')" style="margin-top:.6rem">
        <select name="category" required>${state.categories.map((c) => `<option>${c.name}</option>`).join('')}</select>
        <input name="amount" type="number" min="0" step="0.01" placeholder="Monto" required />
        <button>Asignar</button>
      </form>
      <div class="actions" style="margin-top:.6rem">
        <button class="ghost" onclick="startEditSource('${s.id}')">Editar</button>
        <button onclick="deleteSource('${s.id}')">Eliminar</button>
      </div>
    </div>`;
  }).join('') || '<p class="small">Sin fuentes.</p>';
}

function renderCategories() {
  byId('category-list').innerHTML = state.categories.map((c) => `<span class="chip" style="background:${c.color}">${c.name}</span>`).join('');
  byId('expense-category').innerHTML = state.categories.map((c) => `<option value="${c.name}">${c.name}</option>`).join('');

  const map = categoryMap();
  byId('categories').innerHTML = Object.entries(map).map(([cat, d]) => {
    const pct = d.assigned > 0 ? Math.min(100, (d.spent / d.assigned) * 100) : 0;
    const detail = Object.values(d.bySource).map((x) => `<li>${x.sourceName}: ${money(x.spent)} / ${money(x.assigned)}</li>`).join('');
    return `<div class="category">
      <div class="row"><b><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${d.color};margin-right:6px"></span>${cat}</b><span>${money(d.spent)} / ${money(d.assigned)}</span></div>
      <div class="progress"><span style="width:${pct}%;background:${d.color}"></span></div>
      <details><summary class="small">Desglose por fuente</summary><ul>${detail}</ul></details>
    </div>`;
  }).join('');

  const labels = Object.keys(map);
  const assignedData = labels.map((l) => map[l].assigned);
  const spentData = labels.map((l) => map[l].spent);
  const colors = labels.map((l) => map[l].color || '#64748b');

  categoriesChart?.destroy();
  categoriesChart = new Chart(byId('chart-categories'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: assignedData, backgroundColor: colors }] },
    options: { plugins: { legend: { position: 'bottom' } } }
  });

  balanceChart?.destroy();
  balanceChart = new Chart(byId('chart-balance'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Asignado', data: assignedData, backgroundColor: '#93c5fd' },
      { label: 'Gastado', data: spentData, backgroundColor: '#fca5a5' }
    ] },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
  });
}

function renderSourceSelect() {
  byId('expense-source').innerHTML = state.sources.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
}

function renderTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  byId('theme-toggle').textContent = state.theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode';
}

function renderAll() {
  renderTheme();
  renderKPIs();
  renderSourceForm();
  renderSources();
  renderCategories();
  renderSourceSelect();
  save();
}

byId('theme-toggle').addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  renderAll();
});

byId('category-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = byId('category-name').value.trim();
  const color = byId('category-color').value;
  if (!name) return;
  if (state.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) return alert('Ya existe esa categoría.');
  state.categories.push({ name, color });
  e.target.reset();
  byId('category-color').value = '#3b82f6';
  renderAll();
});

byId('source-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const payload = {
    name: byId('source-name').value.trim(),
    amount: Number(byId('source-amount').value),
    date: byId('source-date').value,
    status: byId('source-status').value
  };
  if (state.editingSourceId) {
    const s = state.sources.find((x) => x.id === state.editingSourceId);
    Object.assign(s, payload);
    state.editingSourceId = null;
  } else {
    state.sources.push({ id: uid(), ...payload, distribution: {} });
  }
  e.target.reset();
  byId('source-date').valueAsDate = new Date();
  renderAll();
});

byId('expense-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const sourceId = byId('expense-source').value;
  const category = byId('expense-category').value;
  const amount = Number(byId('expense-amount').value);
  const desc = byId('expense-desc').value.trim();
  const source = state.sources.find((s) => s.id === sourceId);
  const assigned = Number(source?.distribution?.[category] || 0);
  const spent = state.expenses.filter((x) => x.sourceId === sourceId && x.category === category).reduce((a, b) => a + Number(b.amount), 0);
  if (spent + amount > assigned) return alert('El gasto excede el límite asignado para esa fuente/categoría.');
  state.expenses.push({ id: uid(), sourceId, category, amount, desc, date: new Date().toISOString().slice(0, 10) });
  e.target.reset();
  renderAll();
});

byId('source-date').valueAsDate = new Date();
renderAll();
