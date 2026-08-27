'use strict';

/* ============================================================
   BUDGETFLOW — AUTH & SECURITY PORTAL (Linear / Vercel Aesthetic)
   ============================================================
   Gestiona:
   1. Portal de entrada principal multi-usuario con Firebase Auth:
      - Inicio de sesión con Correo/Contraseña y Google.
      - Registro seguro con Medidor de Fuerza de Contraseña en tiempo real.
      - Validación de coincidencia de contraseñas y saneamiento.
      - Recuperación de contraseña por correo.
      - Protección contra fuerza bruta con cuenta regresiva.
   2. Perfil de usuario activo en sidebar y mobile.
   3. Bloqueo opcional por inactividad dentro de la sesión.
   ============================================================ */

const AUTOLOCK_KEY   = 'bf_autolock_min';
const LOCKOUT_KEY    = 'bf_lockout_until';
const FAILS_KEY      = 'bf_fail_attempts';

function now() { return Date.now(); }

/* ---- Rate Limiting ---- */
function getLockoutRemainingSec() {
  const until = parseInt(sessionStorage.getItem(LOCKOUT_KEY) || '0', 10);
  const diff = until - now();
  return diff > 0 ? Math.ceil(diff / 1000) : 0;
}

function recordFailedAttempt() {
  let fails = parseInt(sessionStorage.getItem(FAILS_KEY) || '0', 10) + 1;
  sessionStorage.setItem(FAILS_KEY, fails);
  if (fails >= 5) {
    sessionStorage.setItem(LOCKOUT_KEY, now() + 60000); // 60s bloqueo
  }
  return fails;
}

function resetFailedAttempts() {
  sessionStorage.removeItem(FAILS_KEY);
  sessionStorage.removeItem(LOCKOUT_KEY);
}

/* ---- Evaluador de Fortaleza de Contraseña ---- */
function evaluatePasswordSecurity(pw) {
  if (!pw) {
    return {
      score: 0,
      label: 'Sin contraseña',
      color: 'var(--border)',
      checks: { length: false, mixedCase: false, number: false, symbol: false }
    };
  }

  const checks = {
    length: pw.length >= 8,
    mixedCase: /[a-z]/.test(pw) && /[A-Z]/.test(pw),
    number: /\d/.test(pw),
    symbol: /[^a-zA-Z0-9]/.test(pw)
  };

  let score = 0;
  if (checks.length) score++;
  if (checks.mixedCase) score++;
  if (checks.number) score++;
  if (checks.symbol) score++;

  let label = 'Muy débil';
  let color = '#ef4444';

  if (score === 2) {
    label = 'Aceptable';
    color = '#f59e0b';
  } else if (score === 3) {
    label = 'Buena';
    color = '#3b82f6';
  } else if (score === 4) {
    label = 'Fuerte';
    color = '#10b981';
  }

  return { score, label, color, checks };
}

