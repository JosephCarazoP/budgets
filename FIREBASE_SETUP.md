# Guía de Conexión: Firebase Auth y Cloud Firestore para BudgetFlow

Esta guía te explica cómo habilitar **Firebase Authentication** y **Cloud Firestore** para que cada persona que use BudgetFlow tenga su **propia cuenta segura** y su **propio presupuesto independiente**.

---

## 1. Crear el Proyecto en Firebase

1. Ve a [Firebase Console](https://console.firebase.google.com/) e inicia sesión con tu cuenta de Google.
2. Haz clic en **"Agregar proyecto"** (o "Crear un proyecto").
3. Nómbralo (por ejemplo: `budgetflow-app`).
4. Puedes desactivar o activar Google Analytics (es opcional). Haz clic en **Crear proyecto**.

---

## 2. Habilitar Autenticación (Firebase Auth)

1. En el menú izquierdo de Firebase Console, ve a **Compilación** (Build) → **Authentication**.
2. Haz clic en **Comenzar**.
3. En la pestaña **Método de acceso** (Sign-in method):
   - **Correo electrónico/contraseña**: Haz clic, activa la casilla **Habilitar** y guarda.
   - **Google**: Haz clic, activa **Habilitar**, selecciona tu correo de asistencia y guarda.

---

## 3. Crear la Base de Datos Cloud Firestore

1. En el menú izquierdo, ve a **Compilación** → **Firestore Database**.
2. Haz clic en **Crear base de datos**.
3. Elige la ubicación más cercana (ej. `nam5 (us-central)`).
4. Selecciona **Iniciar en modo de producción** y haz clic en **Siguiente** → **Habilitar**.

### Reglas de Seguridad (Muy Importante)
Ve a la pestaña **Reglas** (Rules) de Firestore y pega lo siguiente para garantizar que **nadie pueda leer ni modificar el presupuesto de otro usuario**:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Cada usuario solo puede leer y escribir en su propia carpeta
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
  }
}
```
Haz clic en **Publicar**.

---

## 4. Registrar tu Aplicación Web y Obtener las Credenciales

1. En la página principal de tu proyecto en Firebase, haz clic en el icono web **`</>`** (Agregar app).
2. Ponle un apodo (ej. `BudgetFlow Web`).
3. No es necesario marcar "Firebase Hosting" por ahora. Haz clic en **Registrar app**.
4. Verás un bloque de código con `const firebaseConfig = { ... }`. Copia esos valores:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "budgetflow-app.firebaseapp.com",
  projectId: "budgetflow-app",
  storageBucket: "budgetflow-app.appspot.com",
  messagingSenderId: "123456789...",
  appId: "1:123456789...:web:..."
};
```

---

## 5. Pegar las Credenciales en BudgetFlow

Tienes **dos opciones**:

### Opción A (Desde el archivo de código):
Abre [`firebase-config.js`](file:///c:/Users/josep/Downloads/budgets-main/firebase-config.js) y reemplaza el objeto `DEFAULT_FIREBASE_CONFIG` con tus credenciales copiadas.

### Opción B (Desde la misma aplicación web):
Abre BudgetFlow en tu navegador, haz clic en el botón de **Seguridad / Cuentas**, ve a la sección **Conexión Firebase** y pega tu configuración. Se guardará de inmediato sin necesidad de recompilar.

---

## 6. ¿Cómo funciona la privacidad entre usuarios?
- Cuando el Usuario A inicia sesión con `usuarioA@gmail.com`, Firestore crea `/users/UID_A/data/budget_state`.
- Cuando el Usuario B inicia sesión con `usuarioB@gmail.com`, Firestore crea `/users/UID_B/data/budget_state`.
- Las reglas de Firestore bloquean automáticamente cualquier intento de un usuario de consultar o modificar el presupuesto de otro.
