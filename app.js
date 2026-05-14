'use strict';

/* ============================================================
   SUPABASE CONFIG
   Reemplazá estos dos valores con los de tu proyecto:
   Supabase Dashboard → Settings → API
   ============================================================ */

const SUPABASE_URL = 'https://jljdudxbggewxvqmxlvj.supabase.co'; 
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
if (!state.security) {
  state.security = { passwordHash: '', trustedDevices: {}, rotationDays: 45, changedAt: null };
}


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
if (!state.security) {
  state.security = { passwordHash: '', trustedDevices: {}, rotationDays: 45, changedAt: null };
}

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


const DEVICE_KEY = localStorage.getItem('budget_device_key') || uid();
localStorage.setItem('budget_device_key', DEVICE_KEY);
/* ============================================================
SECURITY UTILITIES — Reemplaza las funciones existentes
============================================================ */

const ALLOWED_ROTATION_DAYS = [15, 30, 60, 90, 180];
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 10;

/* Contraseñas comunes que no se permiten */
const COMMON_PASSWORDS = [
  'password', 'contraseña', '12345678', '123456789', '1234567890',
  'qwerty123', 'qwertyui', 'abc12345', 'password1', 'pass1234',
  'admin123', 'letmein1', 'welcome1', 'monkey12', 'shadow12',
  'sunshine', 'princess', 'football', 'baseball', 'iloveyou',
  'trustno1', 'superman', 'batman12', 'master12', 'dragon12',
];

/* ---------- Hashing (PBKDF2 + salt) ---------- */

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password),
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 200000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateSalt() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Compatibilidad: si el hash anterior era SHA-256 simple, se migra al guardar nueva clave */
async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(raw) {
  const salt = generateSalt();
  const hash = await deriveKey(raw, salt);
  return { hash, salt };
}

async function verifyPassword(raw) {
  const sec = state.security;
  if (!sec.passwordHash) return false;
  /* Detectar si usa el formato legado (sin salt) */
  if (!sec.salt) {
    return (await sha256(raw)) === sec.passwordHash;
  }
  return (await deriveKey(raw, sec.salt)) === sec.passwordHash;
}

/* ---------- Fortaleza de contraseña ---------- */

function getPasswordScore(password) {
  let score = 0;
  if (password.length >= 8)  score++;
  if (password.length >= 12) score++;
  if (/[A-ZÁÉÍÓÚÑ]/.test(password)) score++;
  if (/[a-záéíóúñ]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-záéíóúñÁÉÍÓÚÑ0-9]/.test(password)) score++;
  /* Penalizar si es contraseña común */
  if (COMMON_PASSWORDS.some(c => password.toLowerCase().includes(c))) score = Math.min(score, 1);
  if (score <= 1) return 1;
  if (score <= 3) return 2;
  if (score <= 4) return 3;
  return 4;
}

const STRENGTH_LABELS = ['', 'Muy débil', 'Débil', 'Buena', 'Fuerte'];

function validatePasswordStrength(password) {
  if (password.length < 8) return 'Debe tener al menos 8 caracteres';
  if (!/[A-ZÁÉÍÓÚÑ]/.test(password)) return 'Incluye al menos una mayúscula';
  if (!/[a-záéíóúñ]/.test(password)) return 'Incluye al menos una minúscula';
  if (!/\d/.test(password)) return 'Incluye al menos un número';
  if (COMMON_PASSWORDS.some(c => password.toLowerCase().includes(c))) return 'Esa contraseña es demasiado común';
  return '';
}

/* ---------- Brute-force protection ---------- */

function getAttemptData() {
  try {
    return JSON.parse(localStorage.getItem('budget_auth_attempts') || '{"count":0,"lockedUntil":null}');
  } catch { return { count: 0, lockedUntil: null }; }
}

function saveAttemptData(data) {
  localStorage.setItem('budget_auth_attempts', JSON.stringify(data));
}

