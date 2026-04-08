const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'messages');
const locales = ['es', 'en', 'pt', 'fr', 'it', 'de'];

const translations = {
  es: {
    profile: {
      passkeys: {
        title: "Acceso biométrico",
        sub: "Inicia sesión con tu huella o Face ID sin contraseña",
        notAvailTitle: "Acceso biométrico no disponible",
        notAvailSub: "Tu dispositivo no soporta autenticación biométrica.",
        registerErrorOptions: "Error al obtener opciones de registro",
        registerErrorVerify: "Error al registrar",
        registerSuccess: "¡Huella registrada correctamente!",
        registerCancel: "Registro cancelado",
        registerGeneric: "Error al registrar la huella",
        deleteError: "Error al eliminar la credencial.",
        emptyTitle: "Activa el acceso rápido con tu huella",
        emptySub: "Registra tu huella o Face ID para ingresar a Cronix en segundos, sin escribir tu contraseña.",
        inputPlaceholder: "Nombre del dispositivo (ej: \"iPhone de Luis\")",
        btnWaiting: "Esperando autenticación...",
        btnAnother: "+ Agregar otro dispositivo",
        btnRegister: "Registrar huella / Face ID",
        defaultDevice: "Dispositivo"
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
        title: "Biometric Access",
        sub: "Sign in with your fingerprint or Face ID seamlessly",
        notAvailTitle: "Biometric access not available",
        notAvailSub: "Your device does not support biometric authentication.",
        registerErrorOptions: "Error getting registration options",
        registerErrorVerify: "Error registering",
        registerSuccess: "Successfully registered!",
        registerCancel: "Registration cancelled",
        registerGeneric: "Error registering biometric data",
        deleteError: "Error deleting credential.",
        emptyTitle: "Turn on fast sign-in",
        emptySub: "Register your fingerprint or Face ID to sign in to Cronix in seconds without a password.",
        inputPlaceholder: "Device name (e.g. \"Luis's iPhone\")",
        btnWaiting: "Waiting for authentication...",
        btnAnother: "+ Add another device",
        btnRegister: "Register fingerprint / Face ID",
        defaultDevice: "Device"
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
  },
  pt: {
    profile: {
      passkeys: {
        title: "Acesso Biométrico",
        sub: "Faça login com sua impressão digital ou Face ID sem senha",
        notAvailTitle: "Acesso biométrico indisponível",
        notAvailSub: "Seu dispositivo não suporta autenticação biométrica.",
        registerErrorOptions: "Erro ao obter opções de registro",
        registerErrorVerify: "Erro ao registrar",
        registerSuccess: "Impressão digital registrada com sucesso!",
        registerCancel: "Registro cancelado",
        registerGeneric: "Erro ao registrar a impressão digital",
        deleteError: "Erro ao excluir a credencial.",
        emptyTitle: "Ative o login rápido",
        emptySub: "Registre sua impressão digital ou Face ID para entrar no Cronix em segundos sem senha.",
        inputPlaceholder: "Nome do dispositivo (ex: \"iPhone do Luis\")",
        btnWaiting: "Aguardando autenticação...",
        btnAnother: "+ Adicionar outro dispositivo",
        btnRegister: "Registrar impressão digital / Face ID",
        defaultDevice: "Dispositivo"
      }
    },
    settings: {
      pushNotif: {
        title: "Notificações Push",
        denied: "Bloqueadas — por favor, ative nas configurações do seu navegador",
        missingConfig: "Erro: chave VAPID não configurada",
        unavailable: "Requer build de produção — tente next build && next start",
        loading: "Processando...",
        active: "Ativo neste dispositivo",
        receiveAlerts: "Receba alertas de compromissos neste dispositivo",
        btnDisable: "Desativar notificações push",
        btnEnable: "Ativar notificações push"
      },
      plan: {
        current: "Plano atual: {plan}",
        fullAccess: "Acesso total a todos os recursos",
        managePlan: "Gerenciar plano"
      },
      saveReminders: "Salvar lembretes"
    }
  },
  fr: {
    profile: {
      passkeys: {
        title: "Accès Biométrique",
        sub: "Connectez-vous avec votre empreinte digitale ou Face ID sans mot de passe",
        notAvailTitle: "Accès biométrique non disponible",
        notAvailSub: "Votre appareil ne prend pas en charge l'authentification biométrique.",
        registerErrorOptions: "Erreur lors de l'obtention des options d'enregistrement",
        registerErrorVerify: "Erreur d'enregistrement",
        registerSuccess: "Empreinte digitale enregistrée avec succès !",
        registerCancel: "Enregistrement annulé",
        registerGeneric: "Erreur lors de l'enregistrement de l'empreinte",
        deleteError: "Erreur lors de la suppression de l'identifiant.",
        emptyTitle: "Activez la connexion rapide",
        emptySub: "Enregistrez votre empreinte digitale ou Face ID pour vous connecter à Cronix en quelques secondes sans mot de passe.",
        inputPlaceholder: "Nom de l'appareil (ex. \"iPhone de Luis\")",
        btnWaiting: "En attente d'authentification...",
        btnAnother: "+ Ajouter un autre appareil",
        btnRegister: "Enregistrer l'empreinte / Face ID",
        defaultDevice: "Appareil"
      }
    },
    settings: {
      pushNotif: {
        title: "Notifications Push",
        denied: "Bloquées — veuillez les activer dans les paramètres de votre navigateur",
        missingConfig: "Erreur : Clé VAPID non configurée",
        unavailable: "Nécessite une build de production — essayez next build && next start",
        loading: "Traitement en cours...",
        active: "Actif sur cet appareil",
        receiveAlerts: "Recevez les alertes de rendez-vous sur cet appareil",
        btnDisable: "Désactiver les notifications push",
        btnEnable: "Activer les notifications push"
      },
      plan: {
        current: "Forfait actuel : {plan}",
        fullAccess: "Accès complet à toutes les fonctionnalités",
        managePlan: "Gérer le forfait"
      },
      saveReminders: "Enregistrer les rappels"
    }
  },
  it: {
    profile: {
      passkeys: {
        title: "Accesso Biometrico",
        sub: "Accedi con la tua impronta digitale o Face ID senza password",
        notAvailTitle: "Accesso biometrico non disponibile",
        notAvailSub: "Il tuo dispositivo non supporta l'autenticazione biometrica.",
        registerErrorOptions: "Errore durante l'ottenimento delle opzioni di registrazione",
        registerErrorVerify: "Errore di registrazione",
        registerSuccess: "Impronta digitale registrata con successo!",
        registerCancel: "Registrazione annullata",
        registerGeneric: "Errore durante la registrazione dell'impronta",
        deleteError: "Errore durante l'eliminazione delle credenziali.",
        emptyTitle: "Attiva l'accesso rapido",
        emptySub: "Registra la tua impronta digitale o Face ID per accedere a Cronix in pochi secondi senza password.",
        inputPlaceholder: "Nome dispositivo (es: \"iPhone di Luis\")",
        btnWaiting: "In attesa di autenticazione...",
        btnAnother: "+ Aggiungi un altro dispositivo",
        btnRegister: "Registra impronta / Face ID",
        defaultDevice: "Dispositivo"
      }
    },
    settings: {
      pushNotif: {
        title: "Notifiche Push",
        denied: "Bloccate — attivale nelle impostazioni del browser",
        missingConfig: "Errore: chiave VAPID non configurata",
        unavailable: "Richiede build di produzione — prova next build && next start",
        loading: "Elaborazione in corso...",
        active: "Attivo su questo dispositivo",
        receiveAlerts: "Ricevi avvisi per gli appuntamenti su questo dispositivo",
        btnDisable: "Disattiva le notifiche push",
        btnEnable: "Attiva le notifiche push"
      },
      plan: {
        current: "Piano attuale: {plan}",
        fullAccess: "Accesso completo a tutte le funzionalità",
        managePlan: "Gestisci piano"
      },
      saveReminders: "Salva i promemoria"
    }
  },
  de: {
    profile: {
      passkeys: {
        title: "Biometrischer Zugang",
        sub: "Melden Sie sich mit Ihrem Fingerabdruck oder Face ID ohne Passwort an",
        notAvailTitle: "Biometrischer Zugang nicht verfügbar",
        notAvailSub: "Ihr Gerät unterstützt keine biometrische Authentifizierung.",
        registerErrorOptions: "Fehler beim Abrufen der Registrierungsoptionen",
        registerErrorVerify: "Registrierungsfehler",
        registerSuccess: "Fingerabdruck erfolgreich registriert!",
        registerCancel: "Registrierung abgebrochen",
        registerGeneric: "Fehler bei der Fingerabdruck-Registrierung",
        deleteError: "Fehler beim Löschen der Anmeldeinformationen.",
        emptyTitle: "Schnellanmeldung aktivieren",
        emptySub: "Registrieren Sie Ihren Fingerabdruck oder Face ID, um sich in Sekundenschnelle ohne Passwort bei Cronix anzumelden.",
        inputPlaceholder: "Gerätename (z.B. \"Luis' iPhone\")",
        btnWaiting: "Warten auf Authentifizierung...",
        btnAnother: "+ Weiteres Gerät hinzufügen",
        btnRegister: "Fingerabdruck / Face ID registrieren",
        defaultDevice: "Gerät"
      }
    },
    settings: {
      pushNotif: {
        title: "Push-Benachrichtigungen",
        denied: "Blockiert — bitte in den Browsereinstellungen aktivieren",
        missingConfig: "Fehler: VAPID-Schlüssel nicht konfiguriert",
        unavailable: "Erfordert Produktions-Build — versuchen Sie next build && next start",
        loading: "Verarbeitung läuft...",
        active: "Auf diesem Gerät aktiv",
        receiveAlerts: "Erhalten Sie Terminbenachrichtigungen auf diesem Gerät",
        btnDisable: "Push-Benachrichtigungen deaktivieren",
        btnEnable: "Push-Benachrichtigungen aktivieren"
      },
      plan: {
        current: "Aktueller Plan: {plan}",
        fullAccess: "Voller Zugriff auf alle Funktionen",
        managePlan: "Plan verwalten"
      },
      saveReminders: "Erinnerungen speichern"
    }
  }
};

locales.forEach(loc => {
  const file = path.join(dir, `${loc}.json`);
  if (!fs.existsSync(file)) return;
  
  let data = JSON.parse(fs.readFileSync(file, 'utf8'));
  
  // Inject profile keys properly
  if (!data.profile) data.profile = {};
  data.profile.passkeys = translations[loc].profile.passkeys;
  
  // Inject settings keys properly
  if (!data.settings) data.settings = {};
  data.settings.pushNotif = translations[loc].settings.pushNotif;
  data.settings.plan = translations[loc].settings.plan;
  data.settings.saveReminders = translations[loc].settings.saveReminders;
  
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`✅ Fully translated injected for ${loc}`);
});
