'use strict';

/* ============================================================
   BUDGETFLOW — ADVANCED AUTH & SECURITY MODULE
   
   Mejoras de Seguridad Implementadas:
   1. Criptografía Robusta:
      - Derivación PBKDF2 con 100,000 iteraciones (SHA-256) y salt
        aleatorio de 16 bytes mediante Web Crypto API.
      - NUNCA se almacena la contraseña en texto plano ni con
        SHA-256 simple sin sal.
      - Migración transparente y automática de hashes antiguos.
   2. Protección contra Fuerza Bruta:
      - Rate limiting progresivo tras 3 intentos.
      - Bloqueo temporal estricto (Lockout de 60s) tras 5 intentos
        con temporizador en pantalla persistente entre recargas.
   3. Tokens de Sesión Inviolables:
      - Generación de secreto local único por dispositivo (CSPRNG).
      - El token no puede ser forjado por quien lea la base de datos.
   4. Temporizador de Auto-bloqueo por Inactividad:
      - Monitoreo global de actividad de usuario (mouse, teclado, touch).
      - Bloqueo automático configurable (5m, 15m, 30m, 1h o off).
   ============================================================ */

const SESSION_KEY       = 'bf_auth_ses';
const DEVICE_SEC_KEY    = 'bf_dev_sec';
const AUTOLOCK_KEY      = 'bf_autolock_min';
const LOCKOUT_KEY       = 'bf_lockout_until';
const FAILS_KEY         = 'bf_fail_attempts';

/* ---- Crypto Helpers ---- */

function now()      { return Date.now(); }
function daysMs(d)  { return d * 86_400_000; }

/** Genera un Salt aleatorio en formato hexadecimal (16 bytes = 32 caracteres hex) */
function generateSalt() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 plano (mantenido solo para compatibilidad y migración) */
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Derivación de clave mediante PBKDF2 nativo de Web Crypto API.
 * 100,000 iteraciones de SHA-256 con salt criptográfico.
 */
async function pbkdf2(password, saltHex, iterations = 100000) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const saltBytes = new Uint8Array(saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Obtiene o genera un secreto criptográfico exclusivo de este dispositivo */
function getDeviceSecret() {
  let s = localStorage.getItem(DEVICE_SEC_KEY);
  if (!s) {
    const buf = new Uint8Array(24);
    crypto.getRandomValues(buf);
    s = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(DEVICE_SEC_KEY, s);
  }
  return s;
}

/** Espera hasta que window.db y window.STATE_ROW_ID estén listos */
async function waitForDb(maxMs = 4000, intervalMs = 80) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (window.db && window.STATE_ROW_ID) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return !!(window.db && window.STATE_ROW_ID);
}

/* ---- Supabase Storage for auth_cfg ---- */

async function _getAuthCfg() {
  await waitForDb();
  if (!window.db || !window.STATE_ROW_ID) return null;
  try {
    const { data, error } = await window.db
      .from('budget_state')
      .select('data, auth_cfg')
      .eq('id', window.STATE_ROW_ID)
      .single();
    if (error || !data) return null;

    if (data.auth_cfg?.hash) return data.auth_cfg;

    const legacy = data?.data?._authCfg;
    if (legacy?.hash) {
      _setAuthCfgDirect(legacy).catch(() => {});
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

async function _setAuthCfgDirect(cfg) {
  if (!window.db || !window.STATE_ROW_ID) return;
  try {
    await window.db
      .from('budget_state')
      .update({ auth_cfg: cfg })
      .eq('id', window.STATE_ROW_ID);
  } catch { /* ignorar */ }
}

async function _setAuthCfg(cfg) {
  await waitForDb();
  if (!window.db || !window.STATE_ROW_ID) return;

  await _setAuthCfgDirect(cfg);

  try {
    const { data } = await window.db
      .from('budget_state')
      .select('data')
      .eq('id', window.STATE_ROW_ID)
      .single();
    if (!data?.data) return;
    const merged = { ...data.data };
    if (cfg) merged._authCfg = cfg;
    else delete merged._authCfg;
    await window.db
      .from('budget_state')
      .update({ data: merged })
      .eq('id', window.STATE_ROW_ID);
  } catch { /* no bloquear */ }
}

/* ---- Sesión local segura ---- */
function getSession()                 { try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; } }
function setSession(token, expiresAt) { localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt })); }
function clearSession()               { localStorage.removeItem(SESSION_KEY); }

/* ---- Rate Limiting y Protección de Fuerza Bruta ---- */
function getLockoutRemainingSec() {
  const until = parseInt(sessionStorage.getItem(LOCKOUT_KEY) || '0', 10);
  const diff = until - now();
  return diff > 0 ? Math.ceil(diff / 1000) : 0;
}

function recordFailedAttempt() {
  let fails = parseInt(sessionStorage.getItem(FAILS_KEY) || '0', 10) + 1;
  sessionStorage.setItem(FAILS_KEY, fails);
  if (fails >= 5) {
    sessionStorage.setItem(LOCKOUT_KEY, now() + 60000); // 60 segundos de bloqueo
  }
  return fails;
}

