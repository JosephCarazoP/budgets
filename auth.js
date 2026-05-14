'use strict';

/* ============================================================
   BUDGETFLOW — AUTH MODULE
   Sistema de contraseña con "Recordarme" por dispositivo,
   vigencia configurable y aviso 7 días antes del vencimiento.
   
   Seguridad:
   - La contraseña se hashea con SHA-256 (Web Crypto API).
   - El token de sesión se almacena en localStorage con expiración.
   - Nunca se guarda la contraseña en texto plano.
   ============================================================ */

const AUTH_KEY    = 'bf_auth_cfg';   // Configuración global (hash, expiración, duración)
const SESSION_KEY = 'bf_auth_ses';   // Token de sesión de este dispositivo

/* ---- Helpers ---- */
async function sha256(text) {
  const buf    = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function now() { return Date.now(); }
function daysMs(d) { return d * 86_400_000; }

/* ---- Storage ---- */
function getAuthCfg() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch { return null; }
}
function setAuthCfg(cfg) { localStorage.setItem(AUTH_KEY, JSON.stringify(cfg)); }

function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
}
function setSession(token, expiresAt) { localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt })); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

/* ---- Public API ---- */
const Auth = {

  /** ¿Hay contraseña configurada? */
  isConfigured() { return !!getAuthCfg()?.hash; },

  /** ¿La sesión actual es válida (Recordarme)? */
  async isSessionValid() {
    const cfg = getAuthCfg();
    if (!cfg?.hash) return true;           // Sin contraseña → acceso libre
    const ses = getSession();
    if (!ses) return false;
    if (now() > ses.expiresAt) { clearSession(); return false; }
    // Verificar que el token coincide
    const expected = await sha256(cfg.hash + cfg.createdAt);
    return ses.token === expected;
  },

  /** Verifica la contraseña ingresada. Retorna true/false. */
  async verify(plain) {
    const cfg = getAuthCfg();
    if (!cfg?.hash) return true;
    return (await sha256(plain)) === cfg.hash;
  },

  /** Crea sesión recordada en este dispositivo. */
  async createSession() {
    const cfg = getAuthCfg();
    if (!cfg) return;
    const token     = await sha256(cfg.hash + cfg.createdAt);
    const expiresAt = cfg.expiresAt;        // La sesión dura hasta que vence la contraseña
    setSession(token, expiresAt);
  },

  /** Cierra sesión en este dispositivo. */
  logout() { clearSession(); Auth.showLock(); },

  /** Configura (o cambia) la contraseña. durationDays: 15|30|60|90|180 */
  async setPassword(plain, durationDays) {
    const hash      = await sha256(plain);
    const createdAt = now();
    const expiresAt = createdAt + daysMs(durationDays);
    setAuthCfg({ hash, createdAt, expiresAt, durationDays });
    clearSession();          // Forzar re-login en todos los dispositivos
  },

  /** Elimina la contraseña por completo. */
  removePassword() {
    localStorage.removeItem(AUTH_KEY);
    clearSession();
  },

  /* ---- Estado de vigencia ---- */
  expiresInDays() {
    const cfg = getAuthCfg();
    if (!cfg?.expiresAt) return Infinity;
    return Math.ceil((cfg.expiresAt - now()) / daysMs(1));
  },

  isExpired() {
    const cfg = getAuthCfg();
    if (!cfg?.expiresAt) return false;
    return now() > cfg.expiresAt;
  },

  needsRenewalWarning() {
    const d = Auth.expiresInDays();
    return d >= 0 && d <= 7;
  },

  getDurationDays() {
    return getAuthCfg()?.durationDays || 30;
  },

  /* ================================================================
     UI
     ================================================================ */

  /** Punto de entrada principal. Llama esto antes de mostrar la app. */
  async init(onUnlocked) {
    Auth._onUnlocked = onUnlocked;

    if (!Auth.isConfigured()) {
      // Primera vez: mostrar pantalla de creación de contraseña
      Auth._showSetup();
      return;
    }

    if (Auth.isExpired()) {
      Auth._showExpired();
      return;
    }

    const valid = await Auth.isSessionValid();
    if (valid) {
      Auth._unlock();
      return;
    }

    Auth.showLock();
  },

  showLock() { Auth._renderOverlay('lock'); },

  _unlock() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) {
      overlay.classList.add('auth-fade-out');
      setTimeout(() => overlay.remove(), 320);
    }
    if (Auth._onUnlocked) Auth._onUnlocked();
    // Aviso de vencimiento próximo
    if (Auth.needsRenewalWarning()) {
      const d = Auth.expiresInDays();
      setTimeout(() => {
        if (window.toast) toast(`⚠️ Tu contraseña vence en ${d} día${d !== 1 ? 's' : ''}. Cámbiala en Ajustes.`, 5000);
      }, 1200);
    }
  },

  _showSetup() { Auth._renderOverlay('setup'); },
  _showExpired() { Auth._renderOverlay('expired'); },

  /* ---- Overlay renderer ---- */
  _renderOverlay(mode) {
    // Quitar overlay previo si existe
    document.getElementById('auth-overlay')?.remove();

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    const el   = document.createElement('div');
    el.id      = 'auth-overlay';
    el.className = 'auth-overlay';

    const DURATION_OPTIONS = [
      { value: 15,  label: '15 días'  },
      { value: 30,  label: '30 días'  },
      { value: 60,  label: '2 meses'  },
      { value: 90,  label: '3 meses'  },
      { value: 180, label: '6 meses'  },
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
      inp.type  = visible ? 'text' : 'password';
      btn.innerHTML = Auth._eyeIcon(visible);
    });
  },

  _showError(msg) {
    const el = document.getElementById('auth-error');
    if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
  },

  _bindOverlayEvents(mode) {
    Auth._bindEye('auth-eye',  'auth-pw');
    Auth._bindEye('auth-eye2', 'auth-pw2');
    Auth._bindEye('auth-eye-old', 'auth-old-pw');

    const submit = document.getElementById('auth-submit');
    if (!submit) return;

    // Enter en inputs
    document.getElementById('auth-overlay').querySelectorAll('.auth-input').forEach(inp => {
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit.click(); });
    });

    if (mode === 'lock') {
      submit.addEventListener('click', async () => {
        const pw  = document.getElementById('auth-pw')?.value || '';
        const rem = document.getElementById('auth-remember')?.checked;
        Auth._showError('');
        submit.disabled = true;
        submit.textContent = 'Verificando…';

        const ok = await Auth.verify(pw);
        if (!ok) {
          Auth._showError('Contraseña incorrecta. Intenta de nuevo.');
          submit.disabled = false;
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

        submit.disabled = true;
        submit.textContent = 'Guardando…';
        await Auth.setPassword(pw, dur);
        Auth._unlock();
      });
    }

    if (mode === 'expired') {
      submit.addEventListener('click', async () => {
        const oldPw = document.getElementById('auth-old-pw')?.value || '';
        const pw    = document.getElementById('auth-pw')?.value  || '';
        const pw2   = document.getElementById('auth-pw2')?.value || '';
        const dur   = parseInt(document.getElementById('auth-duration')?.value || '30', 10);
        Auth._showError('');

        submit.disabled = true;
        submit.textContent = 'Verificando…';

        const oldOk = await Auth.verify(oldPw);
        if (!oldOk) {
          Auth._showError('La contraseña actual es incorrecta.');
          submit.disabled = false;
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
  /** Devuelve HTML para un bloque de "Seguridad" que puede insertarse en ajustes/settings. */
  renderSettingsPanel() {
    const configured = Auth.isConfigured();
    const d = Auth.expiresInDays();
    const daysLabel = configured
      ? (d === Infinity ? '—' : (d <= 0 ? 'Vencida' : `${d} día${d !== 1 ? 's' : ''} restantes`))
      : '—';
    const warn = configured && d <= 7 && d > 0;
    const cfg  = getAuthCfg();
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
    document.getElementById('auth-settings-remove')?.addEventListener('click', () => {
      if (confirm('¿Eliminar la contraseña? Cualquiera con la URL podrá acceder.')) {
        Auth.removePassword();
        // Re-renderizar panel
        const panel = document.getElementById('auth-settings-panel');
        if (panel) panel.outerHTML = Auth.renderSettingsPanel();
        Auth.bindSettingsEvents();
      }
    });
  },

  _showChangeModal() {
    const modal = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    if (!modal || !content) return;

    const DURATION_OPTIONS = [15, 30, 60, 90, 180];
    const currentDur = Auth.getDurationDays();

    content.innerHTML = `
      <div class="modal-header">
        <h3>${Auth.isConfigured() ? 'Cambiar contraseña' : 'Crear contraseña'}</h3>
        <button class="icon-btn" id="modal-close-auth">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      ${Auth.isConfigured() ? `
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

      if (Auth.isConfigured()) {
        const oldOk = await Auth.verify(oldPw);
        if (!oldOk) { if (errEl) errEl.textContent = 'La contraseña actual es incorrecta.'; return; }
      }
      if (pw.length < 6) { if (errEl) errEl.textContent = 'Mínimo 6 caracteres.'; return; }
      if (pw !== pw2)    { if (errEl) errEl.textContent = 'Las contraseñas no coinciden.'; return; }

      await Auth.setPassword(pw, dur);
      closeModal();
      toast('🔒 Contraseña actualizada');
      // Re-renderizar panel de ajustes si existe
      const panel = document.getElementById('auth-settings-panel');
      if (panel) {
        panel.outerHTML = Auth.renderSettingsPanel();
        Auth.bindSettingsEvents();
      }
    });
  }
};

window.Auth = Auth;
