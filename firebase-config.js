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
      firebaseAuth = firebase.auth();

      // Escuchar cambios de autenticación
      firebaseAuth.onAuthStateChanged((user) => {
        FBAuth.currentUser = user;
        FBAuth._notify(user);
      });

      return true;
    } catch (err) {
      console.error('Error inicializando Firebase:', err);
      return false;
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
    if (firebaseAuth) {
      await firebaseAuth.signOut();
    }
    FBAuth.currentUser = null;
  },

  async sendPasswordReset(email) {
    if (!firebaseAuth) throw new Error('Firebase Auth no inicializado');
    return firebaseAuth.sendPasswordResetEmail(email);
  },

  /* ---- Firestore State Storage per User ---- */

  getUserDocRef(userId) {
    if (!firestoreDb) return null;
    return firestoreDb.collection('users').doc(userId).collection('data').doc('budget_state');
  },

  async loadUserState(userId) {
    if (!firestoreDb || !userId) return null;
    try {
      const doc = await this.getUserDocRef(userId).get();
      if (doc.exists) {
        return doc.data();
      }
      return null;
    } catch (err) {
      console.error('Error cargando datos de Firestore:', err);
      throw err;
    }
  },

  async saveUserState(userId, stateData) {
    if (!firestoreDb || !userId) return false;
    try {
      const cleanData = JSON.parse(JSON.stringify(stateData));
      cleanData.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      await this.getUserDocRef(userId).set(cleanData, { merge: true });
      return true;
    } catch (err) {
      console.error('Error guardando en Firestore:', err);
      throw err;
    }
  },

  subscribeToUserState(userId, onUpdate) {
    if (!firestoreDb || !userId) return () => {};
    return this.getUserDocRef(userId).onSnapshot((doc) => {
      if (doc.exists && onUpdate) {
        onUpdate(doc.data());
      }
    }, (err) => {
      console.warn('Error en listener de Firestore:', err);
    });
  }
};

window.FBAuth = FBAuth;