function recordFailedAttempt() {
  const data = getAttemptData();
  data.count = (data.count || 0) + 1;
  if (data.count >= MAX_ATTEMPTS) {
    data.lockedUntil = Date.now() + LOCKOUT_MINUTES * 60 * 1000;
    data.count = 0;
  }
  saveAttemptData(data);
  return data;
}

function clearAttempts() {
  localStorage.removeItem('budget_auth_attempts');
}

function getLockoutRemaining() {
  const data = getAttemptData();
  if (!data.lockedUntil) return 0;
  const remaining = data.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

function getRemainingAttempts() {
  const data = getAttemptData();
  return MAX_ATTEMPTS - (data.count || 0);
}

/* ---------- Trusted devices ---------- */

function trustDevice() {
  if (!state.security.trustedDevices) state.security.trustedDevices = {};
  state.security.trustedDevices[DEVICE_KEY] = new Date().toISOString();
}

function isTrustedDevice() {
  return Boolean(state.security?.trustedDevices?.[DEVICE_KEY]);
}

function untrustDevice() {
  if (!state.security?.trustedDevices) return;
  delete state.security.trustedDevices[DEVICE_KEY];
}

/* ---------- Expiry ---------- */

function isPasswordExpired() {
  if (!state.security?.passwordHash || !state.security?.changedAt) return false;
  const days = ALLOWED_ROTATION_DAYS.includes(Number(state.security.rotationDays))
    ? Number(state.security.rotationDays) : 30;
  const ms = Date.now() - new Date(state.security.changedAt).getTime();
  return ms > days * 24 * 60 * 60 * 1000;
}

/* ============================================================
AUTH GATE — Reemplaza la función requireAuthGate existente
============================================================ */

async function requireAuthGate() {
  const overlay = $('auth-overlay');
  const card    = $('auth-card');
  const app     = $('app-shell');
  const forceLogin = state.security?.passwordHash && (!isTrustedDevice() || isPasswordExpired());

  if (!state.security?.passwordHash || forceLogin) {
    app.style.display = 'none';
    overlay.style.display = '';
  } else {
    overlay.style.display = 'none';
    app.style.display = '';
    return true;
  }

  const firstTime = !state.security?.passwordHash;
  const expired   = isPasswordExpired();

  /* ---- Build the card HTML ---- */
  if (firstTime) {
    card.innerHTML = `
      <div class="auth-brand">
        <div class="auth-brand-icon">B</div>
        <span class="auth-brand-name">BudgetFlow</span>
      </div>
      <h2>Crear contraseña</h2>
      <p class="auth-subtitle">Protege el acceso a tus finanzas con una contraseña segura.</p>
      <form id="auth-form" class="auth-form" autocomplete="on">
        <div class="auth-field">
          <label class="auth-field-label" for="auth-pass">Nueva contraseña</label>
          <div class="auth-pass-wrap">
            <input type="password" id="auth-pass" required minlength="8"
                   autocomplete="new-password" placeholder="Mínimo 8 caracteres"
                   aria-describedby="auth-strength-label auth-reqs">
            <button type="button" class="auth-eye-btn" data-target="auth-pass" aria-label="Mostrar contraseña">
              ${eyeIcon()}
            </button>
          </div>
          <div class="auth-strength" id="auth-strength-wrap">
            <div class="auth-strength-bar" id="auth-strength-bar">
              <div class="auth-strength-seg" id="seg-1"></div>
              <div class="auth-strength-seg" id="seg-2"></div>
              <div class="auth-strength-seg" id="seg-3"></div>
              <div class="auth-strength-seg" id="seg-4"></div>
            </div>
            <span class="auth-strength-label" id="auth-strength-label"></span>
          </div>
          <div class="auth-reqs" id="auth-reqs">
            ${reqItem('req-len',   'Al menos 8 caracteres')}
            ${reqItem('req-upper', 'Una mayúscula')}
            ${reqItem('req-lower', 'Una minúscula')}
            ${reqItem('req-num',   'Un número')}
          </div>
        </div>
        <div class="auth-field">
          <label class="auth-field-label" for="auth-pass2">Confirmar contraseña</label>
          <div class="auth-pass-wrap">
            <input type="password" id="auth-pass2" required minlength="8"
                   autocomplete="new-password" placeholder="Repite la contraseña">
            <button type="button" class="auth-eye-btn" data-target="auth-pass2" aria-label="Mostrar contraseña">
              ${eyeIcon()}
            </button>
          </div>
        </div>
        <div class="auth-field">
          <label class="auth-field-label" for="auth-rotation">Cambio obligatorio cada</label>
          <select id="auth-rotation" class="auth-select" required>
            ${ALLOWED_ROTATION_DAYS.map(d => `<option value="${d}"${d===30?' selected':''}>${d} días</option>`).join('')}
          </select>
        </div>
        <label class="auth-remember">
          <input type="checkbox" id="auth-remember" checked>
          <span>Recordarme en este dispositivo</span>
        </label>
        <div class="auth-error-msg" id="auth-error"></div>
        <button type="submit" class="auth-submit-btn" id="auth-submit-btn">
          ${lockIcon()} Guardar y entrar
        </button>
      </form>`;
  } else {
    card.innerHTML = `
      <div class="auth-brand">
        <div class="auth-brand-icon">B</div>
        <span class="auth-brand-name">BudgetFlow</span>
      </div>
      <h2>${expired ? 'Cambio de contraseña requerido' : 'Verificar acceso'}</h2>
      <p class="auth-subtitle">${expired
        ? 'Tu contraseña ha expirado. Debes crear una nueva para continuar.'
        : 'Este dispositivo no está autorizado. Ingresa tu contraseña.'}</p>
      <form id="auth-form" class="auth-form" autocomplete="on">
        <div id="auth-lockout-banner"></div>
        <div class="auth-field">
          <label class="auth-field-label" for="auth-old">Contraseña actual</label>
          <div class="auth-pass-wrap">
            <input type="password" id="auth-old" required
                   autocomplete="current-password" placeholder="Tu contraseña actual">
            <button type="button" class="auth-eye-btn" data-target="auth-old" aria-label="Mostrar contraseña">
              ${eyeIcon()}
            </button>
          </div>
        </div>
        ${expired ? `
        <div class="auth-divider"></div>
        <div class="auth-field">
          <label class="auth-field-label" for="auth-pass">Nueva contraseña</label>
          <div class="auth-pass-wrap">
            <input type="password" id="auth-pass" required minlength="8"
                   autocomplete="new-password" placeholder="Mínimo 8 caracteres">
            <button type="button" class="auth-eye-btn" data-target="auth-pass" aria-label="Mostrar contraseña">
              ${eyeIcon()}
            </button>
          </div>
          <div class="auth-strength" id="auth-strength-wrap">
            <div class="auth-strength-bar" id="auth-strength-bar">
              <div class="auth-strength-seg" id="seg-1"></div>
              <div class="auth-strength-seg" id="seg-2"></div>
              <div class="auth-strength-seg" id="seg-3"></div>
              <div class="auth-strength-seg" id="seg-4"></div>
            </div>
            <span class="auth-strength-label" id="auth-strength-label"></span>
          </div>
        </div>
        <div class="auth-field">
          <label class="auth-field-label" for="auth-pass2">Confirmar nueva contraseña</label>
          <div class="auth-pass-wrap">
            <input type="password" id="auth-pass2" required minlength="8"
                   autocomplete="new-password" placeholder="Repite la nueva contraseña">
            <button type="button" class="auth-eye-btn" data-target="auth-pass2" aria-label="Mostrar contraseña">
              ${eyeIcon()}
            </button>
          </div>
        </div>` : ''}
        <label class="auth-remember">
          <input type="checkbox" id="auth-remember" checked>
          <span>Recordarme en este dispositivo</span>
        </label>
        <div class="auth-error-msg" id="auth-error"></div>
        <button type="submit" class="auth-submit-btn" id="auth-submit-btn">
          ${lockIcon()} ${expired ? 'Actualizar contraseña' : 'Entrar'}
        </button>
      </form>`;
  }

  /* ---- Wire up eye toggles ---- */
  card.querySelectorAll('.auth-eye-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = $(btn.dataset.target);
      if (!inp) return;
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      btn.innerHTML = show ? eyeOffIcon() : eyeIcon();
      btn.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
    });
  });

  /* ---- Strength meter ---- */
  const passInput = $('auth-pass');
  if (passInput) {
    passInput.addEventListener('input', () => updateStrengthUI(passInput.value));
  }

  /* ---- Req items ---- */
  if (passInput && firstTime) {
    passInput.addEventListener('input', () => updateReqs(passInput.value));
  }

  /* ---- Lockout UI ---- */
  function refreshLockoutUI() {
    const banner = $('auth-lockout-banner');
    const submit = $('auth-submit-btn');
    if (!banner) return;
    const remaining = getLockoutRemaining();
    if (remaining > 0) {
      const mins = Math.ceil(remaining / 60000);
      banner.innerHTML = `<div class="auth-lockout">
        ${shieldIcon()} <span>Demasiados intentos fallidos. Espera <strong>${mins} min</strong> para intentar de nuevo.</span>
      </div>`;
      if (submit) submit.disabled = true;
      setTimeout(refreshLockoutUI, 5000);
    } else {
      banner.innerHTML = '';
      if (submit) submit.disabled = false;
    }
  }
  refreshLockoutUI();

  return new Promise((resolve) => {
    $('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = $('auth-error');
      const clearError = () => { if (errorEl) errorEl.textContent = ''; };
      clearError();

      /* Check lockout */
      if (getLockoutRemaining() > 0) return;

      let passwordChanged = false;

      if (firstTime) {
        const p1 = $('auth-pass').value.trim();
        const p2 = $('auth-pass2').value.trim();
        const weakReason = validatePasswordStrength(p1);
        if (weakReason) {
          if (errorEl) errorEl.textContent = weakReason;
          shakeCard(card);
          return;
        }
        if (p1 !== p2) {
          if (errorEl) errorEl.textContent = 'Las contraseñas no coinciden';
          shakeCard(card);
          return;
        }
        const { hash, salt } = await hashPassword(p1);
        state.security.passwordHash = hash;
        state.security.salt = salt;
        state.security.rotationDays = Number($('auth-rotation').value || 30);
        state.security.algorithm = 'pbkdf2';
        passwordChanged = true;
        clearAttempts();
      } else {
        const oldOk = await verifyPassword($('auth-old').value);
        if (!oldOk) {
          const data = recordFailedAttempt();
          const remaining = getLockoutRemaining();
          if (remaining > 0) {
            refreshLockoutUI();
            return;
          }
          const left = getRemainingAttempts();
          if (errorEl) errorEl.textContent = left > 0
            ? `Contraseña incorrecta. ${left} intento${left !== 1 ? 's' : ''} restante${left !== 1 ? 's' : ''}.`
            : 'Contraseña incorrecta.';
          shakeCard(card);
          return;
        }
        clearAttempts();
        if (expired) {
          const p1 = $('auth-pass').value.trim();
          const p2 = $('auth-pass2').value.trim();
          const weakReason = validatePasswordStrength(p1);
          if (weakReason) {
            if (errorEl) errorEl.textContent = weakReason;
            shakeCard(card);
            return;
          }
          if (p1 !== p2) {
            if (errorEl) errorEl.textContent = 'Las contraseñas no coinciden';
            shakeCard(card);
            return;
          }
          if (await verifyPassword(p1)) {
            if (errorEl) errorEl.textContent = 'La nueva contraseña debe ser diferente';
            shakeCard(card);
            return;
          }
          const { hash, salt } = await hashPassword(p1);
          state.security.passwordHash = hash;
          state.security.salt = salt;
          state.security.algorithm = 'pbkdf2';
          passwordChanged = true;
        }
      }

      if (passwordChanged) state.security.changedAt = new Date().toISOString();
      if ($('auth-remember')?.checked) trustDevice(); else untrustDevice();
      save();
      overlay.style.display = 'none';
      app.style.display = '';
      resolve(true);
    });
  });
}