const Auth = {
  _currentPortalMode: 'login', // 'login' | 'register' | 'forgot'
  _onAuthSuccess: null,
  _lastActivity: now(),
  _inactivityTimer: null,
  _isLocked: false,

  /* ============================================================
     PORTAL DE AUTENTICACIÓN (LOGIN / REGISTRO / RECUPERACIÓN)
     ============================================================ */

  showAuthPortal(options = {}) {
    const defaultMode = options.defaultTab || 'login';
    Auth._currentPortalMode = defaultMode;
    if (options.onAuthSuccess) {
      Auth._onAuthSuccess = options.onAuthSuccess;
    }

    let overlay = document.getElementById('auth-portal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'auth-portal-overlay';
      overlay.className = 'auth-portal-overlay';
      document.body.appendChild(overlay);
    }

    Auth._renderPortalContent(Auth._currentPortalMode);
  },

  hideAuthPortal() {
    const overlay = document.getElementById('auth-portal-overlay');
    if (overlay) {
      overlay.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      overlay.style.opacity = '0';
      overlay.style.transform = 'scale(0.99)';
      setTimeout(() => overlay.remove(), 200);
    }
  },

  _eyeIcon(visible) {
    return visible
      ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
           <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
           <line x1="1" y1="1" x2="23" y2="23"/>
         </svg>`
      : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
           <circle cx="12" cy="12" r="3"/>
         </svg>`;
  },

  _checkIcon() {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <polyline points="20 6 9 17 4 12"/>
    </svg>`;
  },

  _dotIcon() {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="3"/>
    </svg>`;
  },

  _renderPortalContent(mode) {
    const overlay = document.getElementById('auth-portal-overlay');
    if (!overlay) return;

    const isLogin = mode === 'login';
    const isRegister = mode === 'register';
    const isForgot = mode === 'forgot';

    let bodyHtml = '';

    if (isForgot) {
      bodyHtml = `
        <div style="display:flex;flex-direction:column;gap:1rem">
          <div class="auth-form-group">
            <label class="auth-form-label">Correo Electrónico</label>
            <input type="email" id="forgot-email" class="auth-form-input" placeholder="nombre@correo.com" autofocus autocomplete="email" />
          </div>
          <div class="auth-error" id="portal-error" style="display:none"></div>
          <div id="forgot-success-box" style="display:none;padding:.75rem .85rem;background:color-mix(in srgb,var(--success) 12%,transparent);border:1px solid color-mix(in srgb,var(--success) 25%,transparent);color:var(--success);border-radius:var(--radius);font-size:.8rem;line-height:1.45"></div>
          <button class="auth-submit-btn" id="forgot-submit-btn">Enviar enlace de recuperación</button>
          <button type="button" class="auth-form-link" id="forgot-back-btn" style="text-align:center;padding:.4rem;background:none;border:none">
            ← Volver a Iniciar Sesión
          </button>
        </div>`;
    } else {
      bodyHtml = `
        <!-- Botón Google -->
        <button type="button" class="auth-google-btn" id="portal-google-btn">
          <svg width="16" height="16" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
            <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.35 24 12 24z"/>
            <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
            <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
          </svg>
          Continuar con Google
        </button>

        <div class="auth-divider">o con tu correo</div>

        <form id="portal-form" style="display:flex;flex-direction:column;gap:.875rem" onsubmit="return false;">
          ${isRegister ? `
          <div class="auth-form-group">
            <label class="auth-form-label">Nombre Completo</label>
            <input type="text" id="portal-name" class="auth-form-input" placeholder="Ej. Juan Pérez" autocomplete="name" required />
          </div>` : ''}

          <div class="auth-form-group">
            <label class="auth-form-label">Correo Electrónico</label>
            <input type="email" id="portal-email" class="auth-form-input" placeholder="tu@correo.com" autocomplete="email" required />
          </div>

          <div class="auth-form-group">
            <div class="auth-form-label">
              <span>Contraseña</span>
              ${isLogin ? `<a class="auth-form-link" id="portal-forgot-link">¿Olvidaste tu contraseña?</a>` : ''}
            </div>
            <div class="auth-form-input-wrap">
              <input type="password" id="portal-pw" class="auth-form-input has-eye" placeholder="${isRegister ? 'Mínimo 8 caracteres' : '••••••••'}" autocomplete="${isRegister ? 'new-password' : 'current-password'}" required />
              <button type="button" class="auth-form-eye-btn" id="portal-eye-pw">${Auth._eyeIcon(false)}</button>
            </div>

            ${isRegister ? `
            <!-- Medidor de Seguridad en Tiempo Real -->
            <div class="auth-strength-meter" id="auth-strength-meter">
              <div class="auth-strength-bars">
                <div class="auth-strength-bar" id="str-bar-1"></div>
                <div class="auth-strength-bar" id="str-bar-2"></div>
                <div class="auth-strength-bar" id="str-bar-3"></div>
                <div class="auth-strength-bar" id="str-bar-4"></div>
              </div>
              <div class="auth-strength-label">
                <span>Seguridad:</span>
                <span class="auth-strength-score-text" id="str-score-text">Ingresa una contraseña</span>
              </div>
              <div class="auth-strength-checklist">
                <div class="auth-strength-item" id="chk-len">${Auth._dotIcon()} Mínimo 8 caracteres</div>
                <div class="auth-strength-item" id="chk-case">${Auth._dotIcon()} Mayúsculas y minúsculas</div>
                <div class="auth-strength-item" id="chk-num">${Auth._dotIcon()} Al menos un número</div>
                <div class="auth-strength-item" id="chk-sym">${Auth._dotIcon()} Al menos un símbolo (!@#$%^&*)</div>
              </div>
            </div>` : ''}
          </div>

          ${isRegister ? `
          <div class="auth-form-group">
            <label class="auth-form-label">Confirmar Contraseña</label>
            <div class="auth-form-input-wrap">
              <input type="password" id="portal-pw2" class="auth-form-input has-eye" placeholder="Repite tu contraseña" autocomplete="new-password" required />
              <button type="button" class="auth-form-eye-btn" id="portal-eye-pw2">${Auth._eyeIcon(false)}</button>
            </div>
            <div class="auth-match-hint" id="portal-match-hint" style="display:none"></div>
          </div>` : ''}

          <div class="auth-lockout-box" id="portal-lockout-box"></div>
          <div class="auth-error" id="portal-error"></div>

          <button class="auth-submit-btn" id="portal-submit-btn">
            ${isLogin ? 'Iniciar Sesión' : 'Crear Cuenta Segura'}
          </button>
        </form>`;
    }

    overlay.innerHTML = `
      <div class="auth-portal-card">
        <div class="auth-portal-header">
          <img src="icons/icon-192.png" class="auth-portal-logo" alt="BudgetFlow" />
          <h1 class="auth-portal-title">BudgetFlow</h1>
          <p class="auth-portal-subtitle">
            ${isForgot ? 'Recupera el acceso a tu cuenta' : 'Gestión inteligente de presupuestos multi-usuario'}
          </p>
        </div>

        ${!isForgot ? `
        <div class="auth-portal-tabs">
          <button type="button" class="auth-portal-tab ${isLogin ? 'active' : ''}" id="portal-tab-login">Iniciar Sesión</button>
          <button type="button" class="auth-portal-tab ${isRegister ? 'active' : ''}" id="portal-tab-register">Crear Cuenta</button>
        </div>` : ''}

        ${bodyHtml}
      </div>`;

    Auth._bindPortalEvents(mode);
  },

  _bindPortalEvents(mode) {
    const isLogin = mode === 'login';
    const isRegister = mode === 'register';
    const isForgot = mode === 'forgot';

    const tabLogin = document.getElementById('portal-tab-login');
    const tabRegister = document.getElementById('portal-tab-register');
    const forgotLink = document.getElementById('portal-forgot-link');
    const forgotBack = document.getElementById('forgot-back-btn');
    const googleBtn = document.getElementById('portal-google-btn');
    const submitBtn = document.getElementById('portal-submit-btn') || document.getElementById('forgot-submit-btn');
    const errBox = document.getElementById('portal-error');

    // Switch Tabs
    tabLogin?.addEventListener('click', () => Auth._renderPortalContent('login'));
    tabRegister?.addEventListener('click', () => Auth._renderPortalContent('register'));
    forgotLink?.addEventListener('click', () => Auth._renderPortalContent('forgot'));
    forgotBack?.addEventListener('click', () => Auth._renderPortalContent('login'));

    // Toggles de ver contraseña
    const bindEye = (eyeId, inputId) => {
      const eye = document.getElementById(eyeId);
      const inp = document.getElementById(inputId);
      if (!eye || !inp) return;
      let visible = false;
      eye.addEventListener('click', () => {
        visible = !visible;
        inp.type = visible ? 'text' : 'password';
        eye.innerHTML = Auth._eyeIcon(visible);
      });
    };

    bindEye('portal-eye-pw', 'portal-pw');
    bindEye('portal-eye-pw2', 'portal-pw2');

    // Google Sign-In
    googleBtn?.addEventListener('click', async () => {
      if (!window.FBAuth) return;
      errBox.style.display = 'none';
      googleBtn.disabled = true;
      googleBtn.style.opacity = '0.7';

      try {
        const user = await window.FBAuth.loginWithGoogle();
        if (user) {
          Auth.hideAuthPortal();
          if (Auth._onAuthSuccess) Auth._onAuthSuccess(user);
        }
      } catch (err) {
        googleBtn.disabled = false;
        googleBtn.style.opacity = '1';
        errBox.textContent = window.FBAuth.formatError(err);
        errBox.style.display = 'block';
      }
    });

    // Medidor de Contraseña Reactivo en Registro
    if (isRegister) {
      const pwInp = document.getElementById('portal-pw');
      const pw2Inp = document.getElementById('portal-pw2');
      const matchHint = document.getElementById('portal-match-hint');

      const updateMeter = () => {
        const val = pwInp.value || '';
        const { score, label, color, checks } = evaluatePasswordSecurity(val);

        // Actualizar barras
        for (let i = 1; i <= 4; i++) {
          const bar = document.getElementById(`str-bar-${i}`);
          if (bar) {
            bar.style.backgroundColor = i <= score ? color : 'var(--border)';
          }
        }

        // Texto de fortaleza
        const scoreText = document.getElementById('str-score-text');
        if (scoreText) {
          scoreText.textContent = label;
          scoreText.style.color = color;
        }

        // Lista de verificación
        const updateChk = (id, isValid) => {
          const el = document.getElementById(id);
          if (!el) return;
          if (isValid) {
            el.classList.add('valid');
            el.innerHTML = `${Auth._checkIcon()} ${el.textContent.trim().replace(/^[^a-zA-Z0-9]+/, '')}`;
          } else {
            el.classList.remove('valid');
            el.innerHTML = `${Auth._dotIcon()} ${el.textContent.trim().replace(/^[^a-zA-Z0-9]+/, '')}`;
          }
        };

        updateChk('chk-len', checks.length);
        updateChk('chk-case', checks.mixedCase);
        updateChk('chk-num', checks.number);
        updateChk('chk-sym', checks.symbol);

        // Coincidencia de contraseña
        updateMatch();
      };

      const updateMatch = () => {
        const p1 = pwInp.value;
        const p2 = pw2Inp.value;
        if (!p2) {
          matchHint.style.display = 'none';
          return;
        }
        matchHint.style.display = 'flex';
        if (p1 === p2) {
          matchHint.className = 'auth-match-hint valid';
          matchHint.innerHTML = `${Auth._checkIcon()} Las contraseñas coinciden`;
        } else {
          matchHint.className = 'auth-match-hint invalid';
          matchHint.innerHTML = `✕ Las contraseñas no coinciden`;
        }
      };

      pwInp?.addEventListener('input', updateMeter);
      pw2Inp?.addEventListener('input', updateMatch);
    }

    // Rate Limiting en Login
    if (isLogin) {
      const updateLockout = () => {
        const box = document.getElementById('portal-lockout-box');
        const remaining = getLockoutRemainingSec();
        if (remaining > 0) {
          if (box) {
            box.style.display = 'block';
            box.innerHTML = `Demasiados intentos fallidos. Espera <strong>${remaining}s</strong> por seguridad.`;
          }
          if (submitBtn) submitBtn.disabled = true;
          setTimeout(updateLockout, 1000);
        } else {
          if (box) box.style.display = 'none';
          if (submitBtn) submitBtn.disabled = false;
        }
      };
      updateLockout();
    }

    // Submit del Formulario
    submitBtn?.addEventListener('click', async () => {
      errBox.style.display = 'none';

      if (isForgot) {
        const email = document.getElementById('forgot-email')?.value.trim();
        if (!email || !window.FBAuth?.isValidEmail(email)) {
          errBox.textContent = 'Ingresa un correo electrónico válido.';
          errBox.style.display = 'block';
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Enviando…';

        try {
          await window.FBAuth.sendPasswordReset(email);
          const successBox = document.getElementById('forgot-success-box');
          if (successBox) {
            successBox.textContent = '✓ Te hemos enviado un enlace a tu correo para restablecer tu contraseña.';
            successBox.style.display = 'block';
          }
          submitBtn.style.display = 'none';
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Enviar enlace de recuperación';
          errBox.textContent = window.FBAuth.formatError(err);
          errBox.style.display = 'block';
        }
        return;
      }

      if (isRegister) {
        const name = document.getElementById('portal-name')?.value.trim();
        const email = document.getElementById('portal-email')?.value.trim();
        const pw = document.getElementById('portal-pw')?.value || '';
        const pw2 = document.getElementById('portal-pw2')?.value || '';

        if (!name) {
          errBox.textContent = 'Por favor ingresa tu nombre completo.';
          errBox.style.display = 'block';
          return;
        }

        if (!email || !window.FBAuth?.isValidEmail(email)) {
          errBox.textContent = 'Por favor ingresa un correo electrónico válido.';
          errBox.style.display = 'block';
          return;
        }

        const { score, checks } = evaluatePasswordSecurity(pw);
        if (!checks.length) {
          errBox.textContent = 'La contraseña debe tener al menos 8 caracteres.';
          errBox.style.display = 'block';
          return;
        }

        if (score < 2) {
          errBox.textContent = 'Por tu seguridad, combina mayúsculas, minúsculas y números.';
          errBox.style.display = 'block';
          return;
        }

        if (pw !== pw2) {
          errBox.textContent = 'Las contraseñas no coinciden.';
          errBox.style.display = 'block';
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Creando cuenta segura…';

        try {
          const user = await window.FBAuth.registerWithEmail(email, pw, name);
          if (user) {
            Auth.hideAuthPortal();
            if (Auth._onAuthSuccess) Auth._onAuthSuccess(user);
          }
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Crear Cuenta Segura';
          errBox.textContent = window.FBAuth.formatError(err);
          errBox.style.display = 'block';
        }
        return;
      }

      if (isLogin) {
        if (getLockoutRemainingSec() > 0) return;

        const email = document.getElementById('portal-email')?.value.trim();
        const pw = document.getElementById('portal-pw')?.value || '';

        if (!email || !pw) {
          errBox.textContent = 'Ingresa tu correo y contraseña.';
          errBox.style.display = 'block';
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Iniciando sesión…';

        try {
          const user = await window.FBAuth.loginWithEmail(email, pw);
          resetFailedAttempts();
          if (user) {
            Auth.hideAuthPortal();
            if (Auth._onAuthSuccess) Auth._onAuthSuccess(user);
          }
        } catch (err) {
          const fails = recordFailedAttempt();
          submitBtn.disabled = false;
          submitBtn.textContent = 'Iniciar Sesión';

          if (fails >= 5) {
            errBox.textContent = 'Has excedido los intentos permitidos. Espera 60 segundos.';
            const updateLock = () => {
              const remaining = getLockoutRemainingSec();
              const box = document.getElementById('portal-lockout-box');
              if (remaining > 0) {
                if (box) {
                  box.style.display = 'block';
                  box.innerHTML = `Demasiados intentos fallidos. Espera <strong>${remaining}s</strong> por seguridad.`;
                }
                submitBtn.disabled = true;
                setTimeout(updateLock, 1000);
              } else {
                if (box) box.style.display = 'none';
                submitBtn.disabled = false;
              }
            };
            updateLock();
          } else {
            errBox.textContent = window.FBAuth.formatError(err);
          }
          errBox.style.display = 'block';
        }
      }
    });

    // Enter para enviar
    document.getElementById('portal-form')?.querySelectorAll('.auth-form-input').forEach(inp => {
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !submitBtn.disabled) submitBtn.click();
      });
    });
  },

  /* ============================================================
     GESTIÓN DE PERFIL EN UI (SIDEBAR Y MOBILE)
     ============================================================ */

  updateUserProfile(user) {
    const badge = document.getElementById('user-profile-badge');
    const avatar = document.getElementById('user-avatar');
    const nameEl = document.getElementById('user-name');
    const emailEl = document.getElementById('user-email');
    const logoutBtnMobile = document.getElementById('user-logout-btn-mobile');

    if (!user) {
      if (badge) badge.style.display = 'none';
      if (logoutBtnMobile) logoutBtnMobile.style.display = 'none';
      return;
    }

    const displayName = user.displayName || user.email.split('@')[0];
    const initial = displayName.charAt(0).toUpperCase();

    if (avatar) {
      if (user.photoURL) {
        avatar.innerHTML = `<img src="${user.photoURL}" alt="${displayName}" referrerpolicy="no-referrer" />`;
      } else {
        avatar.textContent = initial;
      }
    }

    if (nameEl) nameEl.textContent = displayName;
    if (emailEl) emailEl.textContent = user.email || '';
    if (badge) badge.style.display = 'flex';
    if (logoutBtnMobile) logoutBtnMobile.style.display = 'flex';

    // Vincular cierre de sesión
    const handleLogout = async () => {
      if (confirm('¿Cerrar sesión de BudgetFlow?')) {
        if (window.FBAuth) await window.FBAuth.logout();
      }
    };

    document.getElementById('user-logout-btn')?.addEventListener('click', handleLogout);
    logoutBtnMobile?.addEventListener('click', handleLogout);
  },

  /* ============================================================
     AUTO-BLOQUEO POR INACTIVIDAD DENTRO DE LA SESIÓN
     ============================================================ */

  getAutoLockMinutes() {
    const v = localStorage.getItem(AUTOLOCK_KEY);
    return v !== null ? parseInt(v, 10) : 15;
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

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        Auth._checkInactivity();
      }
    });

    Auth._inactivityTimer = setInterval(() => {
      Auth._checkInactivity();
    }, 10000);
  },

  _checkInactivity() {
    if (Auth._isLocked || !window.FBAuth?.currentUser) return;
    const mins = Auth.getAutoLockMinutes();
    if (mins <= 0) return;

    const elapsedMs = now() - Auth._lastActivity;
    if (elapsedMs >= mins * 60 * 1000) {
      Auth.lockByInactivity();
    }
  },

  lockByInactivity() {
    if (Auth._isLocked) return;
    Auth._isLocked = true;
    Auth.showAuthPortal({ defaultTab: 'login' });
  },

  /* ---- Modal de Configuración de Seguridad en la app ---- */

  async renderSettingsPanel() {
    const user = window.FBAuth?.currentUser;
    const currentAutoLock = Auth.getAutoLockMinutes();

    return `
      <div class="auth-settings-panel" id="auth-settings-panel">
        <div class="auth-security-hero">
          <div class="auth-security-hero-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div>
            <div class="auth-security-hero-title">Cuenta y Seguridad</div>
            <div class="auth-security-hero-subtitle">Tus presupuestos están protegidos y aislados bajo tu cuenta de Firebase.</div>
          </div>
        </div>

        <div class="auth-settings-row">
          <div>
            <div class="auth-settings-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
              Cuenta Activa
            </div>
            <div class="auth-settings-meta">
              ${user ? `Conectado como <strong>${user.email || user.displayName}</strong>` : 'Sin sesión activa'}
            </div>
          </div>
          ${user ? `<button class="btn-danger btn-sm" id="auth-settings-logout-btn">Cerrar sesión</button>` : ''}
        </div>

        <div class="auth-settings-row">
          <div>
            <div class="auth-settings-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              Auto-bloqueo por inactividad
            </div>
            <div class="auth-settings-meta">
              Vuelve a pedir autenticación si te ausentas
            </div>
          </div>
          <select id="auth-autolock-select" style="max-width:130px">
            <option value="5"  ${currentAutoLock === 5 ? 'selected' : ''}>5 minutos</option>
            <option value="15" ${currentAutoLock === 15 ? 'selected' : ''}>15 minutos</option>
            <option value="30" ${currentAutoLock === 30 ? 'selected' : ''}>30 minutos</option>
            <option value="60" ${currentAutoLock === 60 ? 'selected' : ''}>1 hora</option>
            <option value="0"  ${currentAutoLock === 0 ? 'selected' : ''}>Desactivado</option>
          </select>
        </div>
      </div>`;
  },

  bindSettingsEvents() {
    document.getElementById('auth-autolock-select')?.addEventListener('change', (e) => {
      const mins = parseInt(e.target.value, 10);
      Auth.setAutoLockMinutes(mins);
      if (window.toast) toast(`⏱️ Auto-bloqueo ajustado a ${mins === 0 ? 'Desactivado' : mins + ' min'}`);
    });

    document.getElementById('auth-settings-logout-btn')?.addEventListener('click', async () => {
      if (confirm('¿Cerrar sesión de BudgetFlow?')) {
        document.getElementById('security-modal-overlay').style.display = 'none';
        if (window.FBAuth) await window.FBAuth.logout();
      }
    });
  }
};

window.Auth = Auth;
