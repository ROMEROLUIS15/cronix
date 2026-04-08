const fs = require('fs')
const path = require('path')

const locales = ['es', 'en', 'pt', 'fr', 'it', 'de']
const dir = path.join(__dirname, 'messages')

const updates = {
  es: {
    profile: {
      passkeys: {
        notAvailTitle: "Acceso biométrico no disponible",
        notAvailSub: "Tu dispositivo no soporta autenticación biométrica.",
        registerErrorOptions: "Error al obtener opciones de registro",
        registerErrorVerify: "Error al registrar",
        registerSuccess: "¡Huella registrada correctamente!",
        registerCancel: "Registro cancelado",
        registerGeneric: "Error al registrar la huella",
        deleteError: "Error al eliminar la credencial.",
        title: "Acceso biométrico",
        sub: "Inicia sesión con tu huella o Face ID sin contraseña",
        defaultDevice: "Dispositivo",
        emptyTitle: "Activa el acceso rápido con tu huella",
        emptySub: "Registra tu huella o Face ID para ingresar a Cronix en segundos, sin escribir tu contraseña.",
        inputPlaceholder: "Nombre del dispositivo (ej: \"iPhone de Luis\")",
        btnWaiting: "Esperando autenticación...",
        btnAnother: "+ Agregar otro dispositivo",
        btnRegister: "Registrar huella / Face ID"
      }
    },
    settings: {
      pushNotif: {
        title: "Notificaciones Push",
        denied: "Bloqueadas — actívalas en la configuración de tu navegador",
        missingConfig: "Error: clave VAPID no configurada en el servidor",
        unavailable: "Requiere build de producción — prueba con next build && next start",
        loading: "Procesando…",
        active: "Activo en este dispositivo",
        receiveAlerts: "Recibe alertas de citas en este dispositivo",
        btnDisable: "Desactivar notificaciones push",
        btnEnable: "Activar notificaciones push"
      },
      plan: {
        current: "Plan actual: {plan}",
        fullAccess: "Acceso completo a todas las funcionalidades",
        managePlan: "Gestionar plan"
      },
      saveReminders: "Guardar recordatorios"
    }
  },
  en: {
    profile: {
      passkeys: {
        notAvailTitle: "Biometric access not available",
        notAvailSub: "Your device does not support biometric authentication.",
        registerErrorOptions: "Error getting registration options",
        registerErrorVerify: "Error registering",
        registerSuccess: "Successfully registered!",
        registerCancel: "Registration cancelled",
        registerGeneric: "Error registering biometric data",
        deleteError: "Error deleting credential.",
        title: "Biometric access",
        sub: "Sign in with your fingerprint or Face ID seamlessly",
        defaultDevice: "Device",
        emptyTitle: "Turn on fast sign-in",
        emptySub: "Register your fingerprint or Face ID to sign in to Cronix in seconds without a password.",
        inputPlaceholder: "Device name (e.g. \"Luis's iPhone\")",
        btnWaiting: "Waiting for authentication...",
        btnAnother: "+ Add another device",
        btnRegister: "Register fingerprint / Face ID"
      }
    },
    settings: {
      pushNotif: {
        title: "Push Notifications",
        denied: "Blocked — please enable in your browser settings",
        missingConfig: "Error: VAPID key not configured",
        unavailable: "Requires production build — try next build && next start",
        loading: "Processing...",
        active: "Active on this device",
        receiveAlerts: "Receive appointment alerts on this device",
        btnDisable: "Disable push notifications",
        btnEnable: "Enable push notifications"
      },
      plan: {
        current: "Current plan: {plan}",
        fullAccess: "Full access to all features",
        managePlan: "Manage plan"
      },
      saveReminders: "Save reminders"
    }
  }
}

// Fallback logic
const defaultTrans = updates.en
for (const loc of ['pt', 'fr', 'it', 'de']) {
  updates[loc] = defaultTrans
}

locales.forEach(loc => {
  const file = path.join(dir, `${loc}.json`)
  if (!fs.existsSync(file)) return
  
  let data = JSON.parse(fs.readFileSync(file, 'utf8'))
  
  // Inject Profile Passkeys
  if (!data.profile) data.profile = {}
  data.profile.passkeys = updates[loc].profile.passkeys
  
  // Inject Settings
  if (!data.settings) data.settings = {}
  data.settings.pushNotif = updates[loc].settings.pushNotif
  data.settings.plan = updates[loc].settings.plan
  data.settings.saveReminders = updates[loc].settings.saveReminders
  
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
  console.log(`✅ Injected missing texts for ${loc}`)
})
