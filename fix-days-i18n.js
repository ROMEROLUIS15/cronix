const fs = require('fs')
const path = require('path')

const locales = ['es', 'en', 'pt', 'fr', 'it', 'de']
const dir = path.join(__dirname, 'messages')

const days = {
  es: { mon: "Lunes", tue: "Martes", wed: "Miércoles", thu: "Jueves", fri: "Viernes", sat: "Sábado", sun: "Domingo" },
  en: { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" },
  pt: { mon: "Segunda-feira", tue: "Terça-feira", wed: "Quarta-feira", thu: "Quinta-feira", fri: "Sexta-feira", sat: "Sábado", sun: "Domingo" },
  fr: { mon: "Lundi", tue: "Mardi", wed: "Mercredi", thu: "Jeudi", fri: "Vendredi", sat: "Samedi", sun: "Dimanche" },
  it: { mon: "Lunedì", tue: "Martedì", wed: "Mercoledì", thu: "Giovedì", fri: "Venerdì", sat: "Sabato", sun: "Domenica" },
  de: { mon: "Montag", tue: "Dienstag", wed: "Mittwoch", thu: "Donnerstag", fri: "Freitag", sat: "Samstag", sun: "Sonntag" }
}

const savedAs = {
  es: "Se guardará como",
  en: "Will be saved as",
  pt: "Será salvo como",
  fr: "Sera enregistré comme",
  it: "Verrà salvato come",
  de: "Wird gespeichert als"
}

locales.forEach(loc => {
  const file = path.join(dir, `${loc}.json`)
  if (!fs.existsSync(file)) return
  
  let data = JSON.parse(fs.readFileSync(file, 'utf8'))
  
  // Inject days
  if (!data.settings) data.settings = {}
  data.settings.days = days[loc] || days.en
  
  // Inject savedAs
  if (!data.common) data.common = {}
  data.common.savedAs = savedAs[loc] || savedAs.en
  
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
  console.log(`✅ Injected days and savedAs for ${loc}`)
})
