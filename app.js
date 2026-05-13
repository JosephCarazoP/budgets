const money = (n) => `₡${Number(n || 0).toLocaleString('es-CR', { maximumFractionDigits: 2 })}`;

const state = JSON.parse(localStorage.getItem('budget_state') || '{"sources":[],"expenses":[]}');

const byId = (id) => document.getElementById(id);

function uid() { return Math.random().toString(36).slice(2, 10); }
function save() { localStorage.setItem('budget_state', JSON.stringify(state)); }

function sourceTotals(source) {
  const assigned = Object.values(source.distribution || {}).reduce((a,b)=>a+Number(b||0),0);
  const spent = state.expenses.filter(e => e.sourceId === source.id).reduce((a,b)=>a+Number(b.amount),0);
  return { assigned, spent, unassigned: Number(source.amount)-assigned, available: Number(source.amount)-spent };
}

function categoryMap() {
  const map = {};
  state.sources.forEach(s => {
    Object.entries(s.distribution || {}).forEach(([cat, amount]) => {
      if (!map[cat]) map[cat] = { assigned: 0, spent: 0, bySource: {} };
      map[cat].assigned += Number(amount || 0);
      map[cat].bySource[s.id] = { sourceName: s.name, assigned: Number(amount || 0), spent: 0 };
    });
  });

  state.expenses.forEach(e => {
    if (!map[e.category]) map[e.category] = { assigned: 0, spent: 0, bySource: {} };
    map[e.category].spent += Number(e.amount);
    if (!map[e.category].bySource[e.sourceId]) {
      const source = state.sources.find(s=>s.id===e.sourceId);
      map[e.category].bySource[e.sourceId] = { sourceName: source?.name || 'Fuente eliminada', assigned: 0, spent: 0 };
    }
    map[e.category].bySource[e.sourceId].spent += Number(e.amount);
  });
  return map;
}

function renderSummary() {
  const totalIncome = state.sources.reduce((a,b)=>a+Number(b.amount),0);
  const totalAssigned = state.sources.reduce((a,b)=>a+Object.values(b.distribution||{}).reduce((x,y)=>x+Number(y||0),0),0);
  const totalExpenses = state.expenses.reduce((a,b)=>a+Number(b.amount),0);
  const totalUnassigned = totalIncome - totalAssigned;

  byId('summary').innerHTML = `
    <div><b>Ingresos totales</b><br>${money(totalIncome)}</div>
    <div><b>Dinero distribuido</b><br>${money(totalAssigned)}</div>
    <div><b>Sin asignar</b><br>${money(totalUnassigned)}</div>
    <div><b>Gasto acumulado</b><br>${money(totalExpenses)}</div>
  `;
}

function renderSourceSelector() {
  byId('expense-source').innerHTML = state.sources
    .map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
}

function renderSources() {
  byId('sources').innerHTML = state.sources.map(s => {
    const t = sourceTotals(s);
    const pct = Number(s.amount) ? Math.min(100, (t.assigned/Number(s.amount))*100) : 0;
    const distRows = Object.entries(s.distribution || {}).map(([c,m]) => `<li>${c}: ${money(m)}</li>`).join('');
    return `
      <div class="source">
        <div class="row"><b>${s.name}</b><span class="small">${s.status} · ${s.date}</span></div>
        <div class="small">Total: ${money(s.amount)} · Distribuido: ${money(t.assigned)} · Sin asignar: ${money(t.unassigned)}</div>
        <div class="progress"><span style="width:${pct}%"></span></div>
        <div class="distribution">
          <form onsubmit="addDistribution(event, '${s.id}')">
            <input name="category" placeholder="Categoría" required />
            <input name="amount" type="number" min="0" step="0.01" placeholder="Monto" required />
            <button>Agregar/Actualizar distribución</button>
          </form>
          <ul>${distRows || '<li class="small">Sin categorías asignadas</li>'}</ul>
        </div>
      </div>`;
  }).join('');
}

function renderCategories() {
  const map = categoryMap();
  byId('categories').innerHTML = Object.entries(map).map(([cat, data]) => {
    const available = data.assigned - data.spent;
    const pct = data.assigned > 0 ? Math.min(100, (data.spent / data.assigned) * 100) : 0;
    const details = Object.values(data.bySource)
      .map(x => `<li>${x.sourceName}: asignado ${money(x.assigned)}, gastado ${money(x.spent)}, disponible ${money(x.assigned-x.spent)}</li>`)
      .join('');
    return `
      <div class="category">
        <div class="row"><b>${cat}</b><span>${money(data.spent)} / ${money(data.assigned)}</span></div>
        <div class="small">Disponible: ${money(available)}</div>
        <div class="progress"><span style="width:${pct}%"></span></div>
        <details><summary>Ver desglose por fuente</summary><ul>${details}</ul></details>
      </div>`;
  }).join('') || '<p class="small">No hay categorías aún.</p>';
}

function renderAll() {
  renderSummary();
  renderSourceSelector();
  renderSources();
  renderCategories();
  save();
}

document.getElementById('source-form').addEventListener('submit', (e) => {
  e.preventDefault();
  state.sources.push({
    id: uid(),
    name: byId('source-name').value.trim(),
    amount: Number(byId('source-amount').value),
    date: byId('source-date').value,
    status: byId('source-status').value,
    distribution: {}
  });
  e.target.reset();
  renderAll();
});

document.getElementById('expense-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const sourceId = byId('expense-source').value;
  const category = byId('expense-category').value.trim();
  const amount = Number(byId('expense-amount').value);
  if (!sourceId || !category || amount <= 0) return;

  const source = state.sources.find(s => s.id === sourceId);
  const catAssignedInSource = Number(source?.distribution?.[category] || 0);
  const spentInSourceCategory = state.expenses
    .filter(x => x.sourceId === sourceId && x.category === category)
    .reduce((a,b)=>a+Number(b.amount),0);
  if (spentInSourceCategory + amount > catAssignedInSource) {
    alert('El gasto excede lo asignado a esa categoría dentro de la fuente seleccionada.');
    return;
  }

  state.expenses.push({ id: uid(), sourceId, category, amount, desc: byId('expense-desc').value.trim(), date: byId('expense-date').value });
  e.target.reset();
  renderAll();
});

window.addDistribution = function addDistribution(e, sourceId) {
  e.preventDefault();
  const category = e.target.category.value.trim();
  const amount = Number(e.target.amount.value);
  const source = state.sources.find(s => s.id === sourceId);
  if (!source || !category || amount < 0) return;

  const distribution = { ...(source.distribution || {}) };
  distribution[category] = amount;
  const totalAssigned = Object.values(distribution).reduce((a,b)=>a+Number(b||0),0);
  if (totalAssigned > Number(source.amount)) {
    alert('La suma de distribuciones no puede exceder el total de la fuente.');
    return;
  }
  source.distribution = distribution;
  e.target.reset();
  renderAll();
};

byId('expense-date').valueAsDate = new Date();
byId('source-date').valueAsDate = new Date();
renderAll();
