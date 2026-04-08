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
  },
  pt: {
    txtTitle: "Relatório de Desempenho",
    txtTotalApp: "Total de agendamentos:",
    txtCompletedApp: "Concluídos:",
    txtCancelledApp: "Cancelados:",
    txtTotalClients: "Total de clientes:",
    txtIncome: "Receita Total:",
    txtExpenses: "Despesas Totais:",
    txtNetProfit: "Lucro Líquido:",
    txtPopularServices: "Serviços Populares:",
    txtAppSuffix: "agendamentos",
    cards: {
      appointments: { title: "Agendamentos", sub: "Status e tendências", period: "Mês atual" },
      finances: { title: "Finanças", sub: "Receitas e despesas", period: "Mês atual" },
      clients: { title: "Clientes", sub: "Novos registros", period: "Mês atual" },
      services: { title: "Serviços", sub: "Mais populares", period: "Mês atual" }
    },
    subtitle: "Desempenho e estatísticas do negócio",
    export: "Exportar",
    stats: {
      incomeMonth: "Receita do Mês",
      totalApp: "Agendamentos Totais",
      clientsReg: "Clientes Registrados",
      total: "Total",
      completed: "Concluídos",
      cancelled: "Cancelados",
      income: "Receita",
      expenses: "Despesas",
      netProfit: "Lucro Líquido"
    },
    sections: {
      appointments: "Agendamentos",
      finances: "Finanças",
      services: "Serviços",
      clients: "Clientes"
    },
    misc: {
      latestAppointments: "Últimos Agendamentos",
      noAppointments: "Sem agendamentos neste período.",
      appointmentsCount: "{count} agendamentos",
      clientsCountLabel: "Clientes ativos no banco de dados"
    }
  },
  fr: {
    txtTitle: "Rapport de Performance",
    txtTotalApp: "Total des rendez-vous :",
    txtCompletedApp: "Terminés :",
    txtCancelledApp: "Annulés :",
    txtTotalClients: "Clients totaux :",
    txtIncome: "Revenus totaux :",
    txtExpenses: "Dépenses totales :",
    txtNetProfit: "Bénéfice net :",
    txtPopularServices: "Services populaires :",
    txtAppSuffix: "rendez-vous",
    cards: {
      appointments: { title: "Rendez-vous", sub: "Statuts et tendances", period: "Mois actuel" },
      finances: { title: "Finances", sub: "Revenus et dépenses", period: "Mois actuel" },
      clients: { title: "Clients", sub: "Nouvelles inscriptions", period: "Mois actuel" },
      services: { title: "Services", sub: "Les plus populaires", period: "Mois actuel" }
    },
    subtitle: "Performance et statistiques de l'entreprise",
    export: "Exporter",
    stats: {
      incomeMonth: "Revenu Mensuel",
      totalApp: "Rendez-vous Totaux",
      clientsReg: "Clients Inscrits",
      total: "Total",
      completed: "Terminés",
      cancelled: "Annulés",
      income: "Revenus",
      expenses: "Dépenses",
      netProfit: "Bénéfice Net"
    },
    sections: {
      appointments: "Rendez-vous",
      finances: "Finances",
      services: "Services",
      clients: "Clients"
    },
    misc: {
      latestAppointments: "Derniers Rendez-vous",
      noAppointments: "Aucun rendez-vous pour cette période.",
      appointmentsCount: "{count} rendez-vous",
      clientsCountLabel: "Clients actifs dans la base"
    }
  },
  it: {
    txtTitle: "Rapporto di Rendimento",
    txtTotalApp: "Appuntamenti totali:",
    txtCompletedApp: "Completati:",
    txtCancelledApp: "Annullati:",
    txtTotalClients: "Clienti totali:",
    txtIncome: "Entrate Totali:",
    txtExpenses: "Spese Totali:",
    txtNetProfit: "Utile Netto:",
    txtPopularServices: "Servizi Popolari:",
    txtAppSuffix: "appuntamenti",
    cards: {
      appointments: { title: "Appuntamenti", sub: "Stato e tendenze", period: "Mese attuale" },
      finances: { title: "Finanze", sub: "Entrate e spese", period: "Mese attuale" },
      clients: { title: "Clienti", sub: "Nuove registrazioni", period: "Mese attuale" },
      services: { title: "Servizi", sub: "Più popolari", period: "Mese attuale" }
    },
    subtitle: "Prestazioni e statistiche aziendali",
    export: "Esporta",
    stats: {
      incomeMonth: "Entrate del Mese",
      totalApp: "Appuntamenti Totali",
      clientsReg: "Clienti Registrati",
      total: "Totale",
      completed: "Completati",
      cancelled: "Annullati",
      income: "Entrate",
      expenses: "Spese",
      netProfit: "Utile Netto"
    },
    sections: {
      appointments: "Appuntamenti",
      finances: "Finanze",
      services: "Servizi",
      clients: "Clienti"
    },
    misc: {
      latestAppointments: "Ultimi Appuntamenti",
      noAppointments: "Nessun appuntamento in questo periodo.",
      appointmentsCount: "{count} appuntamenti",
      clientsCountLabel: "Clienti attivi nel database"
    }
  },
  de: {
    txtTitle: "Leistungsbericht",
    txtTotalApp: "Termine insgesamt:",
    txtCompletedApp: "Abgeschlossen:",
    txtCancelledApp: "Storniert:",
    txtTotalClients: "Kunden insgesamt:",
    txtIncome: "Gesamteinnahmen:",
    txtExpenses: "Gesamtausgaben:",
    txtNetProfit: "Nettogewinn:",
    txtPopularServices: "Beliebte Dienstleistungen:",
    txtAppSuffix: "termine",
    cards: {
      appointments: { title: "Termine", sub: "Status und Trends", period: "Aktueller Monat" },
      finances: { title: "Finanzen", sub: "Einnahmen und Ausgaben", period: "Aktueller Monat" },
      clients: { title: "Kunden", sub: "Neuregistrierungen", period: "Aktueller Monat" },
      services: { title: "Verwaltung", sub: "Am beliebtesten", period: "Aktueller Monat" }
    },
    subtitle: "Unternehmensleistung & Statistiken",
    export: "Exportieren",
    stats: {
      incomeMonth: "Monatliche Einnahmen",
      totalApp: "Gesamte Termine",
      clientsReg: "Registrierte Kunden",
      total: "Gesamt",
      completed: "Abgeschlossen",
      cancelled: "Storniert",
      income: "Einnahmen",
      expenses: "Ausgaben",
      netProfit: "Nettogewinn"
    },
    sections: {
      appointments: "Termine",
      finances: "Finanzen",
      services: "Dienstleistungen",
      clients: "Kunden"
    },
    misc: {
      latestAppointments: "Letzte Termine",
      noAppointments: "Keine Termine in diesem Zeitraum.",
      appointmentsCount: "{count} termine",
      clientsCountLabel: "Aktive Kunden in der Datenbank"
    }
  }
}

locales.forEach(loc => {
  const file = path.join(dir, `${loc}.json`)
  if (!fs.existsSync(file)) return
  
  let data = JSON.parse(fs.readFileSync(file, 'utf8'))
  
  if (!data.reports) data.reports = {}
  const trans = reportsTranslations[loc] || reportsTranslations.en
  
  data.reports = { ...data.reports, ...trans }
  
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
  console.log(`✅ Injected real reports translations for ${loc}`)
})