/* ============================================================
SECURITY SETTINGS MODAL — Reemplaza openSecuritySettings
============================================================ */

function openSecuritySettings() {
  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  const sec = state.security;
  const changedAt = sec.changedAt ? new Date(sec.changedAt) : null;
  const daysAgo   = changedAt ? Math.floor((Date.now() - changedAt.getTime()) / 86400000) : null;
  const rotDays   = ALLOWED_ROTATION_DAYS.includes(Number(sec.rotationDays)) ? Number(sec.rotationDays) : 30;
  const daysLeft  = daysAgo !== null ? rotDays - daysAgo : null;
  const expired   = isPasswordExpired();
  const trustedCount = Object.keys(sec.trustedDevices || {}).length;

  content.innerHTML = `
    <div class="sec-modal-header">
      <h3>⚙️ Configuración de seguridad</h3>
      <button class="sec-modal-close" id="sec-close-btn" aria-label="Cerrar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="sec-modal-body">
      <!-- Info section -->
      <div>
        <div class="sec-section-title">Estado actual</div>
        <div style="display:flex;flex-direction:column;gap:.45rem">
          <div class="sec-info-row">
            <span class="sec-info-label">Algoritmo</span>
            <span class="sec-info-val ok">${sec.algorithm === 'pbkdf2' ? 'PBKDF2 (seguro)' : 'SHA-256 (legado)'}</span>
          </div>
          <div class="sec-info-row">
            <span class="sec-info-label">Última actualización</span>
            <span class="sec-info-val">${changedAt ? changedAt.toLocaleDateString('es-CR') : '—'}</span>
          </div>
          <div class="sec-info-row">
            <span class="sec-info-label">Vence en</span>
            <span class="sec-info-val ${expired ? 'danger' : daysLeft !== null && daysLeft <= 7 ? 'warn' : 'ok'}">
              ${daysLeft === null ? '—' : expired ? 'Expirada' : `${daysLeft} días`}
            </span>
          </div>
          <div class="sec-info-row">
            <span class="sec-info-label">Dispositivos confiables</span>
            <span class="sec-info-val">${trustedCount}</span>
          </div>
        </div>
      </div>
      <!-- Change password form -->
      <div>
        <div class="sec-section-title">Cambiar contraseña</div>
        <form id="security-form" style="display:flex;flex-direction:column;gap:.7rem">
          <div class="sec-field">
            <label for="sec-old">Contraseña actual</label>
            <div class="auth-pass-wrap">
              <input type="password" id="sec-old" class="auth-input" required placeholder="Contraseña actual" autocomplete="current-password">
              <button type="button" class="auth-eye-btn" data-target="sec-old" aria-label="Mostrar">${eyeIcon()}</button>
            </div>
          </div>
          <div class="sec-field">
            <label for="sec-new">Nueva contraseña</label>
            <div class="auth-pass-wrap">
              <input type="password" id="sec-new" class="auth-input" minlength="8" required placeholder="Mínimo 8 caracteres" autocomplete="new-password">
              <button type="button" class="auth-eye-btn" data-target="sec-new" aria-label="Mostrar">${eyeIcon()}</button>
            </div>
            <div class="auth-strength" id="sec-strength-wrap">
              <div class="auth-strength-bar" id="sec-strength-bar">
                <div class="auth-strength-seg" id="sseg-1"></div>
                <div class="auth-strength-seg" id="sseg-2"></div>
                <div class="auth-strength-seg" id="sseg-3"></div>
                <div class="auth-strength-seg" id="sseg-4"></div>
              </div>
              <span class="auth-strength-label" id="sec-strength-label"></span>
            </div>
          </div>
          <div class="sec-field">
            <label for="sec-new2">Confirmar nueva</label>
            <div class="auth-pass-wrap">
              <input type="password" id="sec-new2" class="auth-input" minlength="8" required placeholder="Repite la contraseña" autocomplete="new-password">
              <button type="button" class="auth-eye-btn" data-target="sec-new2" aria-label="Mostrar">${eyeIcon()}</button>
            </div>
          </div>
          <div class="sec-field">
            <label for="sec-days">Rotación obligatoria cada</label>
            <select id="sec-days" class="auth-select" required>
              ${ALLOWED_ROTATION_DAYS.map(d => `<option value="${d}"${d===rotDays?' selected':''}>${d} días</option>`).join('')}
            </select>
          </div>
          <div class="auth-error-msg" id="sec-error"></div>
          <div style="display:flex;gap:.5rem;justify-content:flex-end;padding-top:.25rem">
            <button type="button" id="sec-cancel-btn" class="btn-ghost">Cancelar</button>
            <button type="submit" class="btn-primary" style="gap:.4rem">
              ${lockIcon(14)} Guardar cambios
            </button>
          </div>
        </form>
      </div>
      <!-- Danger zone -->
      <div>
        <div class="sec-section-title" style="color:var(--danger)">Zona de riesgo</div>
        <button id="sec-revoke-btn" class="btn-danger" style="width:100%;justify-content:center;padding:.55rem 1rem;border:1px solid color-mix(in srgb,var(--danger) 30%,transparent);border-radius:var(--radius)">
          Revocar todos los dispositivos confiables
        </button>
      </div>
    </div>`;

  overlay.style.display = 'flex';

  /* Eye toggles */
  content.querySelectorAll('.auth-eye-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = $(btn.dataset.target);
      if (!inp) return;
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      btn.innerHTML = show ? eyeOffIcon() : eyeIcon();
      btn.setAttribute('aria-label', show ? 'Ocultar' : 'Mostrar');
    });
  });

  /* Strength on new password */
  $('sec-new').addEventListener('input', () => {
    updateStrengthUI($('sec-new').value, 'sseg-', 'sec-strength-label');
  });

  /* Close / cancel */
  $('sec-close-btn').addEventListener('click',  () => { overlay.style.display = 'none'; });
  $('sec-cancel-btn').addEventListener('click', () => { overlay.style.display = 'none'; });

  /* Revoke devices */
  $('sec-revoke-btn').addEventListener('click', () => {
    if (!confirm('¿Revocar todos los dispositivos confiables? Todos deberán autenticarse de nuevo.')) return;
    state.security.trustedDevices = {};
    save();
    overlay.style.display = 'none';
    toast('Dispositivos confiables revocados');
  });

  /* Form submit */
  $('security-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('sec-error');
    errEl.textContent = '';

    if (!(await verifyPassword($('sec-old').value))) {
      errEl.textContent = 'Contraseña actual incorrecta';
      return;
    }
    const weak = validatePasswordStrength($('sec-new').value.trim());
    if (weak) { errEl.textContent = weak; return; }
    if ($('sec-new').value !== $('sec-new2').value) { errEl.textContent = 'Las contraseñas no coinciden'; return; }
    if (await verifyPassword($('sec-new').value)) { errEl.textContent = 'Debe ser distinta a la actual'; return; }

    const { hash, salt } = await hashPassword($('sec-new').value.trim());
    state.security.passwordHash = hash;
    state.security.salt = salt;
    state.security.algorithm = 'pbkdf2';
    state.security.rotationDays = Number($('sec-days').value || 30);
    state.security.changedAt = new Date().toISOString();
    /* Re-trust current device */
    trustDevice();
    save();
    overlay.style.display = 'none';
    toast('✅ Contraseña actualizada');
  });
}