function resetFailedAttempts() {
  sessionStorage.removeItem(FAILS_KEY);
  sessionStorage.removeItem(LOCKOUT_KEY);
}

/* ============================================================
   PUBLIC AUTH API
   ============================================================ */

const Auth = {
  _cfg: undefined,
  _onUnlocked: null,
  _lastActivity: now(),
  _inactivityTimer: null,
  _isLocked: false,

  async _loadCfg() {
    if (Auth._cfg !== undefined) return Auth._cfg;
    Auth._cfg = await _getAuthCfg();
    return Auth._cfg;
  },

  _invalidateCfg() {
    Auth._cfg = undefined;
  },

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

  /* ---- Temporizador de Auto-bloqueo por Inactividad ---- */

  getAutoLockMinutes() {
    const v = localStorage.getItem(AUTOLOCK_KEY);
    return v !== null ? parseInt(v, 10) : 15; // 15 minutos por defecto
  },

  setAutoLockMinutes(minutes) {
    localStorage.setItem(AUTOLOCK_KEY, minutes);
    Auth.recordActivity();
  },

  recordActivity() {
    Auth._lastActivity = now();
  },

  _initInactivityTracker() {
    if (Auth._inactivityTimer) clearInterval(Auth._inactivityTimer);

    // Eventos que indican actividad real del usuario
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    let lastDebounce = 0;
    const onUserAction = () => {
      const t = now();
      if (t - lastDebounce > 3000) {
        lastDebounce = t;
        Auth.recordActivity();
      }
    };

    events.forEach(evt => window.addEventListener(evt, onUserAction, { passive: true }));

    // Al volver a la pestaña tras estar en segundo plano
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        Auth._checkInactivity();
      }
    });

    // Verificación periódica cada 10 segundos
    Auth._inactivityTimer = setInterval(() => {
      Auth._checkInactivity();
    }, 10000);
  },

  _checkInactivity() {
    if (Auth._isLocked) return;
    const mins = Auth.getAutoLockMinutes();
    if (mins <= 0) return; // 0 = desactivado

    const elapsedMs = now() - Auth._lastActivity;
    if (elapsedMs >= mins * 60 * 1000) {
      Auth.lockByInactivity();
    }
  },

  lockByInactivity() {
    if (Auth._isLocked) return;
    Auth.isConfigured().then(configured => {
      if (!configured) return;
      Auth._isLocked = true;
      Auth._renderOverlay('lock_inactivity');
    });
  },

  /* ---- Sesión ---- */

  /** Valida si el token local corresponde a la contraseña y no ha expirado */
  async isSessionValid() {
    const cfg = await Auth._loadCfg();
    if (!cfg?.hash) return true; // Sin contraseña activa
    const ses = getSession();
    if (!ses) return false;
    if (now() > ses.expiresAt) {
      clearSession();
      return false;
    }

    // Token seguro vinculado al secreto de dispositivo + hash actual
    const devSec = getDeviceSecret();
    const expected = await pbkdf2(cfg.hash + cfg.createdAt, devSec, 500);
    return ses.token === expected;
  },

  /** Guarda sesión local firmada */
  async createSession() {
    const cfg = await Auth._loadCfg();
    if (!cfg) return;
    const devSec = getDeviceSecret();
    const token = await pbkdf2(cfg.hash + cfg.createdAt, devSec, 500);
    setSession(token, cfg.expiresAt);
  },

  /**
   * Verifica la contraseña y migra hashes débiles automáticamente a PBKDF2 con Salt
   */
  async verify(plain) {
    const cfg = await Auth._loadCfg();
    if (!cfg?.hash) return true;

    // Caso 1: Esquema moderno PBKDF2 con Salt
    if (cfg.salt) {
      const computed = await pbkdf2(plain, cfg.salt, cfg.iterations || 100000);
      return computed === cfg.hash;
    }

    // Caso 2: Esquema legacy SHA-256 plano -> migrar al validar
    const legacy = await sha256(plain);
    if (legacy === cfg.hash) {
      try {
        const newSalt = generateSalt();
        const newHash = await pbkdf2(plain, newSalt, 100000);
        const upgraded = {
          ...cfg,
          hash: newHash,
          salt: newSalt,
          iterations: 100000,
          upgradedAt: now()
        };
        await _setAuthCfg(upgraded);
        Auth._cfg = upgraded;
      } catch (e) {
        console.warn('No se pudo auto-migrar a PBKDF2:', e);
      }
      return true;
    }

    return false;
  },

  /** Establece una nueva contraseña con Salt y PBKDF2 */
  async setPassword(plain, durationDays) {
    const salt = generateSalt();
    const hash = await pbkdf2(plain, salt, 100000);
    const createdAt = now();
    const expiresAt = createdAt + daysMs(durationDays);
    const cfg = {
      hash,
      salt,
      iterations: 100000,
      createdAt,
      expiresAt,
      durationDays
    };

    await _setAuthCfg(cfg);
    Auth._cfg = cfg;
    clearSession();
    resetFailedAttempts();
  },

  async removePassword() {
    await _setAuthCfg(null);
    Auth._cfg = null;
    clearSession();
    resetFailedAttempts();
  },

  logout() {
    clearSession();
    Auth._cfg = undefined;
    Auth.showLock();
  },

  /* ================================================================
     UI
     ================================================================ */

  async init(onUnlocked) {
    Auth._onUnlocked = onUnlocked;
    Auth._initInactivityTracker();

    Auth._showLoadingOverlay();
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

  showLock() {
    Auth._isLocked = true;
    Auth._renderOverlay('lock');
  },

  _showLoadingOverlay() {
    if (document.getElementById('auth-overlay')) return;
    const el = document.createElement('div');
    el.id = 'auth-overlay';
    el.className = 'auth-overlay';
    el.innerHTML = `
      <div class="auth-card" style="align-items:center;gap:1.5rem;padding:2.5rem 2rem">
        <div class="auth-logo">
          <img src="icons/icon-192.png" width="40" height="40" alt="BudgetFlow" style="border-radius:10px;box-shadow:0 3px 10px rgba(0,0,0,0.3)" />
          <span class="auth-logo-name">BudgetFlow</span>
        </div>
        <div style="display:flex;align-items:center;gap:.6rem;color:var(--text-secondary,#71717a);font-size:.875rem">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
            style="animation:auth-spin 1s linear infinite;flex-shrink:0">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
          Conectando de forma segura…
        </div>
      </div>`;
    document.body.appendChild(el);
  },

  _removeLoadingOverlay() {
    document.getElementById('auth-overlay')?.remove();
  },

  _unlock() {
    Auth._isLocked = false;
    Auth.recordActivity();
    resetFailedAttempts();

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
            if (window.toast) toast(`⚠️ Tu contraseña vence en ${d} día${d !== 1 ? 's' : ''}. Cámbiala en Ajustes de Seguridad.`, 5000);
          }, 1200);
        });
      }
    });
  },

  _showSetup()   { Auth._isLocked = true; Auth._renderOverlay('setup');   },
  _showExpired() { Auth._isLocked = true; Auth._renderOverlay('expired'); },

  _renderOverlay(mode) {
    document.getElementById('auth-overlay')?.remove();

    const el = document.createElement('div');
    el.id = 'auth-overlay';
    el.className = 'auth-overlay';

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
        <img src="icons/icon-192.png" width="40" height="40" alt="BudgetFlow" style="border-radius:10px;box-shadow:0 3px 10px rgba(0,0,0,0.3)" />
        <span class="auth-logo-name">BudgetFlow</span>
      </div>`;

    if (mode === 'lock' || mode === 'lock_inactivity') {
      const isInactivity = mode === 'lock_inactivity';
      el.innerHTML = `
        <div class="auth-card">
          ${logo}
          <div class="auth-heading">
            <h2>${isInactivity ? 'Bloqueo por inactividad' : 'Acceso protegido'}</h2>
            <p class="auth-sub">${isInactivity ? 'La app se bloqueó tras un tiempo sin uso. Ingresa tu contraseña.' : 'Ingresa tu contraseña para continuar'}</p>
          </div>
          <div id="auth-lockout-box" class="auth-lockout-box" style="display:none"></div>
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
          ${!isInactivity ? `
          <label class="auth-remember">
            <input type="checkbox" id="auth-remember" />
            <span class="auth-checkbox-custom"></span>
            <span>Recordarme en este dispositivo</span>
          </label>` : ''}
          <div class="auth-error" id="auth-error" style="display:none"></div>
          <button class="auth-btn" id="auth-submit">Entrar</button>
        </div>`;
    }

    if (mode === 'setup') {
      el.innerHTML = `
        <div class="auth-card">
          ${logo}
          <div class="auth-heading">
            <h2>Crear contraseña</h2>
            <p class="auth-sub">Protege tu BudgetFlow con cifrado PBKDF2 y bloqueo automático.</p>
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
          <div class="auth-error" id="auth-error" style="display:none"></div>
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
            <p class="auth-sub">El período de vigencia ha concluido. Define una nueva clave para continuar.</p>
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
          <div class="auth-error" id="auth-error" style="display:none"></div>
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
      inp.type = visible ? 'text' : 'password';
      btn.innerHTML = Auth._eyeIcon(visible);
    });
  },

  _showError(msg) {
    const el = document.getElementById('auth-error');
    if (el) {
      el.textContent = msg;
      el.style.display = msg ? 'block' : 'none';
    }
  },

  _updateLockoutUI() {
    const box = document.getElementById('auth-lockout-box');
    const submit = document.getElementById('auth-submit');
    const pwInput = document.getElementById('auth-pw');
    if (!box) return;

    const remaining = getLockoutRemainingSec();
    if (remaining > 0) {
      box.style.display = 'block';
      box.innerHTML = `
        <div style="display:flex;align-items:center;gap:.5rem">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2.5">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>Acceso suspendido por demasiados intentos. Espera <strong>${remaining}s</strong></span>
        </div>`;
      if (submit) submit.disabled = true;
      if (pwInput) pwInput.disabled = true;

      setTimeout(() => Auth._updateLockoutUI(), 1000);
    } else {
      box.style.display = 'none';
      if (submit) submit.disabled = false;
      if (pwInput) {
        pwInput.disabled = false;
        pwInput.focus();
      }
    }
  },

  _bindOverlayEvents(mode) {
    Auth._bindEye('auth-eye',     'auth-pw');
    Auth._bindEye('auth-eye2',    'auth-pw2');
    Auth._bindEye('auth-eye-old', 'auth-old-pw');

    const submit = document.getElementById('auth-submit');
    if (!submit) return;

    // Verificar si hay bloqueo de fuerza bruta activo
    if (mode === 'lock' || mode === 'lock_inactivity') {
      Auth._updateLockoutUI();
    }

    document.getElementById('auth-overlay').querySelectorAll('.auth-input').forEach(inp => {
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !submit.disabled) submit.click();
      });
    });

    if (mode === 'lock' || mode === 'lock_inactivity') {
      submit.addEventListener('click', async () => {
        if (getLockoutRemainingSec() > 0) return;

        const pw = document.getElementById('auth-pw')?.value || '';
        const rem = document.getElementById('auth-remember')?.checked;
        Auth._showError('');

        submit.disabled = true;
        submit.textContent = 'Verificando con PBKDF2…';

        // Pequeño retardo defensivo si ya hubo más de 2 fallos
        const currentFails = parseInt(sessionStorage.getItem(FAILS_KEY) || '0', 10);
        if (currentFails >= 3) {
          await new Promise(r => setTimeout(r, 2000));
        }

        const ok = await Auth.verify(pw);
        if (!ok) {
          const fails = recordFailedAttempt();
          if (fails >= 5) {
            Auth._showError('Contraseña incorrecta. Has excedido los intentos permitidos.');
            Auth._updateLockoutUI();
          } else {
            const left = 5 - fails;
            Auth._showError(`Contraseña incorrecta. Te quedan ${left} intento${left !== 1 ? 's' : ''}.`);
            submit.disabled = false;
            submit.textContent = 'Entrar';
            const pwInp = document.getElementById('auth-pw');
            if (pwInp) { pwInp.value = ''; pwInp.focus(); }
          }
          return;
        }

        resetFailedAttempts();
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

        if (pw.length < 6) {
          Auth._showError('La contraseña debe tener al menos 6 caracteres.');
          return;
        }
        if (pw !== pw2) {
          Auth._showError('Las contraseñas no coinciden.');
          return;
        }

        submit.disabled = true;
        submit.textContent = 'Generando clave cifrada…';
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

        submit.disabled = true;
        submit.textContent = 'Verificando…';

        const oldOk = await Auth.verify(oldPw);
        if (!oldOk) {
          Auth._showError('La contraseña actual es incorrecta.');
          submit.disabled = false;
          submit.textContent = 'Renovar contraseña';
          return;
        }
        if (pw.length < 6) {
          Auth._showError('La nueva contraseña debe tener al menos 6 caracteres.');
          submit.disabled = false;
          submit.textContent = 'Renovar contraseña';
          return;
        }
        if (pw !== pw2) {
          Auth._showError('Las contraseñas no coinciden.');
          submit.disabled = false;
          submit.textContent = 'Renovar contraseña';
          return;
        }

        await Auth.setPassword(pw, dur);
        Auth._unlock();
      });
    }
  },

  /* ---- Panel de Seguridad Integrado ---- */

  async renderSettingsPanel() {
    const cfg = await Auth._loadCfg();
    const configured = !!cfg?.hash;
    const d = await Auth.expiresInDays();
    const daysLabel = configured
      ? (d === Infinity ? '—' : (d <= 0 ? 'Vencida' : `${d} día${d !== 1 ? 's' : ''} restantes`))
      : '—';
    const warn = configured && d <= 7 && d > 0;
    const expiresDate = cfg?.expiresAt
      ? new Date(cfg.expiresAt).toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—';

    const currentAutoLock = Auth.getAutoLockMinutes();
    const isFBConfigured = window.FBAuth && window.FBAuth.isConfigured();
    const fbUser = window.FBAuth?.currentUser;

    return `
      <div class="auth-settings-panel" id="auth-settings-panel">
        
        <!-- Hero de Seguridad -->
        <div class="auth-security-hero">
          <div class="auth-security-hero-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div>
            <div class="auth-security-hero-title">Seguridad y Cuentas</div>
            <div class="auth-security-hero-subtitle">Protección PBKDF2 con Salt aleatorio, bloqueo por inactividad y sincronización multi-cuenta con Firebase.</div>
          </div>
        </div>

        <!-- Fila: Contraseña de Acceso -->
        <div class="auth-settings-row">
          <div>
            <div class="auth-settings-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              Contraseña de acceso local
            </div>
            <div class="auth-settings-meta">
              ${configured
                ? `Cifrado PBKDF2 · Vence el <strong>${expiresDate}</strong> · <span class="${warn ? 'auth-warn-text' : ''}">${daysLabel}</span>`
                : 'Sin contraseña configurada'}
            </div>
          </div>
          <button class="auth-settings-btn" id="auth-settings-change">
            ${configured ? 'Cambiar' : 'Crear'}
          </button>
        </div>

        <!-- Fila: Tiempo de Bloqueo por Inactividad -->
        <div class="auth-settings-row">
          <div>
            <div class="auth-settings-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              Tiempo de bloqueo por inactividad
            </div>
            <div class="auth-settings-meta">
              Bloquea la aplicación automáticamente si no interactúas con ella
            </div>
          </div>
          <select class="auth-select" id="auth-autolock-select" style="max-width:130px;padding:.35rem .5rem">
            <option value="5"  ${currentAutoLock === 5 ? 'selected' : ''}>5 minutos</option>
            <option value="15" ${currentAutoLock === 15 ? 'selected' : ''}>15 minutos</option>
            <option value="30" ${currentAutoLock === 30 ? 'selected' : ''}>30 minutos</option>
            <option value="60" ${currentAutoLock === 60 ? 'selected' : ''}>1 hora</option>
            <option value="0"  ${currentAutoLock === 0 ? 'selected' : ''}>Desactivado</option>
          </select>
        </div>

        <!-- Fila: Cuentas Multi-Usuario con Firebase -->
        <div class="auth-settings-row">
          <div>
            <div class="auth-settings-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              Cuentas en la nube (Firebase Firestore)
            </div>
            <div class="auth-settings-meta">
              ${isFBConfigured
                ? (fbUser ? `Conectado como <strong>${fbUser.email || fbUser.displayName || 'Usuario'}</strong>` : 'Conectado a Firestore · Sin sesión activa')
                : 'Conexión lista · Pega las credenciales de Firebase para habilitar cuentas'}
            </div>
          </div>
          <button class="auth-settings-btn" id="auth-settings-firebase" style="background:var(--primary);color:#fff;border-color:var(--primary)">
            ${isFBConfigured ? (fbUser ? 'Mi Cuenta' : 'Iniciar Sesión') : 'Configurar'}
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
      const secOverlay = document.getElementById('security-modal-overlay');
      if (secOverlay) secOverlay.style.display = 'none';
      Auth._showChangeModal();
    });

    document.getElementById('auth-autolock-select')?.addEventListener('change', (e) => {
      const mins = parseInt(e.target.value, 10);
      Auth.setAutoLockMinutes(mins);
      if (window.toast) toast(`⏱️ Auto-bloqueo ajustado a ${mins === 0 ? 'Desactivado' : mins + ' min'}`);
    });

    document.getElementById('auth-settings-firebase')?.addEventListener('click', () => {
      const secOverlay = document.getElementById('security-modal-overlay');
      if (secOverlay) secOverlay.style.display = 'none';
      Auth._showFirebaseModal();
    });

    document.getElementById('auth-settings-logout')?.addEventListener('click', () => {
      if (confirm('¿Cerrar sesión en este dispositivo?')) Auth.logout();
    });

    document.getElementById('auth-settings-remove')?.addEventListener('click', () => {
      Auth._showConfirmRemoveModal();
    });
  },

  /** Modal para gestionar cuenta Firebase o configurar credenciales */
  _showFirebaseModal() {
    document.getElementById('fb-modal-overlay')?.remove();

    const isConfigured = window.FBAuth && window.FBAuth.isConfigured();
    const user = window.FBAuth?.currentUser;

    const el = document.createElement('div');
    el.id = 'fb-modal-overlay';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;animation:fadeIn .15s ease';

    let contentHtml = '';

    if (!isConfigured) {
      // Formulario para pegar la configuración de Firebase Console
      const cfg = window.FBAuth?.getConfig() || {};
      contentHtml = `
        <div style="padding:1.25rem;display:flex;flex-direction:column;gap:1rem">
          <p style="font-size:.84rem;color:var(--text-2);line-height:1.5">
            Para que cada persona tenga su propia cuenta con Firebase Auth y su propio presupuesto en Cloud Firestore, pega la configuración de tu proyecto de Firebase.
          </p>
          <div class="auth-field">
            <label class="auth-label">Configuración JSON o valores:</label>
            <textarea id="fb-cfg-input" class="auth-input" rows="6" style="font-family:monospace;font-size:.78rem;line-height:1.4" placeholder='{
  "apiKey": "AIzaSy...",
  "authDomain": "tu-app.firebaseapp.com",
  "projectId": "tu-app",
  "storageBucket": "tu-app.appspot.com",
  "messagingSenderId": "...",
  "appId": "..."
}'></textarea>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem">
            <a href="FIREBASE_SETUP.md" target="_blank" style="font-size:.78rem;color:var(--primary);text-decoration:underline">Ver guía paso a paso</a>
            <div style="display:flex;gap:.5rem">
              <button id="fb-modal-close-btn" class="auth-settings-btn">Cancelar</button>
              <button id="fb-save-cfg-btn" class="auth-btn" style="width:auto;padding:.4rem .9rem">Guardar y Conectar</button>
            </div>
          </div>
        </div>`;
    } else if (user) {
      // Usuario conectado actualmente
      contentHtml = `
        <div style="padding:1.25rem;display:flex;flex-direction:column;gap:1rem">
          <div style="display:flex;align-items:center;gap:.75rem">
            <div style="width:40px;height:40px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.1rem">
              ${(user.displayName || user.email || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <div style="font-weight:600;font-size:.92rem">${user.displayName || 'Usuario Firebase'}</div>
              <div style="font-size:.78rem;color:var(--text-2)">${user.email}</div>
            </div>
          </div>
          <div style="font-size:.8rem;color:var(--text-2);padding:.6rem .8rem;background:var(--bg-alt);border-radius:var(--radius);line-height:1.4">
            Tus presupuestos, categorías y gastos se sincronizan automáticamente en tu propia cuenta en Cloud Firestore.
          </div>
          <div style="display:flex;justify-content:space-between;gap:.5rem;padding-top:.5rem">
            <button id="fb-reset-cfg-btn" class="auth-settings-btn" style="color:var(--text-3)">Cambiar proyecto Firebase</button>
            <div style="display:flex;gap:.5rem">
              <button id="fb-modal-close-btn" class="auth-settings-btn">Cerrar</button>
              <button id="fb-logout-btn" class="auth-settings-btn danger">Cerrar sesión</button>
            </div>
          </div>
        </div>`;
    } else {
      // Conectado pero no autenticado: Iniciar sesión o Registrarse
      contentHtml = `
        <div style="padding:1.25rem;display:flex;flex-direction:column;gap:1rem">
          <div style="display:flex;gap:.5rem;border-bottom:1px solid var(--border);padding-bottom:.5rem">
            <button id="fb-tab-login" style="flex:1;padding:.4rem;border:none;background:transparent;font-weight:600;color:var(--text);border-bottom:2px solid var(--primary);cursor:pointer">Iniciar Sesión</button>
            <button id="fb-tab-register" style="flex:1;padding:.4rem;border:none;background:transparent;font-weight:500;color:var(--text-2);cursor:pointer">Registrarse</button>
          </div>

          <div id="fb-auth-form" style="display:flex;flex-direction:column;gap:.75rem">
            <div id="fb-name-group" class="auth-field" style="display:none">
              <label class="auth-label">Tu Nombre</label>
              <input type="text" id="fb-name" class="auth-input" placeholder="Ej. José Pérez" />
            </div>
            <div class="auth-field">
              <label class="auth-label">Correo Electrónico</label>
              <input type="email" id="fb-email" class="auth-input" placeholder="nombre@correo.com" />
            </div>
            <div class="auth-field">
              <label class="auth-label">Contraseña</label>
              <input type="password" id="fb-pw" class="auth-input" placeholder="••••••••" />
            </div>
            <div class="auth-error" id="fb-error" style="display:none"></div>
            <button class="auth-btn" id="fb-submit-btn">Entrar con Correo</button>
            
            <div style="display:flex;align-items:center;gap:.5rem;margin:.25rem 0">
              <div style="flex:1;height:1px;background:var(--border)"></div>
              <span style="font-size:.75rem;color:var(--text-3)">o</span>
              <div style="flex:1;height:1px;background:var(--border)"></div>
            </div>

            <button type="button" id="fb-google-btn" class="auth-settings-btn" style="display:flex;align-items:center;justify-content:center;gap:.5rem;padding:.55rem;font-weight:600">
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.35 24 12 24z"/>
                <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
              </svg>
              Continuar con Google
            </button>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:.5rem;padding-top:.5rem">
            <button id="fb-modal-close-btn" class="auth-settings-btn">Cerrar</button>
          </div>
        </div>`;
    }

    el.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);width:100%;max-width:420px;box-shadow:var(--shadow-md);overflow:hidden">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:.5rem">
            <img src="icons/icon-192.png" width="22" height="22" alt="BudgetFlow" style="border-radius:5px" />
            <h3 style="margin:0;font-size:1rem;font-weight:600">Firebase Multi-Usuario</h3>
          </div>
          <button id="fb-modal-x-btn" style="background:transparent;border:none;color:var(--text-2);cursor:pointer">✕</button>
        </div>
        ${contentHtml}
      </div>`;

    document.body.appendChild(el);

    const close = () => el.remove();
    document.getElementById('fb-modal-x-btn')?.addEventListener('click', close);
    document.getElementById('fb-modal-close-btn')?.addEventListener('click', close);

    // Guardar configuración
    document.getElementById('fb-save-cfg-btn')?.addEventListener('click', () => {
      const txt = document.getElementById('fb-cfg-input')?.value.trim();
      if (!txt) return;
      try {
        let parsed = null;
        if (txt.startsWith('{')) {
          parsed = JSON.parse(txt);
        } else {
          // Extraer variables si se pegó código JS
          const matchApiKey = txt.match(/apiKey:\s*["']([^"']+)["']/);
          const matchProjectId = txt.match(/projectId:\s*["']([^"']+)["']/);
          if (matchApiKey && matchProjectId) {
            parsed = {
              apiKey: matchApiKey[1],
              projectId: matchProjectId[1],
              authDomain: (txt.match(/authDomain:\s*["']([^"']+)["']/) || [])[1] || `${matchProjectId[1]}.firebaseapp.com`,
              storageBucket: (txt.match(/storageBucket:\s*["']([^"']+)["']/) || [])[1] || '',
              messagingSenderId: (txt.match(/messagingSenderId:\s*["']([^"']+)["']/) || [])[1] || '',
              appId: (txt.match(/appId:\s*["']([^"']+)["']/) || [])[1] || ''
            };
          }
        }
        if (!parsed || !parsed.apiKey || !parsed.projectId) {
          alert('Configuración inválida. Asegúrate de incluir al menos apiKey y projectId.');
          return;
        }
        window.FBAuth.saveConfig(parsed);
      } catch (err) {
        alert('Error analizando la configuración: ' + err.message);
      }
    });

    document.getElementById('fb-reset-cfg-btn')?.addEventListener('click', () => {
      if (confirm('¿Restablecer configuración de Firebase?')) {
        window.FBAuth.resetConfig();
      }
    });

    document.getElementById('fb-logout-btn')?.addEventListener('click', async () => {
      await window.FBAuth.logout();
      close();
      if (window.toast) toast('Sesión de Firebase cerrada');
      window.location.reload();
    });

    // Login/Register tabs
    let isRegisterMode = false;
    const tabLogin = document.getElementById('fb-tab-login');
    const tabReg = document.getElementById('fb-tab-register');
    const nameGrp = document.getElementById('fb-name-group');
    const submitBtn = document.getElementById('fb-submit-btn');
    const errBox = document.getElementById('fb-error');

    tabLogin?.addEventListener('click', () => {
      isRegisterMode = false;
      tabLogin.style.borderBottom = '2px solid var(--primary)';
      tabLogin.style.color = 'var(--text)';
      tabReg.style.borderBottom = 'none';
      tabReg.style.color = 'var(--text-2)';
      if (nameGrp) nameGrp.style.display = 'none';
      if (submitBtn) submitBtn.textContent = 'Entrar con Correo';
      if (errBox) errBox.style.display = 'none';
    });

    tabReg?.addEventListener('click', () => {
      isRegisterMode = true;
      tabReg.style.borderBottom = '2px solid var(--primary)';
      tabReg.style.color = 'var(--text)';
      tabLogin.style.borderBottom = 'none';
      tabLogin.style.color = 'var(--text-2)';
      if (nameGrp) nameGrp.style.display = 'block';
      if (submitBtn) submitBtn.textContent = 'Crear Cuenta';
      if (errBox) errBox.style.display = 'none';
    });

    submitBtn?.addEventListener('click', async () => {
      const email = document.getElementById('fb-email')?.value.trim();
      const pw = document.getElementById('fb-pw')?.value;
      const name = document.getElementById('fb-name')?.value.trim();

      if (!email || !pw) {
        if (errBox) { errBox.textContent = 'Ingresa correo y contraseña'; errBox.style.display = 'block'; }
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Procesando…';

      try {
        if (isRegisterMode) {
          await window.FBAuth.registerWithEmail(email, pw, name);
          if (window.toast) toast('¡Cuenta creada con éxito!');
        } else {
          await window.FBAuth.loginWithEmail(email, pw);
          if (window.toast) toast('¡Bienvenido!');
        }
        close();
        window.location.reload();
      } catch (e) {
        submitBtn.disabled = false;
        submitBtn.textContent = isRegisterMode ? 'Crear Cuenta' : 'Entrar con Correo';
        if (errBox) {
          errBox.textContent = e.message || 'Error de autenticación';
          errBox.style.display = 'block';
        }
      }
    });

    document.getElementById('fb-google-btn')?.addEventListener('click', async () => {
      try {
        await window.FBAuth.loginWithGoogle();
        close();
        if (window.toast) toast('¡Sesión con Google iniciada!');
        window.location.reload();
      } catch (e) {
        if (errBox) {
          errBox.textContent = e.message || 'Error con Google Sign-In';
          errBox.style.display = 'block';
        }
      }
    });
  },

  _showConfirmRemoveModal() {
    const secOverlay = document.getElementById('security-modal-overlay');
    if (secOverlay) secOverlay.style.display = 'none';

    const el = document.createElement('div');
    el.id = 'auth-confirm-overlay';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;animation:fadeIn .15s ease';
    el.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);width:100%;max-width:380px;padding:1.5rem;box-shadow:var(--shadow-md)">
        <div style="display:flex;align-items:flex-start;gap:.75rem;margin-bottom:1.25rem">
          <div style="flex-shrink:0;width:2.25rem;height:2.25rem;border-radius:50%;background:color-mix(in srgb,var(--danger) 12%,transparent);display:flex;align-items:center;justify-content:center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div>
            <div style="font-weight:600;font-size:.9375rem;margin-bottom:.3rem">¿Eliminar contraseña local?</div>
            <div style="font-size:.8125rem;color:var(--text-secondary);line-height:1.45">Cualquier persona con acceso a esta URL podrá abrir la interfaz sin pedir contraseña.</div>
          </div>
        </div>
        <div style="display:flex;gap:.625rem;justify-content:flex-end">
          <button id="auth-confirm-cancel" class="auth-settings-btn">Cancelar</button>
          <button id="auth-confirm-delete" class="auth-settings-btn danger" style="font-weight:600">Eliminar</button>
        </div>
      </div>`;
    document.body.appendChild(el);

    const close = () => el.remove();
    document.getElementById('auth-confirm-cancel').addEventListener('click', close);
    document.getElementById('auth-confirm-delete').addEventListener('click', async () => {
      close();
      await Auth.removePassword();
      Auth._cfg = null;
      if (window.toast) toast('🔓 Contraseña eliminada');
    });
  },

  _showChangeModal() {
    document.getElementById('auth-change-overlay')?.remove();

    Auth.isConfigured().then(configured => {
      Auth.getDurationDays().then(currentDur => {
        const DURATION_OPTIONS = [15, 30, 60, 90, 180];
        const durationLabels = { 15:'15 días', 30:'30 días', 60:'2 meses', 90:'3 meses', 180:'6 meses' };

        const el = document.createElement('div');
        el.id = 'auth-change-overlay';
        el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;animation:fadeIn .15s ease';
        el.innerHTML = `
          <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);width:100%;max-width:400px;box-shadow:var(--shadow-md);overflow:hidden">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid var(--border)">
              <h3 style="margin:0;font-size:1rem;font-weight:600">${configured ? 'Cambiar contraseña' : 'Crear contraseña'}</h3>
              <button id="auth-change-close" style="display:flex;align-items:center;justify-content:center;width:1.75rem;height:1.75rem;border-radius:var(--radius);border:1px solid var(--border);background:transparent;color:var(--text-secondary);cursor:pointer">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div style="padding:1.25rem;display:flex;flex-direction:column;gap:.875rem">
              ${configured ? `
              <div>
                <label class="auth-label" style="display:block;margin-bottom:.35rem">Contraseña actual</label>
                <div class="auth-input-wrap">
                  <input type="password" id="ach-old-pw" class="auth-input" placeholder="••••••••" autocomplete="current-password" autofocus />
                  <button type="button" class="auth-eye" id="ach-eye-old">${Auth._eyeIcon(false)}</button>
                </div>
              </div>` : ''}
              <div>
                <label class="auth-label" style="display:block;margin-bottom:.35rem">Nueva contraseña</label>
                <div class="auth-input-wrap">
                  <input type="password" id="ach-new-pw" class="auth-input" placeholder="Mínimo 6 caracteres" autocomplete="new-password" ${!configured ? 'autofocus' : ''} />
                  <button type="button" class="auth-eye" id="ach-eye-new">${Auth._eyeIcon(false)}</button>
                </div>
              </div>
              <div>
                <label class="auth-label" style="display:block;margin-bottom:.35rem">Confirmar contraseña</label>
                <div class="auth-input-wrap">
                  <input type="password" id="ach-new-pw2" class="auth-input" placeholder="Repite la contraseña" autocomplete="new-password" />
                  <button type="button" class="auth-eye" id="ach-eye-new2">${Auth._eyeIcon(false)}</button>
                </div>
              </div>
              <div>
                <label class="auth-label" style="display:block;margin-bottom:.35rem">Vigencia</label>
                <select class="auth-select" id="ach-duration">
                  ${DURATION_OPTIONS.map(v => `<option value="${v}" ${v === currentDur ? 'selected' : ''}>${durationLabels[v]}</option>`).join('')}
                </select>
              </div>
              <div class="auth-error" id="ach-error" style="display:none"></div>
              <div style="display:flex;gap:.625rem;padding-top:.125rem">
                <button id="ach-cancel" class="auth-settings-btn" style="flex-shrink:0">Cancelar</button>
                <button id="ach-save" class="auth-btn" style="flex:1">Guardar con PBKDF2</button>
              </div>
            </div>
          </div>`;

        document.body.appendChild(el);

        Auth._bindEye('ach-eye-old',  'ach-old-pw');
        Auth._bindEye('ach-eye-new',  'ach-new-pw');
        Auth._bindEye('ach-eye-new2', 'ach-new-pw2');

        const showErr = (msg) => {
          const errEl = document.getElementById('ach-error');
          if (!errEl) return;
          errEl.textContent = msg;
          errEl.style.display = msg ? 'block' : 'none';
        };

        const close = () => el.remove();
        document.getElementById('auth-change-close').addEventListener('click', close);
        document.getElementById('ach-cancel').addEventListener('click', close);

        el.querySelectorAll('.auth-input').forEach(inp => {
          inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') document.getElementById('ach-save')?.click();
          });
        });

        document.getElementById('ach-save').addEventListener('click', async () => {
          const oldPw = document.getElementById('ach-old-pw')?.value || '';
          const pw    = document.getElementById('ach-new-pw')?.value  || '';
          const pw2   = document.getElementById('ach-new-pw2')?.value || '';
          const dur   = parseInt(document.getElementById('ach-duration')?.value || '30', 10);
          showErr('');

          if (configured) {
            const oldOk = await Auth.verify(oldPw);
            if (!oldOk) {
              showErr('La contraseña actual es incorrecta.');
              return;
            }
          }
          if (pw.length < 6) {
            showErr('La contraseña debe tener al menos 6 caracteres.');
            return;
          }
          if (pw !== pw2) {
            showErr('Las contraseñas no coinciden.');
            return;
          }

          const btn = document.getElementById('ach-save');
          btn.disabled = true;
          btn.textContent = 'Guardando…';

          await Auth.setPassword(pw, dur);
          close();
          if (window.toast) toast('🔒 Contraseña actualizada');

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
