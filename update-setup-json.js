const fs = require('fs');
const path = require('path');

const keys = {
  es: {
    welcome: '¡Bienvenido a Cronix!', subtitle: 'Sencillez y elegancia para gestionar tu negocio.',
    bizNameLabel: 'Nombre de tu negocio', bizNamePlace: 'Ej. Barbería El Elegante',
    categoryLabel: 'Categoría o rubro', categoryPlace: 'Selecciona una opción',
    createBtn: 'Crear mi cuenta de negocio', terms: 'Al crear tu negocio, aceptas nuestros términos de servicio y políticas de privacidad.'
  },
  en: {
    welcome: 'Welcome to Cronix!', subtitle: 'Simplicity and elegance to manage your business.',
    bizNameLabel: 'Your business name', bizNamePlace: 'E.g. Elegant Barbershop',
    categoryLabel: 'Category', categoryPlace: 'Select an option',
    createBtn: 'Create my business account', terms: 'By creating your business, you accept our terms of service and privacy policies.'
  },
  pt: {
    welcome: 'Bem-vindo ao Cronix!', subtitle: 'Simplicidade e elegância para gerenciar seu negócio.',
    bizNameLabel: 'Nome do seu negócio', bizNamePlace: 'Ex. Barbearia Elegante',
    categoryLabel: 'Categoria', categoryPlace: 'Selecione uma opção',
    createBtn: 'Criar minha conta de negócio', terms: 'Ao criar seu negócio, você aceita nossos termos de serviço e políticas de privacidade.'
  },
  fr: {
    welcome: 'Bienvenue sur Cronix!', subtitle: 'Simplicité et élégance pour gérer votre entreprise.',
    bizNameLabel: 'Nom de votre entreprise', bizNamePlace: 'Ex. Salon Élégant',
    categoryLabel: 'Catégorie', categoryPlace: 'Sélectionnez une option',
    createBtn: 'Créer mon compte professionnel', terms: 'En créant votre entreprise, vous acceptez nos conditions d\'utilisation et politiques de confidentialité.'
  },
  it: {
    welcome: 'Benvenuto in Cronix!', subtitle: 'Semplicità ed eleganza per gestire il tuo business.',
    bizNameLabel: 'Nome del tuo business', bizNamePlace: 'Es. Barbiere Elegante',
    categoryLabel: 'Categoria', categoryPlace: 'Seleziona un\'opzione',
    createBtn: 'Crea il mio account business', terms: 'Creando il tuo business, accetti i nostri termini di servizio e le politiche sulla privacy.'
  },
  de: {
    welcome: 'Willkommen bei Cronix!', subtitle: 'Einfachheit und Eleganz zur Verwaltung Ihres Unternehmens.',
    bizNameLabel: 'Ihr Firmenname', bizNamePlace: 'Z.B. Eleganter Friseur',
    categoryLabel: 'Kategorie', categoryPlace: 'Wählen Sie eine Option',
    createBtn: 'Mein Geschäftskonto erstellen', terms: 'Mit der Erstellung Ihres Geschäfts akzeptieren Sie unsere Nutzungsbedingungen und Datenschutzrichtlinien.'
  }
};

for (const lang of Object.keys(keys)) {
  const filePath = path.join('messages', `${lang}.json`);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    data.setup = keys[lang];
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
}
console.log('JSONs updated for setup translations!');