/* ============================================================
HELPERS — pequeños SVG e UI utilities
============================================================ */

function eyeIcon(size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
}
function eyeOffIcon(size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
}
function lockIcon(size = 15) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
}
function shieldIcon(size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
}
function checkIcon(size = 13) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
}

function reqItem(id, label) {
  return `<div class="auth-req" id="${id}">${checkIcon()} <span>${label}</span></div>`;
}

function updateReqs(val) {
  const toggle = (id, met) => {
    const el = $(id);
    if (el) el.classList.toggle('met', met);
  };
  toggle('req-len',   val.length >= 8);
  toggle('req-upper', /[A-ZÁÉÍÓÚÑ]/.test(val));
  toggle('req-lower', /[a-záéíóúñ]/.test(val));
  toggle('req-num',   /\d/.test(val));
}

function updateStrengthUI(val, segPrefix = 'seg-', labelId = 'auth-strength-label') {
  const score = val.length ? getPasswordScore(val) : 0;
  for (let i = 1; i <= 4; i++) {
    const seg = $(`${segPrefix}${i}`);
    if (!seg) continue;
    seg.className = 'auth-strength-seg';
    if (i <= score) seg.classList.add(`active-${score}`);
  }
  const label = $(labelId);
  if (label) {
    label.textContent = val.length ? STRENGTH_LABELS[score] : '';
    label.className = `auth-strength-label${score ? ` strength-${score}` : ''}`;
  }
}

