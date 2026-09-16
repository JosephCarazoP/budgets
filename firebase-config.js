'use strict';

/* ============================================================
   BUDGETFLOW — FIREBASE & FIRESTORE INTEGRATION MODULE
   ============================================================
   Permite autenticación multi-usuario (Email/Password y Google)
   y almacenamiento independiente en Cloud Firestore:
   Cada usuario tiene su propio documento aislado en:
   /users/{userId}/data/budget_state
   ============================================================ */

// Reemplaza estos valores con los de tu consola de Firebase:
// https://console.firebase.google.com -> Configuración de proyecto -> Apps web
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDz8NiYZfjMyIH6Ird7wedYFveFgCwEPos",
  authDomain: "budgetflow-app-7cb2c.firebaseapp.com",
  projectId: "budgetflow-app-7cb2c",
  storageBucket: "budgetflow-app-7cb2c.firebasestorage.app",
  messagingSenderId: "987890901695",
  appId: "1:987890901695:web:530eec1e210b6ae79fdc0a",
  measurementId: "G-YLSD8XDV7S"
};

// Permite persistir credenciales configuradas desde la interfaz sin tocar código
function getStoredFirebaseConfig() {
  try {
    const saved = localStorage.getItem('bf_firebase_config');
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.warn('Error reading stored Firebase config', e);
  }
  return DEFAULT_FIREBASE_CONFIG;
}

let firebaseApp = null;
let firestoreDb = null;
let firebaseAuth = null;

