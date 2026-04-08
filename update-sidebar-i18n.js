const fs = require('fs');
const path = require('path');

const locales = ['es', 'en', 'pt', 'fr', 'de', 'it'];
const messagesDir = path.join(__dirname, 'messages');

const translations = {
  es: {
    pulse: "Pulso del Sistema",
    role_platform_admin: "Admin de Plataforma",
    role_owner: "Propietario",
    role_staff: "Personal",
    sectionLabel: "Principal"
  },
  en: {
    pulse: "System Pulse",
    role_platform_admin: "Platform Admin",
    role_owner: "Owner",
    role_staff: "Staff",
    sectionLabel: "Main"
  },
  pt: {
    pulse: "Pulso do Sistema",
    role_platform_admin: "Admin da Plataforma",
    role_owner: "Proprietário",
    role_staff: "Equipe",
    sectionLabel: "Principal"
  },
  fr: {
    pulse: "Pouls du Système",
    role_platform_admin: "Admin Plateforme",
    role_owner: "Propriétaire",
    role_staff: "Personnel",
    sectionLabel: "Principal"
  },
  de: {
    pulse: "System-Puls",
    role_platform_admin: "Plattform-Admin",
    role_owner: "Inhaber",
    role_staff: "Personal",
    sectionLabel: "Hauptsächlich"
  },
  it: {
    pulse: "Polso del Sistema",
    role_platform_admin: "Admin Piattaforma",
    role_owner: "Proprietario",
    role_staff: "Personale",
    sectionLabel: "Principale"
  }
};

let updatedCount = 0;

for (const locale of locales) {
  const filePath = path.join(messagesDir, `${locale}.json`);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Archivo no encontrado: ${filePath}`);
    continue;
  }

  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const json = JSON.parse(fileContent);

    if (!json.nav) {
      json.nav = {};
    }

    // Force overwrite for accurate translation
    for (const [key, value] of Object.entries(translations[locale])) {
      json.nav[key] = value;
    }

    fs.writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf8');
    console.log(`✅ ${locale.toUpperCase()} actualizado exitosamente con Sidebar Nav i18n.`);
    updatedCount++;
  } catch (error) {
    console.error(`❌ Error actualizando ${locale}:`, error.message);
  }
}

console.log(`\n🎉 Operación completada: ${updatedCount}/${locales.length} idiomas actualizados.`);