function shakeCard(card) {
  card.classList.remove('shake');
  void card.offsetWidth;
  card.classList.add('shake');
  card.addEventListener('animationend', () => card.classList.remove('shake'), { once: true });
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
    { label: 'Presupuesto asignado', value: money(distributed), sub: `Monto total repartido en categorías · Sin asignar: ${money(unassigned)}`,
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
  _refreshCsel('source-status');
  $('source-submit-btn').textContent  = 'Actualizar fuente';
  $('source-form-title').textContent  = 'Editar fuente';
  $('cancel-edit-btn').style.display  = '';
  $('source-form-card').style.display = '';
  $('source-form-card').classList.add('is-open');
  $('toggle-source-form').textContent = '−';
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
  $('source-form-card').classList.remove('is-open');
  $('source-form-card').style.display = 'none';
  $('toggle-source-form').textContent = '+';
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
  _refreshCsel('expense-category');
  _refreshCsel('filter-category');

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
  $('category-form-card').classList.remove('is-open');
  $('category-form-card').style.display = 'none';
  $('toggle-category-form').textContent = '+';
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
  _refreshCsel('expense-source');
  _refreshCsel('filter-source');
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
  const ebi = $('expense-budget-info'); if (ebi) ebi.style.display = 'none';
  renderAll();
  $('expense-form-card').classList.remove('is-open');
  $('expense-form-card').style.display = 'none';
  $('toggle-expense-form').textContent = '+';
  toast(`Gasto de ${money(amount)} registrado`);
});