const FBAuth = {
  currentUser: null,
  _listeners: [],

  isConfigured() {
    const cfg = getStoredFirebaseConfig();
    return cfg && cfg.apiKey && cfg.apiKey !== "TU_API_KEY" && cfg.projectId !== "tu-proyecto";
  },

  getConfig() {
    return getStoredFirebaseConfig();
  },

  saveConfig(newConfig) {
    localStorage.setItem('bf_firebase_config', JSON.stringify(newConfig));
    window.location.reload();
  },

  resetConfig() {
    localStorage.removeItem('bf_firebase_config');
    window.location.reload();
  },

  async init() {
    if (!window.firebase) {
      console.warn('Firebase SDK no cargado en window.firebase');
      return false;
    }

    const cfg = getStoredFirebaseConfig();
    if (!this.isConfigured()) {
      return false;
    }

    try {
      if (!firebase.apps.length) {
        firebaseApp = firebase.initializeApp(cfg);
      } else {
        firebaseApp = firebase.app();
      }

      firestoreDb = firebase.firestore();
      try {
        await firestoreDb.enablePersistence({ synchronizeTabs: true });
        console.log('BudgetFlow: Persistencia offline de Firestore activada.');
      } catch (pErr) {
        if (pErr.code === 'failed-precondition') {
          console.warn('Persistencia Firestore: múltiples pestañas abiertas simultáneamente.');
        } else if (pErr.code === 'unimplemented') {
          console.warn('Persistencia Firestore: el navegador no soporta IndexedDB persistence.');
        } else {
          console.warn('Aviso habilitando persistencia Firestore:', pErr);
        }
      }

      firebaseAuth = firebase.auth();

      // Escuchar cambios de autenticación
      firebaseAuth.onAuthStateChanged((user) => {
        FBAuth.currentUser = user;
        if (user) {
          try {
            localStorage.setItem('bf_last_user', JSON.stringify({
              uid: user.uid,
              displayName: user.displayName || user.email?.split('@')[0] || 'Usuario',
              email: user.email || ''
            }));
          } catch (_) {}
        }
        FBAuth._notify(user);
      });

      return true;
    } catch (err) {
      console.error('Error inicializando Firebase:', err);
      return false;
    }
  },

  getLastStoredUser() {
    try {
      const u = localStorage.getItem('bf_last_user');
      return u ? JSON.parse(u) : null;
    } catch (_) {
      return null;
    }
  },

  onChange(callback) {
    if (typeof callback === 'function') {
      FBAuth._listeners.push(callback);
      if (FBAuth.currentUser !== undefined) {
        callback(FBAuth.currentUser);
      }
    }
  },

  _notify(user) {
    FBAuth._listeners.forEach(fn => {
      try { fn(user); } catch (e) { console.error(e); }
    });
  },

  /* ---- Auth Methods ---- */

  async registerWithEmail(email, password, displayName) {
    if (!firebaseAuth) throw new Error('Firebase Auth no inicializado');
    const cred = await firebaseAuth.createUserWithEmailAndPassword(email, password);
    if (displayName && cred.user) {
      await cred.user.updateProfile({ displayName });
    }
    return cred.user;
  },

  async loginWithEmail(email, password) {
    if (!firebaseAuth) throw new Error('Firebase Auth no inicializado');
    const cred = await firebaseAuth.signInWithEmailAndPassword(email, password);
    return cred.user;
  },

  async loginWithGoogle() {
    if (!firebaseAuth) throw new Error('Firebase Auth no inicializado');
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    const result = await firebaseAuth.signInWithPopup(provider);
    return result.user;
  },

  async logout() {
    try {
      localStorage.removeItem('bf_last_user');
    } catch (_) {}
    if (firebaseAuth) {
      await firebaseAuth.signOut();
    }
    FBAuth.currentUser = null;
    FBAuth._notify(null);
  },

  async sendPasswordReset(email) {
    if (!firebaseAuth) throw new Error('Firebase Auth no inicializado');
    return firebaseAuth.sendPasswordResetEmail(email);
  },

  /* ---- Helpers de Validación y Errores ---- */

  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
  },

  formatError(err) {
    if (!err) return 'Ha ocurrido un error inesperado.';
    const code = err.code || '';
    switch (code) {
      case 'auth/invalid-email':
        return 'El correo electrónico no es válido.';
      case 'auth/user-disabled':
        return 'Esta cuenta ha sido inhabilitada por el administrador.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
      case 'auth/invalid-login-credentials':
        return 'Correo o contraseña incorrectos.';
      case 'auth/email-already-in-use':
        return 'Ya existe una cuenta registrada con este correo.';
      case 'auth/weak-password':
        return 'La contraseña es muy débil. Debe tener al menos 8 caracteres.';
      case 'auth/too-many-requests':
        return 'Demasiados intentos fallidos. Por seguridad, espera un momento.';
      case 'auth/popup-closed-by-user':
        return 'Se canceló el inicio de sesión con Google.';
      case 'auth/popup-blocked':
        return 'La ventana emergente de Google fue bloqueada por tu navegador.';
      case 'auth/network-request-failed':
        return 'Error de conexión a internet. Verifica tu red.';
      case 'auth/unauthorized-domain': {
        const host = window.location.hostname || 'este dominio';
        if (window.location.protocol === 'file:') {
          return 'No puedes iniciar sesión con Google desde un archivo local (file://). Debes abrir el proyecto usando un servidor local (ej. Live Server o http://localhost:...)';
        }
        return `Dominio no autorizado (${host}). Agrégalo en Firebase Console -> Authentication -> Ajustes -> Dominios autorizados.`;
      }
      default:
        return err.message || 'Error al procesar la solicitud.';
    }
  },

  /* ---- Firestore State Storage per User ---- */

  getUserDocRef(userId) {
    if (!firestoreDb) return null;
    return firestoreDb.collection('users').doc(userId).collection('data').doc('budget_state');
  },

  async loadUserState(userId, timeoutMs = 3500) {
    if (!firestoreDb || !userId) return null;
    try {
      const getPromise = this.getUserDocRef(userId).get();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Firestore timeout')), timeoutMs)
      );
      const doc = await Promise.race([getPromise, timeoutPromise]);
      if (doc && doc.exists) {
        return doc.data();
      }
      return null;
    } catch (err) {
      console.warn('BudgetFlow: No se pudo obtener de Firestore inmediatamente (posible offline):', err.message);
      return null;
    }
  },

  async saveUserState(userId, stateData) {
    if (!firestoreDb || !userId) return false;
    try {
      const cleanData = JSON.parse(JSON.stringify(stateData));
      cleanData.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      cleanData.clientUpdatedAt = new Date().toISOString();
      await this.getUserDocRef(userId).set(cleanData, { merge: true });
      return true;
    } catch (err) {
      console.warn('BudgetFlow: Error sincronizando Firestore (guardado en cola offline):', err.message);
      return false;
    }
  },

  subscribeToUserState(userId, onUpdate) {
    if (!firestoreDb || !userId) return () => {};
    return this.getUserDocRef(userId).onSnapshot({ includeMetadataChanges: true }, (doc) => {
      if (doc && doc.exists && onUpdate) {
        onUpdate(doc.data(), doc.metadata);
      }
    }, (err) => {
      console.warn('Error en listener de Firestore:', err);
    });
  }
};

window.FBAuth = FBAuth;
