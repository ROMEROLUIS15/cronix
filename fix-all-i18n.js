const fs = require('fs');
const path = require('path');

const missingTranslations = {
  es: {
    appointments: {
      subtitle: 'Administra todas tus citas y reuniones',
      newAppointment: 'Nueva cita',
      searchApt: 'Buscar...',
      day: 'Día',
      week: 'Semana',
      loadingAgenda: 'Cargando agenda...',
      noAptsTitle: 'No hay citas',
      noAptsDesc: 'No tienes citas programadas',
      scheduleApt: 'Agendar cita',
      unknownClient: 'Cliente desconocido',
      unmanaged: 'Sin gestionar',
      unassigned: 'Sin asignar',
      edit: 'Editar',
      pastAptCheck: 'Cita pasada',
      yesAttended: 'Sí, asistió',
      noShow: 'No asistió'
    },
    clients: {
      newClient: 'Nuevo cliente',
      searchPlaceholder: 'Buscar cliente...',
      clearSearch: 'Limpiar',
      totalClients: 'Total de clientes',
      vip: 'Cliente VIP',
      avgTicket: 'Ticket Promedio',
      noClients: 'Sin clientes',
      addFirstClient: 'Agrega tu primer cliente',
      visits: 'Visitas'
    },
    services: {
      newService: 'Nuevo servicio',
      editService: 'Editar',
      form: {
        name: 'Nombre',
        namePlaceholder: 'Nombre del servicio',
        category: 'Categoría',
        noCategory: 'Sin categoría',
        description: 'Descripción',
        descriptionPlaceholder: 'Breve descripción',
        duration: 'Duración (min)',
        durations: {
          '30': '30 minutos',
          '60': '1 hora',
          '90': '1 hora 30 minutos',
          '120': '2 horas',
          '150': '2 horas 30 minutos'
        },
        customDuration: 'Personalizada',
        customMin: 'Minutos',
        price: 'Precio',
        color: 'Color',
        active: 'Activo',
        cancel: 'Cancelar',
        save: 'Guardar',
        create: 'Crear'
      },
      noServices: 'Sin servicios',
      createFirst: 'Aún no hay servicios',
      createFirstBtn: 'Crear primer servicio',
      status: {
        inactive: 'Inactivo'
      },
      actions: {
        deactivate: 'Desactivar',
        activate: 'Activar'
      }
    },
    finances: {
      errorLoading: 'Error cargando datos',
      subtitle: 'Resumen financiero',
      registerExpense: 'Registrar gasto',
      registerIncome: 'Registrar ingreso',
      incomeMonth: 'Ingresos del mes',
      expenseMonth: 'Gastos del mes',
      netProfit: 'Beneficio neto',
      margin: 'Margen',
      distribution: 'Distribución',
      recentIncome: 'Ingresos recientes',
      viewAll: 'Ver todo',
      noIncomeMonth: 'No hay ingresos este mes',
      payment: 'Pago',
      discount: 'Descuento',
      recentExpenses: 'Gastos recientes',
      noExpenseMonth: 'No hay gastos este mes'
    },
    profile: {
      errorImgFormat: 'Formato incorrecto',
      errorImgSize: 'Tamaño excedido',
      errorUpload: 'Error al subir',
      successUpload: 'Imagen subida',
      errorDelete: 'Error al eliminar',
      successDelete: 'Imagen eliminada',
      subtitle: 'Administra tu perfil',
      changePhoto: 'Cambiar foto',
      uploadPhoto: 'Subir foto',
      deletePhoto: 'Eliminar',
      photoReqs: 'Requisitos de la foto',
      personalInfo: 'Información personal',
      fullname: 'Nombre completo',
      fullnameLabel: 'Tu nombre y apellido',
      phone: 'Teléfono',
      emailLabel: 'Correo electrónico',
      emailWarning: 'Aviso sobre el email',
      securityTitle: 'Seguridad',
      securitySubtitle: 'Contraseña y seguridad',
      cancel: 'Cancelar',
      changePasswordBtn: 'Cambiar contraseña',
      newPassword: 'Nueva contraseña',
      newPasswordLabel: 'Escribe tu nueva contraseña',
      confirmPassword: 'Confirmar contraseña',
      confirmPasswordLabel: 'Repite tu nueva contraseña',
      passwordSet: 'Contraseña establecida',
      saveProfile: 'Guardar perfil'
    }
  },
  en: {
    appointments: {
      subtitle: 'Manage all your appointments and meetings',
      newAppointment: 'New appointment',
      searchApt: 'Search...',
      day: 'Day',
      week: 'Week',
      loadingAgenda: 'Loading agenda...',
      noAptsTitle: 'No appointments',
      noAptsDesc: 'You have no scheduled appointments',
      scheduleApt: 'Schedule appointment',
      unknownClient: 'Unknown client',
      unmanaged: 'Unmanaged',
      unassigned: 'Unassigned',
      edit: 'Edit',
      pastAptCheck: 'Past appointment',
      yesAttended: 'Yes, attended',
      noShow: 'No show'
    },
    clients: {
      newClient: 'New client',
      searchPlaceholder: 'Search client...',
      clearSearch: 'Clear',
      totalClients: 'Total clients',
      vip: 'VIP Client',
      avgTicket: 'Average Ticket',
      noClients: 'No clients',
      addFirstClient: 'Add your first client',
      visits: 'Visits'
    },
    services: {
      newService: 'New service',
      editService: 'Edit',
      form: {
        name: 'Name',
        namePlaceholder: 'Service name',
        category: 'Category',
        noCategory: 'No category',
        description: 'Description',
        descriptionPlaceholder: 'Short description',
        duration: 'Duration (min)',
        durations: {
          '30': '30 minutes',
          '60': '1 hour',
          '90': '1 hour 30 mins',
          '120': '2 hours',
          '150': '2 hours 30 mins'
        },
        customDuration: 'Custom',
        customMin: 'Minutes',
        price: 'Price',
        color: 'Color',
        active: 'Active',
        cancel: 'Cancel',
        save: 'Save',
        create: 'Create'
      },
      noServices: 'No services',
      createFirst: 'No services yet',
      createFirstBtn: 'Create first service',
      status: {
        inactive: 'Inactive'
      },
      actions: {
        deactivate: 'Deactivate',
        activate: 'Activate'
      }
    },
    finances: {
      errorLoading: 'Error loading data',
      subtitle: 'Financial summary',
      registerExpense: 'Register expense',
      registerIncome: 'Register income',
      incomeMonth: 'Income this month',
      expenseMonth: 'Expenses this month',
      netProfit: 'Net profit',
      margin: 'Margin',
      distribution: 'Distribution',
      recentIncome: 'Recent income',
      viewAll: 'View all',
      noIncomeMonth: 'No income this month',
      payment: 'Payment',
      discount: 'Discount',
      recentExpenses: 'Recent expenses',
      noExpenseMonth: 'No expenses this month'
    },
    profile: {
      errorImgFormat: 'Wrong format',
      errorImgSize: 'Size exceeded',
      errorUpload: 'Upload error',
      successUpload: 'Image uploaded',
      errorDelete: 'Delete error',
      successDelete: 'Image deleted',
      subtitle: 'Manage your profile',
      changePhoto: 'Change photo',
      uploadPhoto: 'Upload photo',
      deletePhoto: 'Delete',
      photoReqs: 'Photo requirements',
      personalInfo: 'Personal Information',
      fullname: 'Full name',
      fullnameLabel: 'Your first and last name',
      phone: 'Phone',
      emailLabel: 'Email address',
      emailWarning: 'Email notice',
      securityTitle: 'Security',
      securitySubtitle: 'Password and security',
      cancel: 'Cancel',
      changePasswordBtn: 'Change password',
      newPassword: 'New password',
      newPasswordLabel: 'Type your new password',
      confirmPassword: 'Confirm password',
      confirmPasswordLabel: 'Repeat your new password',
      passwordSet: 'Password set',
      saveProfile: 'Save profile'
    }
  },
  pt: {
    appointments: {
      subtitle: 'Gerencie todas as suas consultas',
      newAppointment: 'Nova consulta',
      searchApt: 'Procurar...',
      day: 'Dia',
      week: 'Semana',
      loadingAgenda: 'Carregando agenda...',
      noAptsTitle: 'Sem consultas',
      noAptsDesc: 'Você não tem consultas marcadas',
      scheduleApt: 'Agendar consulta',
      unknownClient: 'Cliente desconhecido',
      unmanaged: 'Não gerenciado',
      unassigned: 'Não atribuído',
      edit: 'Editar',
      pastAptCheck: 'Consulta passada',
      yesAttended: 'Sim, compareceu',
      noShow: 'Faltou'
    },
    clients: {
      newClient: 'Novo cliente',
      searchPlaceholder: 'Procurar cliente...',
      clearSearch: 'Limpar',
      totalClients: 'Total de clientes',
      vip: 'Cliente VIP',
      avgTicket: 'Ticket Médio',
      noClients: 'Sem clientes',
      addFirstClient: 'Adicione seu primeiro cliente',
      visits: 'Visitas'
    },
    services: {
      newService: 'Novo serviço',
      editService: 'Editar',
      form: {
        name: 'Nome',
        namePlaceholder: 'Nome do serviço',
        category: 'Categoria',
        noCategory: 'Sem categoria',
        description: 'Descrição',
        descriptionPlaceholder: 'Descrição breve',
        duration: 'Duração (min)',
        durations: {
          '30': '30 minutos',
          '60': '1 hora',
          '90': '1 hora 30 minutos',
          '120': '2 horas',
          '150': '2 horas 30 minutos'
        },
        customDuration: 'Personalizada',
        customMin: 'Minutos',
        price: 'Preço',
        color: 'Cor',
        active: 'Ativo',
        cancel: 'Cancelar',
        save: 'Salvar',
        create: 'Criar'
      },
      noServices: 'Sem serviços',
      createFirst: 'Nenhum serviço ainda',
      createFirstBtn: 'Criar primeiro serviço',
      status: {
        inactive: 'Inativo'
      },
      actions: {
        deactivate: 'Desativar',
        activate: 'Ativar'
      }
    },
    finances: {
      errorLoading: 'Erro ao carregar dados',
      subtitle: 'Resumo financeiro',
      registerExpense: 'Registrar despesa',
      registerIncome: 'Registrar receita',
      incomeMonth: 'Receita do mês',
      expenseMonth: 'Despesas do mês',
      netProfit: 'Lucro líquido',
      margin: 'Margem',
      distribution: 'Distribuição',
      recentIncome: 'Receitas recentes',
      viewAll: 'Ver tudo',
      noIncomeMonth: 'Nenhuma receita este mês',
      payment: 'Pagamento',
      discount: 'Desconto',
      recentExpenses: 'Despesas recentes',
      noExpenseMonth: 'Nenhuma despesa este mês'
    },
    profile: {
      errorImgFormat: 'Formato incorreto',
      errorImgSize: 'Tamanho excedido',
      errorUpload: 'Erro no upload',
      successUpload: 'Imagem enviada',
      errorDelete: 'Erro ao excluir',
      successDelete: 'Imagem excluída',
      subtitle: 'Gerenciar perfil',
      changePhoto: 'Alterar foto',
      uploadPhoto: 'Enviar foto',
      deletePhoto: 'Excluir',
      photoReqs: 'Requisitos da foto',
      personalInfo: 'Informações Pessoais',
      fullname: 'Nome completo',
      fullnameLabel: 'Seu nome e sobrenome',
      phone: 'Telefone',
      emailLabel: 'E-mail',
      emailWarning: 'Aviso de e-mail',
      securityTitle: 'Segurança',
      securitySubtitle: 'Senha e segurança',
      cancel: 'Cancelar',
      changePasswordBtn: 'Alterar senha',
      newPassword: 'Nova senha',
      newPasswordLabel: 'Digite nova senha',
      confirmPassword: 'Confirmar senha',
      confirmPasswordLabel: 'Repita sua senha',
      passwordSet: 'Senha configurada',
      saveProfile: 'Salvar perfil'
    }
  },
  fr: {
    appointments: {
      subtitle: 'Gérer vos rendez-vous',
      newAppointment: 'Nouveau',
      searchApt: 'Chercher...',
      day: 'Jour',
      week: 'Semaine',
      loadingAgenda: 'Chargement...',
      noAptsTitle: 'Aucun rdv',
      noAptsDesc: 'Pas de rendez-vous.',
      scheduleApt: 'Planifier',
      unknownClient: 'Client inconnu',
      unmanaged: 'Non géré',
      unassigned: 'Non attribué',
      edit: 'Modifier',
      pastAptCheck: 'Rdv passé',
      yesAttended: 'Oui, présent',
      noShow: 'Absent'
    },
    clients: {
      newClient: 'Nouveau',
      searchPlaceholder: 'Chercher...',
      clearSearch: 'Effacer',
      totalClients: 'Total',
      vip: 'VIP',
      avgTicket: 'Ticket',
      noClients: 'Aucun',
      addFirstClient: 'Ajouter',
      visits: 'Visites'
    },
    services: {
      newService: 'Nouveau',
      editService: 'Modifier',
      form: {
        name: 'Nom',
        namePlaceholder: 'Nom',
        category: 'Catégorie',
        noCategory: 'Sans',
        description: 'Description',
        descriptionPlaceholder: 'Desc',
        duration: 'Durée',
        durations: {
          '30': '30m',
          '60': '1h',
          '90': '1h30',
          '120': '2h',
          '150': '2h30'
        },
        customDuration: 'Personnaliser',
        customMin: 'Min',
        price: 'Prix',
        color: 'Couleur',
        active: 'Actif',
        cancel: 'Annuler',
        save: 'Enregistrer',
        create: 'Créer'
      },
      noServices: 'Aucun',
      createFirst: 'Aucun',
      createFirstBtn: 'Créer',
      status: {
        inactive: 'Inactif'
      },
      actions: {
        deactivate: 'Désactiver',
        activate: 'Activer'
      }
    },
    finances: {
      errorLoading: 'Erreur',
      subtitle: 'Résumé',
      registerExpense: 'Dépense',
      registerIncome: 'Revenu',
      incomeMonth: 'Revenus',
      expenseMonth: 'Dépenses',
      netProfit: 'Profit',
      margin: 'Marge',
      distribution: 'Distribution',
      recentIncome: 'Revenus',
      viewAll: 'Voir tout',
      noIncomeMonth: 'Aucun revenu',
      payment: 'Paiement',
      discount: 'Remise',
      recentExpenses: 'Dépenses',
      noExpenseMonth: 'Aucune dépense'
    },
    profile: {
      errorImgFormat: 'Format',
      errorImgSize: 'Taille',
      errorUpload: 'Erreur upload',
      successUpload: 'Succès',
      errorDelete: 'Erreur',
      successDelete: 'Succès',
      subtitle: 'Gérer',
      changePhoto: 'Changer',
      uploadPhoto: 'Uploader',
      deletePhoto: 'Supprimer',
      photoReqs: 'Conditions',
      personalInfo: 'Infos',
      fullname: 'Nom',
      fullnameLabel: 'Nom',
      phone: 'Tel',
      emailLabel: 'Email',
      emailWarning: 'Avis',
      securityTitle: 'Sécurité',
      securitySubtitle: 'Sécurité',
      cancel: 'Annuler',
      changePasswordBtn: 'Mot de passe',
      newPassword: 'Nouveau',
      newPasswordLabel: 'Mot de passe',
      confirmPassword: 'Confirmer',
      confirmPasswordLabel: 'Confirmer',
      passwordSet: 'défini',
      saveProfile: 'Enregistrer'
    }
  },
  it: {
    appointments: {
      subtitle: 'Gestisci i tuoi appuntamenti',
      newAppointment: 'Nuovo',
      searchApt: 'Cerca...',
      day: 'Giorno',
      week: 'Settimana',
      loadingAgenda: 'Caricamento...',
      noAptsTitle: 'Nessuno',
      noAptsDesc: 'Nessun appuntamento.',
      scheduleApt: 'Pianifica',
      unknownClient: 'Sconosciuto',
      unmanaged: 'Non gestito',
      unassigned: 'Non assegnato',
      edit: 'Modifica',
      pastAptCheck: 'Passato',
      yesAttended: 'Sì, presente',
      noShow: 'Non presentato'
    },
    clients: {
      newClient: 'Nuovo',
      searchPlaceholder: 'Cerca...',
      clearSearch: 'Pulisci',
      totalClients: 'Totale',
      vip: 'VIP',
      avgTicket: 'Ticket',
      noClients: 'Nessun cliente',
      addFirstClient: 'Aggiungi',
      visits: 'Visite'
    },
    services: {
      newService: 'Nuovo',
      editService: 'Modifica',
      form: {
        name: 'Nome',
        namePlaceholder: 'Nome',
        category: 'Categoria',
        noCategory: 'Senza',
        description: 'Descrizione',
        descriptionPlaceholder: 'Descrizione',
        duration: 'Durata',
        durations: {
          '30': '30m',
          '60': '1h',
          '90': '1h30',
          '120': '2h',
          '150': '2h30'
        },
        customDuration: 'Personalizza',
        customMin: 'Min',
        price: 'Prezzo',
        color: 'Colore',
        active: 'Attivo',
        cancel: 'Annulla',
        save: 'Salva',
        create: 'Crea'
      },
      noServices: 'Nessuno',
      createFirst: 'Nessuno',
      createFirstBtn: 'Crea',
      status: {
        inactive: 'Inattivo'
      },
      actions: {
        deactivate: 'Disattiva',
        activate: 'Attiva'
      }
    },
    finances: {
      errorLoading: 'Errore',
      subtitle: 'Riepilogo',
      registerExpense: 'Spesa',
      registerIncome: 'Entrata',
      incomeMonth: 'Entrate',
      expenseMonth: 'Spese',
      netProfit: 'Profitto',
      margin: 'Margine',
      distribution: 'Distribuzione',
      recentIncome: 'Entrate',
      viewAll: 'Tutti',
      noIncomeMonth: 'Nessuna',
      payment: 'Pagamento',
      discount: 'Sconto',
      recentExpenses: 'Spese',
      noExpenseMonth: 'Nessuna'
    },
    profile: {
      errorImgFormat: 'Formato errato',
      errorImgSize: 'Dimensione ecceduta',
      errorUpload: 'Errore',
      successUpload: 'Successo',
      errorDelete: 'Errore',
      successDelete: 'Successo',
      subtitle: 'Gestisci',
      changePhoto: 'Cambia',
      uploadPhoto: 'Carica',
      deletePhoto: 'Elimina',
      photoReqs: 'Requisiti',
      personalInfo: 'Info personali',
      fullname: 'Nome',
      fullnameLabel: 'Nome e cognome',
      phone: 'Telefono',
      emailLabel: 'Email',
      emailWarning: 'Avviso',
      securityTitle: 'Sicurezza',
      securitySubtitle: 'Password e altro',
      cancel: 'Annulla',
      changePasswordBtn: 'Cambia',
      newPassword: 'Nuova password',
      newPasswordLabel: 'Nuova password',
      confirmPassword: 'Conferma',
      confirmPasswordLabel: 'Conferma password',
      passwordSet: 'Impostata',
      saveProfile: 'Salva profilo'
    }
  },
  de: {
    appointments: {
      subtitle: 'Verwalten Sie Ihre Termine',
      newAppointment: 'Neuer',
      searchApt: 'Suchen...',
      day: 'Tag',
      week: 'Woche',
      loadingAgenda: 'Lädt...',
      noAptsTitle: 'Keine',
      noAptsDesc: 'Keine Termine.',
      scheduleApt: 'Planen',
      unknownClient: 'Unbekannt',
      unmanaged: 'Unverwaltet',
      unassigned: 'Nicht zugewiesen',
      edit: 'Bearbeiten',
      pastAptCheck: 'Vergangen',
      yesAttended: 'Ja, anwesend',
      noShow: 'Nich erschienen'
    },
    clients: {
      newClient: 'Neuer',
      searchPlaceholder: 'Suchen...',
      clearSearch: 'Löschen',
      totalClients: 'Gesamt',
      vip: 'VIP',
      avgTicket: 'Ticket',
      noClients: 'Keine',
      addFirstClient: 'Hinzufügen',
      visits: 'Besuche'
    },
    services: {
      newService: 'Neuer Service',
      editService: 'Bearbeiten',
      form: {
        name: 'Name',
        namePlaceholder: 'Name',
        category: 'Kategorie',
        noCategory: 'Ohne',
        description: 'Beschreibung',
        descriptionPlaceholder: 'Beschreibung',
        duration: 'Dauer',
        durations: {
          '30': '30m',
          '60': '1h',
          '90': '1h30',
          '120': '2h',
          '150': '2h30'
        },
        customDuration: 'Anpassen',
        customMin: 'Minuten',
        price: 'Preis',
        color: 'Farbe',
        active: 'Aktiv',
        cancel: 'Abbrechen',
        save: 'Speichern',
        create: 'Erstellen'
      },
      noServices: 'Keine Dienste',
      createFirst: 'Noch keine',
      createFirstBtn: 'Erstellen',
      status: {
        inactive: 'Inaktiv'
      },
      actions: {
        deactivate: 'Deaktivieren',
        activate: 'Aktivieren'
      }
    },
    finances: {
      errorLoading: 'Fehler',
      subtitle: 'Zusammenfassung',
      registerExpense: 'Ausgabe',
      registerIncome: 'Einnahme',
      incomeMonth: 'Einnahmen',
      expenseMonth: 'Ausgaben',
      netProfit: 'Gewinn',
      margin: 'Marge',
      distribution: 'Verteilung',
      recentIncome: 'Einnahmen',
      viewAll: 'Alle ansehen',
      noIncomeMonth: 'Keine Einnahmen',
      payment: 'Zahlung',
      discount: 'Rabatt',
      recentExpenses: 'Ausgaben',
      noExpenseMonth: 'Keine Ausgaben'
    },
    profile: {
      errorImgFormat: 'Falsches Format',
      errorImgSize: 'Zu groß',
      errorUpload: 'Fehler',
      successUpload: 'Erfolg',
      errorDelete: 'Fehler',
      successDelete: 'Erfolg',
      subtitle: 'Verwalten',
      changePhoto: 'Ändern',
      uploadPhoto: 'Hochladen',
      deletePhoto: 'Löschen',
      photoReqs: 'Bedingungen',
      personalInfo: 'Persönliches',
      fullname: 'Name',
      fullnameLabel: 'Vor und Nachname',
      phone: 'Telefon',
      emailLabel: 'E-Mail',
      emailWarning: 'Warnung',
      securityTitle: 'Sicherheit',
      securitySubtitle: 'Sicherheit',
      cancel: 'Abbrechen',
      changePasswordBtn: 'Passwort',
      newPassword: 'Neues Passwort',
      newPasswordLabel: 'Passwort',
      confirmPassword: 'Bestätigen',
      confirmPasswordLabel: 'Bestätigen',
      passwordSet: 'Eingestellt',
      saveProfile: 'Speichern'
    }
  }
};

function deepMerge(target, src) {
  for (const key of Object.keys(src)) {
    if (typeof src[key] === 'object' && !Array.isArray(src[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], src[key]);
    } else {
      target[key] = src[key];
    }
  }
}

const locales = ['es', 'en', 'pt', 'fr', 'it', 'de'];

for (const locale of locales) {
  const filePath = path.join('messages', `${locale}.json`);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  
  if (!data.appointments) data.appointments = {};
  if (!data.clients) data.clients = {};
  if (!data.services) data.services = {};
  if (!data.finances) data.finances = {};
  if (!data.profile) data.profile = {};

  deepMerge(data.appointments, missingTranslations[locale].appointments);
  deepMerge(data.clients, missingTranslations[locale].clients);
  deepMerge(data.services, missingTranslations[locale].services);
  deepMerge(data.finances, missingTranslations[locale].finances);
  deepMerge(data.profile, missingTranslations[locale].profile);
  
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

console.log('✅ Injected missing keys into all locale files.');