/* ============================================================
   CUSTOM SELECT
   ============================================================ */

const _cselMap = {};

function _cselOptHTML(value, text, opts) {
  if (opts.isStatus) {
    if (value === 'recibido') return `<span class="badge badge-received">✓ Recibido</span>`;
    if (value === 'pendiente') return `<span class="badge badge-pending">⏳ Pendiente</span>`;
    return `<span class="csel-text">${text}</span>`;
  }
  if (opts.isCategory) {
    const color = state.categories.find((c) => c.name === value)?.color;
    if (color) return `<span class="csel-dot" style="background:${color}"></span><span class="csel-text">${text}</span>`;
  }
  return `<span class="csel-text">${text}</span>`;
}

function _buildCsel(id, opts = {}) {
  const native = $(id);
  if (!native) return;

  // Wrap only once — if wrapper already exists, just refresh
  if (_cselMap[id]) { _refreshCsel(id); return; }

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

  _cselMap[id] = { native, trigger, list, opts };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = list.classList.contains('open');
    _closeAllCsels();
    if (!isOpen) { list.classList.add('open'); trigger.classList.add('open'); }
  });

  _refreshCsel(id);
}

function _refreshCsel(id) {
  const cs = _cselMap[id];
  if (!cs) return;
  const { native, trigger, list, opts } = cs;

  // Rebuild option list
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

  // Update trigger face
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
    list.classList.remove('open');
    trigger.classList.remove('open');
  });
}

