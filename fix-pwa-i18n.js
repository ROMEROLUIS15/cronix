const fs = require('fs');
const path = require('path');

const locales = ['es', 'en', 'pt', 'fr', 'it', 'de'];
const dir = path.join(__dirname, 'messages');

const pwaTranslations = {
  es: {
    downloadApp: "Descargar App",
    subtitle: "Notificaciones y acceso rápido.",
    installedAlert: "¡Cronix ya está instalado en tu equipo! Puedes abrirlo desde tu escritorio o menú de aplicaciones.",
    browserError: "El instalador aún se está cargando o tu navegador no soporta instalaciones automáticas. Intenta usar el icono de la barra de direcciones.",
    installed: "Instalada",
    install: "Instalar",
    get: "Obtener",
    iosGuideTitle: "Instalar en iPhone / iPad",
    iosStep1: "1. Toca el ícono de compartir ⬆ en Safari",
    iosStep2: "2. Selecciona \"Añadir a pantalla de inicio\"",
    iosStep3: "3. Toca \"Añadir\" para confirmar",
    installFree: "Instalar app gratis",
    getAppIos: "Obtener App (iOS)",
    close: "Cerrar",
    pwaTag: "PWA"
  },
  en: {
    downloadApp: "Download App",
    subtitle: "Notifications and quick access.",
    installedAlert: "Cronix is already installed! You can open it from your desktop or app menu.",
    browserError: "The installer is loading or your browser doesn't support automatic installation. Try using the address bar icon.",
    installed: "Installed",
    install: "Install",
    get: "Get",
    iosGuideTitle: "Install on iPhone / iPad",
    iosStep1: "1. Tap the share icon ⬆ in Safari",
    iosStep2: "2. Select \"Add to Home Screen\"",
    iosStep3: "3. Tap \"Add\" to confirm",
    installFree: "Install free app",
    getAppIos: "Get App (iOS)",
    close: "Close",
    pwaTag: "PWA"
  },
  pt: {
    downloadApp: "Baixar App",
    subtitle: "Notificações e acesso rápido.",
    installedAlert: "O Cronix já está instalado! Você pode abri-lo no seu desktop ou menu de aplicativos.",
    browserError: "O instalador ainda está carregando ou seu navegador não suporta a instalação. Tente usar o ícone na barra de endereços.",
    installed: "Instalado",
    install: "Instalar",
    get: "Obter",
    iosGuideTitle: "Instalar no iPhone / iPad",
    iosStep1: "1. Toque no ícone de compartilhar ⬆ no Safari",
    iosStep2: "2. Selecione \"Adicionar à Tela de Início\"",
    iosStep3: "3. Toque em \"Adicionar\" para confirmar",
    installFree: "Instalar app grátis",
    getAppIos: "Obter App (iOS)",
    close: "Fechar",
    pwaTag: "PWA"
  },
  fr: {
    downloadApp: "Télécharger l'App",
    subtitle: "Notifications et accès rapide.",
    installedAlert: "Cronix est déjà installé ! Vous pouvez l'ouvrir depuis votre bureau ou menu des applications.",
    browserError: "L'installateur charge ou votre navigateur ne supporte pas l'installation auto. Essayez l'icône de la barre d'adresse.",
    installed: "Installé",
    install: "Installer",
    get: "Obtenir",
    iosGuideTitle: "Installer sur iPhone / iPad",
    iosStep1: "1. Appuyez sur l'icône de partage ⬆ dans Safari",
    iosStep2: "2. Sélectionnez \"Sur l'écran d'accueil\"",
    iosStep3: "3. Appuyez sur \"Ajouter\" pour confirmer",
    installFree: "Installer l'app gratuite",
    getAppIos: "Obtenir l'App (iOS)",
    close: "Fermer",
    pwaTag: "PWA"
  },
  it: {
    downloadApp: "Scarica App",
    subtitle: "Notifiche e accesso rapido.",
    installedAlert: "Cronix è già installato! Puoi aprirlo dal desktop o dal menu delle app.",
    browserError: "Il programma di installazione è in caricamento o il tuo browser non supporta l'installazione automatica. Prova a usare l'icona della barra degli indirizzi.",
    installed: "Installato",
    install: "Installa",
    get: "Ottieni",
    iosGuideTitle: "Installa su iPhone / iPad",
    iosStep1: "1. Tocca l'icona di condivisione ⬆ su Safari",
    iosStep2: "2. Seleziona \"Aggiungi alla schermata Home\"",
    iosStep3: "3. Tocca \"Aggiungi\" per confermare",
    installFree: "Installa app gratis",
    getAppIos: "Ottieni App (iOS)",
    close: "Chiudi",
    pwaTag: "PWA"
  },
  de: {
    downloadApp: "App herunterladen",
    subtitle: "Benachrichtigungen und Schnellzugriff.",
    installedAlert: "Cronix ist bereits installiert! Sie können es vom Desktop oder App-Menü aus öffnen.",
    browserError: "Der Installer lädt noch oder Ihr Browser unterstützt keine automatische Installation. Versuchen Sie das Symbol in der Adressleiste.",
    installed: "Installiert",
    install: "Installieren",
    get: "Holen",
    iosGuideTitle: "Auf iPhone / iPad installieren",
    iosStep1: "1. Tippen Sie auf das Teilen-Symbol ⬆ in Safari",
    iosStep2: "2. Wählen Sie \"Zum Home-Bildschirm\"",
    iosStep3: "3. Tippen Sie zur Bestätigung auf \"Hinzufügen\"",
    installFree: "Kostenlose App installieren",
    getAppIos: "App holen (iOS)",
    close: "Schließen",
    pwaTag: "PWA"
  }
};

locales.forEach(loc => {
  const file = path.join(dir, `${loc}.json`);
  if (!fs.existsSync(file)) return;
  
  let data = JSON.parse(fs.readFileSync(file, 'utf8'));
  
  data.pwa = pwaTranslations[loc];
  
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
});
console.log('✅ PWA translations injected!');
