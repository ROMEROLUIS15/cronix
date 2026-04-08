const fs = require('fs')
const path = require('path')

const locales = ['es', 'en', 'pt', 'fr', 'it', 'de']
const dir = path.join(__dirname, 'messages')

const translations = {
  es: {
    welcomeBack: "Bienvenido de nuevo",
    welcomeBackDesc: "Ingresa tus credenciales para acceder a tu cuenta"
  },
  en: {
    welcomeBack: "Welcome back",
    welcomeBackDesc: "Enter your credentials to access your account"
  },
  pt: {
    welcomeBack: "Bem-vindo de volta",
    welcomeBackDesc: "Insira suas credenciais para acessar sua conta"
  },
  fr: {
    welcomeBack: "Content de vous revoir",
    welcomeBackDesc: "Entrez vos identifiants pour accéder à votre compte"
  },
  it: {
    welcomeBack: "Bentornato",
    welcomeBackDesc: "Inserisci le tue credenziali per accedere al tuo account"
  },
  de: {
    welcomeBack: "Willkommen zurück",
    welcomeBackDesc: "Geben Sie Ihre Anmeldedaten ein, um auf Ihr Konto zuzugreifen"
  }
}

locales.forEach(loc => {
  const file = path.join(dir, `${loc}.json`)
  if (!fs.existsSync(file)) return
  
  let data = JSON.parse(fs.readFileSync(file, 'utf8'))
  
  if (!data.auth) data.auth = {}
  if (!data.auth.login) data.auth.login = {}
  
  const trans = translations[loc] || translations.en
  
  data.auth.login.welcomeBack = trans.welcomeBack
  data.auth.login.welcomeBackDesc = trans.welcomeBackDesc
  
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
  console.log(`✅ Injected login translations for ${loc}`)
})