function refreshAllCsels() {
  Object.keys(_cselMap).forEach(_refreshCsel);
}

function initCustomSelects() {
  _buildCsel('source-status',    { isStatus: true });
  _buildCsel('expense-source',   {});
  _buildCsel('expense-category', { isCategory: true });
  _buildCsel('filter-source',    {});
  _buildCsel('filter-category',  { isCategory: true });
}

document.addEventListener('click', _closeAllCsels);

/* ============================================================
   EXPENSE BUDGET INFO
   ============================================================ */

function updateExpenseBudgetInfo() {
  const sourceId = $('expense-source').value;
  const category = $('expense-category').value;
  const el       = $('expense-budget-info');
  if (!el) return;

  if (!sourceId) { el.style.display = 'none'; return; }

  const source = state.sources.find((s) => s.id === sourceId);
  if (!source) { el.style.display = 'none'; return; }

  const t = sourceTotals(source);
  const statusBadge = source.status === 'recibido'
    ? `<span class="badge badge-received" style="font-size:.7rem">✓ Recibido</span>`
    : `<span class="badge badge-pending" style="font-size:.7rem">⏳ Pendiente</span>`;

  let html = `<div class="ebi-row">
    <div class="ebi-source-name">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
      <b>${source.name}</b> ${statusBadge}
    </div>
    <div class="ebi-stats">
      <span>Total <b>${money(source.amount)}</b></span>
      <span>Asignado <b>${money(t.assigned)}</b></span>
      <span style="color:${t.available < 0 ? 'var(--danger)' : 'var(--success)'}">Disponible <b>${money(t.available)}</b></span>
    </div>
  </div>`;

  if (category) {
    const assigned  = Number(source.distribution?.[category] || 0);
    const spent     = state.expenses
      .filter((e) => e.sourceId === sourceId && e.category === category)
      .reduce((a, b) => a + Number(b.amount), 0);
    const available = assigned - spent;
    const catColor  = state.categories.find((c) => c.name === category)?.color || '#888';

    html += `<div class="ebi-divider"></div>
    <div class="ebi-row">
      <div class="ebi-source-name">
        <span class="csel-dot" style="background:${catColor}"></span>
        <b>${category}</b>
      </div>
      <div class="ebi-stats">
        <span>Asignado <b>${money(assigned)}</b></span>
        <span style="color:var(--danger)">Gastado <b>${money(spent)}</b></span>
        <span style="color:${available < 0 ? 'var(--danger)' : 'var(--success)'}">Disponible <b>${money(available)}</b></span>
      </div>
    </div>`;
  }

  el.innerHTML = html;
  el.style.display = '';
}

