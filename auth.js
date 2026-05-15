'use strict';

/* ============================================================
   BUDGETFLOW — AUTH MODULE  (Supabase edition)
   
   La configuración de la contraseña (hash, expiración) se
   guarda en Supabase → tabla budget_state, campo auth_cfg.
   Así es la misma en todos los dispositivos.

   La sesión "Recordarme" sigue siendo local (localStorage)
   porque es intencional: cada dispositivo decide si recordar.

   Seguridad:
   - La contraseña se hashea con SHA-256 (Web Crypto API).
   - NUNCA se guarda la contraseña en texto plano.
   - El token de sesión local se deriva del hash+createdAt
     guardado en Supabase, por lo que cambiar la contraseña
     invalida todas las sesiones guardadas automáticamente.
   ============================================================ */

const SESSION_KEY = 'bf_auth_ses';   // Solo la sesión es local

/* ---- Helpers ---- */
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function now()      { return Date.now(); }
function daysMs(d)  { return d * 86_400_000; }

/**
 * Espera hasta que window.db y window.STATE_ROW_ID estén listos (máx maxMs ms).
 * Esto evita que en un dispositivo nuevo se muestre "Crear contraseña" cuando
 * en realidad la contraseña ya existe en Supabase pero db aún no se inicializó.
 */
async function waitForDb(maxMs = 4000, intervalMs = 80) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (window.db && window.STATE_ROW_ID) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return !!(window.db && window.STATE_ROW_ID);
}

/* ---- Supabase: leer y escribir auth_cfg ---- */

/**
 * Lee auth_cfg desde Supabase.
 * Retorna el objeto { hash, createdAt, expiresAt, durationDays } o null.
 * Usa la instancia `db` y la constante `STATE_ROW_ID` definidas en app.js.
 */
async function _getAuthCfg() {
  await waitForDb();
  if (!window.db || !window.STATE_ROW_ID) return null;
  try {
    // Intentar leer ambos campos a la vez para soportar ambas versiones del schema.
    // Si auth_cfg (columna dedicada) existe y tiene valor, la usamos.
    // Si no, intentamos data._authCfg (versión anterior embebida en el JSON de estado).
    const { data, error } = await window.db
      .from('budget_state')
      .select('data, auth_cfg')
      .eq('id', window.STATE_ROW_ID)
      .single();
    if (error || !data) return null;

    // Columna dedicada (versión nueva)
    if (data.auth_cfg?.hash) return data.auth_cfg;

    // Fallback: embebido en data JSON (versión anterior)
    const legacy = data?.data?._authCfg;
    if (legacy?.hash) {
      // Migrar silenciosamente a columna dedicada para que otros dispositivos la vean
      _setAuthCfgDirect(legacy).catch(() => {});
      return legacy;
    }

    return null;
  } catch {
    return null;
  }
}

/** Escribe en la columna auth_cfg. Separado para evitar recursión en migración. */
async function _setAuthCfgDirect(cfg) {
  if (!window.db || !window.STATE_ROW_ID) return;
  try {
    await window.db
      .from('budget_state')
      .update({ auth_cfg: cfg })
      .eq('id', window.STATE_ROW_ID);
  } catch { /* ignorar si la columna no existe aún */ }
}

/**
 * Guarda auth_cfg en Supabase.
 * Si cfg es null, borra la protección.
 */
async function _setAuthCfg(cfg) {
  await waitForDb();
  if (!window.db || !window.STATE_ROW_ID) return;

  // Guardar en columna dedicada (si existe en el schema)
  await _setAuthCfgDirect(cfg);

  // También actualizar data._authCfg para compatibilidad hacia atrás
  try {
    const { data, error } = await window.db
      .from('budget_state')
      .select('data')
      .eq('id', window.STATE_ROW_ID)
      .single();
    if (error || !data?.data) return;
    const merged = { ...data.data };
    if (cfg) merged._authCfg = cfg;
    else delete merged._authCfg;
    await window.db
      .from('budget_state')
      .update({ data: merged })
      .eq('id', window.STATE_ROW_ID);
  } catch { /* no bloquear si falla */ }
}

/* ---- Sesión local (Recordarme, por dispositivo) ---- */
function getSession()                       { try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; } }
function setSession(token, expiresAt)       { localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt })); }
function clearSession()                     { localStorage.removeItem(SESSION_KEY); }

