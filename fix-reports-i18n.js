const fs = require('fs')
const path = require('path')

const locales = ['es', 'en', 'pt', 'fr', 'it', 'de']
const dir = path.join(__dirname, 'messages')

const reportsTranslations = {
  es: {
    txtTitle: "Reporte de Rendimiento",
    txtTotalApp: "Total de citas:",
    txtCompletedApp: "Completadas:",
    txtCancelledApp: "Canceladas:",
    txtTotalClients: "Total de clientes:",
    txtIncome: "Ingresos Totales:",
    txtExpenses: "Gastos Totales:",
    txtNetProfit: "Beneficio Neto:",
    txtPopularServices: "Servicios Populares:",
    txtAppSuffix: "citas",
    cards: {
      appointments: { title: "Citas", sub: "Estado y tendencias", period: "Mes actual" },
      finances: { title: "Finanzas", sub: "Ingresos y gastos", period: "Mes actual" },
      clients: { title: "Clientes", sub: "Nuevos registros", period: "Mes actual" },
      services: { title: "Servicios", sub: "Los más populares", period: "Mes actual" }
    },
    subtitle: "Rendimiento y estadísticas de tu negocio",
    export: "Exportar",
    stats: {
      incomeMonth: "Ingresos del mes",
      totalApp: "Citas totales",
      clientsReg: "Clientes registrados",
      total: "Total",
      completed: "Completadas",
      cancelled: "Canceladas",
      income: "Ingresos",
      expenses: "Gastos",
      netProfit: "Beneficio Neto"
    },
    sections: {
      appointments: "Citas",
      finances: "Finanzas",
      services: "Servicios",
      clients: "Clientes"
    },
    misc: {
      latestAppointments: "Últimas Citas",
      noAppointments: "Sin citas en este período.",
      appointmentsCount: "{count} citas",
      clientsCountLabel: "Clientes activos en base de datos"
    }
  },
  en: {
    txtTitle: "Performance Report",
    txtTotalApp: "Total appointments:",
    txtCompletedApp: "Completed:",
    txtCancelledApp: "Cancelled:",
    txtTotalClients: "Total clients:",
    txtIncome: "Total Income:",
    txtExpenses: "Total Expenses:",
    txtNetProfit: "Net Profit:",
    txtPopularServices: "Popular Services:",
    txtAppSuffix: "appointments",
    cards: {
      appointments: { title: "Appointments", sub: "Status and trends", period: "Current month" },
      finances: { title: "Finances", sub: "Income and expenses", period: "Current month" },
      clients: { title: "Clients", sub: "New registrations", period: "Current month" },
      services: { title: "Services", sub: "Most popular", period: "Current month" }
    },
    subtitle: "Business performance & statistics",
    export: "Export",
    stats: {
      incomeMonth: "Monthly Income",
      totalApp: "Total Appointments",
      clientsReg: "Registered Clients",
      total: "Total",
      completed: "Completed",
      cancelled: "Cancelled",
      income: "Income",
      expenses: "Expenses",
      netProfit: "Net Profit"
    },
    sections: {
      appointments: "Appointments",
      finances: "Finances",
      services: "Services",
      clients: "Clients"
    },
    misc: {
      latestAppointments: "Latest Appointments",
      noAppointments: "No appointments this period.",
      appointmentsCount: "{count} appointments",
      clientsCountLabel: "Active clients in database"
    }
  }
}

// Fallback logic for other languages copying EN
const defaultTrans = reportsTranslations.en
for (const loc of ['pt', 'fr', 'it', 'de']) {
  reportsTranslations[loc] = defaultTrans
}

locales.forEach(loc => {
  const file = path.join(dir, `${loc}.json`)
  if (!fs.existsSync(file)) return
  
  let data = JSON.parse(fs.readFileSync(file, 'utf8'))
  
  if (!data.reports) data.reports = {}
  const trans = reportsTranslations[loc]
  
  // Merge keys
  data.reports = { ...data.reports, ...trans }
  
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
  console.log(`✅ Injected missing reports translations for ${loc}`)
})