$('expense-source').addEventListener('change', updateExpenseBudgetInfo);
$('expense-category').addEventListener('change', updateExpenseBudgetInfo);

function toggleCollapsibleCard(cardId, btnId) {
  const card = $(cardId);
  const btn = $(btnId);
  if (!card || !btn) return;
  const isHidden = card.style.display === 'none';

  if (isHidden) {
    card.style.display = '';
    requestAnimationFrame(() => card.classList.add('is-open'));
    btn.textContent = '−';
    if (cardId === 'expense-form-card') updateExpenseBudgetInfo();
    return;
  }

  card.classList.remove('is-open');
  setTimeout(() => { card.style.display = 'none'; }, 220);
  btn.textContent = '+';
}

$('toggle-source-form').addEventListener('click', () => toggleCollapsibleCard('source-form-card', 'toggle-source-form'));
$('toggle-category-form').addEventListener('click', () => toggleCollapsibleCard('category-form-card', 'toggle-category-form'));
$('toggle-expense-form').addEventListener('click', () => toggleCollapsibleCard('expense-form-card', 'toggle-expense-form'));

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
  $('security-settings').addEventListener('click', openSecuritySettings);
  await requireAuthGate();
  $('source-date').valueAsDate = new Date();
  applyTheme();
  renderAll();
  initCustomSelects();
  switchTab('dashboard');
})();
