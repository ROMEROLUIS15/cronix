const fs = require('fs');
const path = require('path');

const locales = ['es', 'en', 'pt', 'fr', 'it', 'de'];
const dir = path.join(__dirname, 'messages');

const pwaTranslationsExtras = {
  es: {
    toastTitle: "Nueva versión disponible",
    toastDesc: "Actualiza para obtener las últimas mejoras",
    toastBtn: "Actualizar"
  },
  en: {
    toastTitle: "New version available",
    toastDesc: "Update to get the latest improvements",
    toastBtn: "Update"
  },
  pt: {
    toastTitle: "Nova versão disponível",
    toastDesc: "Atualize para obter as últimas melhorias",
    toastBtn: "Atualizar"
  },
  fr: {
    toastTitle: "Nouvelle version",
    toastDesc: "Mettez à jour pour les dernières améliorations",
    toastBtn: "Mettre à jour"
  },
  it: {
    toastTitle: "Nuova versione disponibile",
    toastDesc: "Aggiorna per ottenere gli ultimi miglioramenti",
    toastBtn: "Aggiorna"
  },
  de: {
    toastTitle: "Neue Version verfügbar",
    toastDesc: "Aktualisieren Sie für die neuesten Verbesserungen",
    toastBtn: "Aktualisieren"
  }
};

locales.forEach(loc => {
  const file = path.join(dir, `${loc}.json`);
  if (!fs.existsSync(file)) return;
  
  let data = JSON.parse(fs.readFileSync(file, 'utf8'));
  
  if (!data.pwa) data.pwa = {};
  
  Object.assign(data.pwa, pwaTranslationsExtras[loc]);
  
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
});
console.log('✅ PWA updates translations injected!');