/* ---- Public API ---- */
const Auth = {

  /** Cache en memoria para no consultar Supabase en cada operación de la misma sesión. */
  _cfg: undefined,   // undefined = no cargado aún; null = sin contraseña; object = configuración

  /** Carga (o devuelve desde cache) la configuración. */
  async _loadCfg() {
    if (Auth._cfg !== undefined) return Auth._cfg;
    Auth._cfg = await _getAuthCfg();
    return Auth._cfg;
  },

  /** Invalida el cache (tras cambiar/eliminar contraseña). */
  _invalidateCfg() { Auth._cfg = undefined; },

  /* ---- Estado ---- */

  async isConfigured() {
    const cfg = await Auth._loadCfg();
    return !!cfg?.hash;
  },

  async isExpired() {
    const cfg = await Auth._loadCfg();
    if (!cfg?.expiresAt) return false;
    return now() > cfg.expiresAt;
  },

  async expiresInDays() {
    const cfg = await Auth._loadCfg();
    if (!cfg?.expiresAt) return Infinity;
    return Math.ceil((cfg.expiresAt - now()) / daysMs(1));
  },

  async needsRenewalWarning() {
    const d = await Auth.expiresInDays();
    return d >= 0 && d <= 7;
  },

  async getDurationDays() {
    const cfg = await Auth._loadCfg();
    return cfg?.durationDays || 30;
  },

  /* ---- Sesión ---- */

  /** ¿La sesión guardada en este dispositivo sigue siendo válida? */
  async isSessionValid() {
    const cfg = await Auth._loadCfg();
    if (!cfg?.hash) return true;          // Sin contraseña → acceso libre
    const ses = getSession();
    if (!ses) return false;
    if (now() > ses.expiresAt) { clearSession(); return false; }
    const expected = await sha256(cfg.hash + cfg.createdAt);
    return ses.token === expected;
  },

  /** Guarda una sesión "Recordarme" en este dispositivo. */
  async createSession() {
    const cfg = await Auth._loadCfg();
    if (!cfg) return;
    const token     = await sha256(cfg.hash + cfg.createdAt);
    const expiresAt = cfg.expiresAt;
    setSession(token, expiresAt);
  },

  /** Verifica la contraseña ingresada. */
  async verify(plain) {
    const cfg = await Auth._loadCfg();
    if (!cfg?.hash) return true;
    return (await sha256(plain)) === cfg.hash;
  },

  /** Crea o cambia la contraseña. Guarda en Supabase e invalida sesiones locales. */
  async setPassword(plain, durationDays) {
    const hash      = await sha256(plain);
    const createdAt = now();
    const expiresAt = createdAt + daysMs(durationDays);
    const cfg       = { hash, createdAt, expiresAt, durationDays };
    await _setAuthCfg(cfg);
    Auth._cfg = cfg;           // Actualizar cache
    clearSession();            // Forzar re-login en este dispositivo
  },

  /** Elimina la contraseña de todos los dispositivos. */
  async removePassword() {
    await _setAuthCfg(null);
    Auth._cfg = null;
    clearSession();
  },

  /** Cierra sesión en este dispositivo. */
  logout() { clearSession(); Auth._cfg = undefined; Auth.showLock(); },

  /* ================================================================
     UI
     ================================================================ */

  /** Punto de entrada. Llama esto antes de mostrar la app. */
  async init(onUnlocked) {
    Auth._onUnlocked = onUnlocked;

    // Mostrar spinner mientras esperamos a Supabase.
    // Sin esto, un dispositivo nuevo flashea "Crear contraseña" antes de saber
    // si ya hay una contraseña configurada en otro dispositivo.
    Auth._showLoadingOverlay();

    // _loadCfg ya llama waitForDb internamente, así que esto bloquea
    // hasta que la nube responda (o se agote el tiempo).
    const configured = await Auth.isConfigured();

    Auth._removeLoadingOverlay();

    if (!configured) {
      Auth._showSetup();
      return;
    }

    if (await Auth.isExpired()) {
      Auth._showExpired();
      return;
    }

    if (await Auth.isSessionValid()) {
      Auth._unlock();
      return;
    }

    Auth.showLock();
  },

  showLock() { Auth._renderOverlay('lock'); },

  /* ---- Loading overlay (spinner mientras se conecta con Supabase) ---- */
  _showLoadingOverlay() {
    if (document.getElementById('auth-overlay')) return;
    const el = document.createElement('div');
    el.id = 'auth-overlay';
    el.className = 'auth-overlay';
    el.innerHTML = `
      <div class="auth-card" style="align-items:center;gap:1.5rem;padding:2.5rem 2rem">
        <div class="auth-logo">
          <svg width="36" height="36" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="7" fill="#18181b"/>
            <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
              font-size="17" font-family="system-ui,sans-serif" fill="white">₡</text>
          </svg>
          <span class="auth-logo-name">BudgetFlow</span>
        </div>
        <div style="display:flex;align-items:center;gap:.6rem;color:var(--text-secondary,#71717a);font-size:.875rem">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
            style="animation:auth-spin 1s linear infinite;flex-shrink:0">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
          Conectando…
        </div>
      </div>`;
    document.body.appendChild(el);
  },

  _removeLoadingOverlay() {
    const el = document.getElementById('auth-overlay');
    if (el) el.remove();
  },

  _unlock() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) {
      overlay.classList.add('auth-fade-out');
      setTimeout(() => overlay.remove(), 320);
    }
    if (Auth._onUnlocked) Auth._onUnlocked();
    Auth.needsRenewalWarning().then(warn => {
      if (warn) {
        Auth.expiresInDays().then(d => {
          setTimeout(() => {
            if (window.toast) toast(`⚠️ Tu contraseña vence en ${d} día${d !== 1 ? 's' : ''}. Cámbiala en Ajustes.`, 5000);
          }, 1200);
        });
      }
    });
  },

  _showSetup()   { Auth._renderOverlay('setup');   },
  _showExpired() { Auth._renderOverlay('expired'); },

  /* ---- Overlay renderer ---- */
  _renderOverlay(mode) {
    document.getElementById('auth-overlay')?.remove();

    const el      = document.createElement('div');
    el.id         = 'auth-overlay';
    el.className  = 'auth-overlay';

    const DURATION_OPTIONS = [
      { value: 15,  label: '15 días' },
      { value: 30,  label: '30 días' },
      { value: 60,  label: '2 meses' },
      { value: 90,  label: '3 meses' },
      { value: 180, label: '6 meses' },
    ];

    const durationSelect = `
      <div class="auth-field">
        <label class="auth-label">Vigencia de la contraseña</label>
        <select class="auth-select" id="auth-duration">
          ${DURATION_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
        </select>
      </div>`;

    const logo = `
      <div class="auth-logo">
        <svg width="36" height="36" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="7" fill="#18181b"/>
          <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
            font-size="17" font-family="system-ui,sans-serif" fill="white">₡</text>
        </svg>
        <span class="auth-logo-name">BudgetFlow</span>
      </div>`;

    if (mode === 'lock') {
      el.innerHTML = `
        <div class="auth-card">
          ${logo}
          <div class="auth-heading">
            <h2>Acceso protegido</h2>
            <p class="auth-sub">Ingresa tu contraseña para continuar</p>
          </div>
          <div class="auth-field">
            <label class="auth-label">Contraseña</label>
            <div class="auth-input-wrap">
              <input type="password" id="auth-pw" class="auth-input"
                placeholder="••••••••" autocomplete="current-password" autofocus />
              <button type="button" class="auth-eye" id="auth-eye" aria-label="Ver contraseña">
                ${Auth._eyeIcon(false)}
              </button>
            </div>
          </div>
          <label class="auth-remember">
            <input type="checkbox" id="auth-remember" />
            <span class="auth-checkbox-custom"></span>
            <span>Recordarme en este dispositivo</span>
          </label>
          <div class="auth-error" id="auth-error"></div>
          <button class="auth-btn" id="auth-submit">Entrar</button>
        </div>`;
    }

    if (mode === 'setup') {
      el.innerHTML = `
        <div class="auth-card">
          ${logo}
          <div class="auth-heading">
            <h2>Crear contraseña</h2>
            <p class="auth-sub">Protege tu BudgetFlow. Esta contraseña se pedirá en dispositivos nuevos.</p>
          </div>
          <div class="auth-field">
            <label class="auth-label">Nueva contraseña</label>
            <div class="auth-input-wrap">
              <input type="password" id="auth-pw" class="auth-input"
                placeholder="Mínimo 6 caracteres" autocomplete="new-password" autofocus />
              <button type="button" class="auth-eye" id="auth-eye">${Auth._eyeIcon(false)}</button>
            </div>
          </div>
          <div class="auth-field">
            <label class="auth-label">Confirmar contraseña</label>
            <div class="auth-input-wrap">
              <input type="password" id="auth-pw2" class="auth-input"
                placeholder="Repite la contraseña" autocomplete="new-password" />
              <button type="button" class="auth-eye" id="auth-eye2">${Auth._eyeIcon(false)}</button>
            </div>
          </div>
          ${durationSelect}
          <div class="auth-error" id="auth-error"></div>
          <button class="auth-btn" id="auth-submit">Crear contraseña</button>
        </div>`;
    }

    if (mode === 'expired') {
      el.innerHTML = `
        <div class="auth-card">
          ${logo}
          <div class="auth-heading">
            <div class="auth-badge-warn">Contraseña vencida</div>
            <h2>Tiempo de renovar</h2>
            <p class="auth-sub">Tu contraseña ha vencido. Crea una nueva para continuar.</p>
          </div>
          <div class="auth-field">
            <label class="auth-label">Contraseña actual</label>
            <div class="auth-input-wrap">
              <input type="password" id="auth-old-pw" class="auth-input"
                placeholder="••••••••" autocomplete="current-password" autofocus />
              <button type="button" class="auth-eye" id="auth-eye-old">${Auth._eyeIcon(false)}</button>
            </div>
          </div>
          <div class="auth-field">
            <label class="auth-label">Nueva contraseña</label>
            <div class="auth-input-wrap">
              <input type="password" id="auth-pw" class="auth-input"
                placeholder="Mínimo 6 caracteres" autocomplete="new-password" />
              <button type="button" class="auth-eye" id="auth-eye">${Auth._eyeIcon(false)}</button>
            </div>
          </div>
          <div class="auth-field">
            <label class="auth-label">Confirmar nueva contraseña</label>
            <div class="auth-input-wrap">
              <input type="password" id="auth-pw2" class="auth-input"
                placeholder="Repite la contraseña" autocomplete="new-password" />
              <button type="button" class="auth-eye" id="auth-eye2">${Auth._eyeIcon(false)}</button>
            </div>
          </div>
          ${durationSelect}
          <div class="auth-error" id="auth-error"></div>
          <button class="auth-btn" id="auth-submit">Renovar contraseña</button>
        </div>`;
    }

    document.body.appendChild(el);
    Auth._bindOverlayEvents(mode);
  },

  _eyeIcon(visible) {
    return visible
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
           <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
           <line x1="1" y1="1" x2="23" y2="23"/>
         </svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
           <circle cx="12" cy="12" r="3"/>
         </svg>`;
  },

  _bindEye(btnId, inputId) {
    const btn = document.getElementById(btnId);
    const inp = document.getElementById(inputId);
    if (!btn || !inp) return;
    let visible = false;
    btn.addEventListener('click', () => {
      visible = !visible;
      inp.type      = visible ? 'text' : 'password';
      btn.innerHTML = Auth._eyeIcon(visible);
    });
  },

  _showError(msg) {
    const el = document.getElementById('auth-error');
    if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
  },

  _bindOverlayEvents(mode) {
    Auth._bindEye('auth-eye',     'auth-pw');
    Auth._bindEye('auth-eye2',    'auth-pw2');
    Auth._bindEye('auth-eye-old', 'auth-old-pw');

    const submit = document.getElementById('auth-submit');
    if (!submit) return;

    document.getElementById('auth-overlay').querySelectorAll('.auth-input').forEach(inp => {
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit.click(); });
    });

    if (mode === 'lock') {
      submit.addEventListener('click', async () => {
        const pw  = document.getElementById('auth-pw')?.value || '';
        const rem = document.getElementById('auth-remember')?.checked;
        Auth._showError('');
        submit.disabled     = true;
        submit.textContent  = 'Verificando…';

        const ok = await Auth.verify(pw);
        if (!ok) {
          Auth._showError('Contraseña incorrecta. Intenta de nuevo.');
          submit.disabled    = false;
          submit.textContent = 'Entrar';
          document.getElementById('auth-pw').value = '';
          document.getElementById('auth-pw').focus();
          return;
        }
        if (rem) await Auth.createSession();
        Auth._unlock();
      });
    }

    if (mode === 'setup') {
      submit.addEventListener('click', async () => {
        const pw  = document.getElementById('auth-pw')?.value  || '';
        const pw2 = document.getElementById('auth-pw2')?.value || '';
        const dur = parseInt(document.getElementById('auth-duration')?.value || '30', 10);
        Auth._showError('');

        if (pw.length < 6) { Auth._showError('La contraseña debe tener al menos 6 caracteres.'); return; }
        if (pw !== pw2)    { Auth._showError('Las contraseñas no coinciden.'); return; }

        submit.disabled    = true;
        submit.textContent = 'Guardando…';
        await Auth.setPassword(pw, dur);
        Auth._unlock();
      });
    }

    if (mode === 'expired') {
      submit.addEventListener('click', async () => {
        const oldPw = document.getElementById('auth-old-pw')?.value || '';
        const pw    = document.getElementById('auth-pw')?.value     || '';
        const pw2   = document.getElementById('auth-pw2')?.value    || '';
        const dur   = parseInt(document.getElementById('auth-duration')?.value || '30', 10);
        Auth._showError('');
        submit.disabled    = true;
        submit.textContent = 'Verificando…';

        const oldOk = await Auth.verify(oldPw);
        if (!oldOk) {
          Auth._showError('La contraseña actual es incorrecta.');
          submit.disabled    = false;
          submit.textContent = 'Renovar contraseña';
          return;
        }
        if (pw.length < 6) { Auth._showError('La nueva contraseña debe tener al menos 6 caracteres.'); submit.disabled = false; submit.textContent = 'Renovar contraseña'; return; }
        if (pw !== pw2)    { Auth._showError('Las contraseñas no coinciden.'); submit.disabled = false; submit.textContent = 'Renovar contraseña'; return; }

        await Auth.setPassword(pw, dur);
        Auth._unlock();
      });
    }
  },

  /* ---- Panel de ajustes integrado ---- */
  async renderSettingsPanel() {
    const cfg       = await Auth._loadCfg();
    const configured = !!cfg?.hash;
    const d          = await Auth.expiresInDays();
    const daysLabel  = configured
      ? (d === Infinity ? '—' : (d <= 0 ? 'Vencida' : `${d} día${d !== 1 ? 's' : ''} restantes`))
      : '—';
    const warn       = configured && d <= 7 && d > 0;
    const expiresDate = cfg?.expiresAt
      ? new Date(cfg.expiresAt).toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—';

    return `
      <div class="auth-settings-panel" id="auth-settings-panel">
        <div class="auth-settings-row">
          <div>
            <div class="auth-settings-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              Contraseña de acceso
            </div>
            <div class="auth-settings-meta">
              ${configured
                ? `Activa · Vence el <strong>${expiresDate}</strong> · <span class="${warn ? 'auth-warn-text' : ''}">${daysLabel}</span>`
                : 'Sin contraseña configurada'}
            </div>
          </div>
          <button class="auth-settings-btn" id="auth-settings-change">
            ${configured ? 'Cambiar' : 'Crear'}
          </button>
        </div>
        ${configured ? `
        <div class="auth-settings-row" style="padding-top:.5rem;border-top:1px solid var(--border)">
          <span class="auth-settings-meta">Cerrar sesión en este dispositivo</span>
          <button class="auth-settings-btn danger" id="auth-settings-logout">Cerrar sesión</button>
        </div>
        <div class="auth-settings-row" style="padding-top:.5rem;border-top:1px solid var(--border)">
          <span class="auth-settings-meta">Eliminar contraseña de todos los dispositivos</span>
          <button class="auth-settings-btn danger" id="auth-settings-remove">Eliminar</button>
        </div>` : ''}
      </div>`;
  },

  bindSettingsEvents() {
    document.getElementById('auth-settings-change')?.addEventListener('click', () => {
      Auth._showChangeModal();
    });
    document.getElementById('auth-settings-logout')?.addEventListener('click', () => {
      if (confirm('¿Cerrar sesión en este dispositivo?')) Auth.logout();
    });
    document.getElementById('auth-settings-remove')?.addEventListener('click', async () => {
      if (confirm('¿Eliminar la contraseña? Cualquiera con la URL podrá acceder.')) {
        await Auth.removePassword();
        const panel = document.getElementById('auth-settings-panel');
        if (panel) {
          panel.outerHTML = await Auth.renderSettingsPanel();
          Auth.bindSettingsEvents();
        }
      }
    });
  },

  _showChangeModal() {
    const modal   = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    if (!modal || !content) return;

    Auth.isConfigured().then(configured => {
      Auth.getDurationDays().then(currentDur => {
        const DURATION_OPTIONS = [15, 30, 60, 90, 180];
        content.innerHTML = `
          <div class="modal-header">
            <h3>${configured ? 'Cambiar contraseña' : 'Crear contraseña'}</h3>
            <button class="icon-btn" id="modal-close-auth">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          ${configured ? `
          <div class="field" style="margin-bottom:1rem">
            <label class="auth-label">Contraseña actual</label>
            <div class="auth-input-wrap">
              <input type="password" id="modal-old-pw" class="auth-input" placeholder="••••••••" />
              <button type="button" class="auth-eye" id="modal-eye-old">${Auth._eyeIcon(false)}</button>
            </div>
          </div>` : ''}
          <div class="field" style="margin-bottom:1rem">
            <label class="auth-label">Nueva contraseña</label>
            <div class="auth-input-wrap">
              <input type="password" id="modal-new-pw" class="auth-input" placeholder="Mínimo 6 caracteres" />
              <button type="button" class="auth-eye" id="modal-eye-new">${Auth._eyeIcon(false)}</button>
            </div>
          </div>
          <div class="field" style="margin-bottom:1rem">
            <label class="auth-label">Confirmar nueva contraseña</label>
            <div class="auth-input-wrap">
              <input type="password" id="modal-new-pw2" class="auth-input" placeholder="Repite la contraseña" />
              <button type="button" class="auth-eye" id="modal-eye-new2">${Auth._eyeIcon(false)}</button>
            </div>
          </div>
          <div class="field" style="margin-bottom:1.25rem">
            <label class="auth-label">Vigencia</label>
            <select class="auth-select" id="modal-duration">
              ${DURATION_OPTIONS.map(v => {
                const labels = { 15:'15 días', 30:'30 días', 60:'2 meses', 90:'3 meses', 180:'6 meses' };
                return `<option value="${v}" ${v === currentDur ? 'selected' : ''}>${labels[v]}</option>`;
              }).join('')}
            </select>
          </div>
          <div class="auth-error" id="modal-auth-error"></div>
          <div style="display:flex;gap:.75rem">
            <button class="btn-ghost" id="modal-cancel-auth">Cancelar</button>
            <button class="btn-primary" id="modal-save-auth" style="flex:1">Guardar contraseña</button>
          </div>`;

        modal.style.display = 'flex';

        Auth._bindEye('modal-eye-old',  'modal-old-pw');
        Auth._bindEye('modal-eye-new',  'modal-new-pw');
        Auth._bindEye('modal-eye-new2', 'modal-new-pw2');

        const closeModal = () => { modal.style.display = 'none'; };
        document.getElementById('modal-close-auth')?.addEventListener('click', closeModal);
        document.getElementById('modal-cancel-auth')?.addEventListener('click', closeModal);

        document.getElementById('modal-save-auth')?.addEventListener('click', async () => {
          const oldPw = document.getElementById('modal-old-pw')?.value || '';
          const pw    = document.getElementById('modal-new-pw')?.value || '';
          const pw2   = document.getElementById('modal-new-pw2')?.value || '';
          const dur   = parseInt(document.getElementById('modal-duration')?.value || '30', 10);
          const errEl = document.getElementById('modal-auth-error');
          if (errEl) errEl.textContent = '';

          if (configured) {
            const oldOk = await Auth.verify(oldPw);
            if (!oldOk) { if (errEl) { errEl.textContent = 'La contraseña actual es incorrecta.'; errEl.style.display = 'block'; } return; }
          }
          if (pw.length < 6) { if (errEl) { errEl.textContent = 'Mínimo 6 caracteres.'; errEl.style.display = 'block'; } return; }
          if (pw !== pw2)    { if (errEl) { errEl.textContent = 'Las contraseñas no coinciden.'; errEl.style.display = 'block'; } return; }

          await Auth.setPassword(pw, dur);
          closeModal();
          if (window.toast) toast('🔒 Contraseña actualizada');

          // Re-renderizar panel de ajustes si existe
          const panel = document.getElementById('auth-settings-panel');
          if (panel) {
            panel.outerHTML = await Auth.renderSettingsPanel();
            Auth.bindSettingsEvents();
          }
        });
      });
    });
  }
};

window.Auth = Auth;
