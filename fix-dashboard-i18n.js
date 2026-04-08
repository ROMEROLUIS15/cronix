const fs = require('fs');
const path = require('path');

// All missing keys for the dashboard namespace
const missingKeys = {
  es: {
    greeting: 'Buenos días',
    tabs: { metrics: 'Métricas' },
    quickActions: {
      newAppointment: 'Nueva cita',
      newClient: 'Nuevo cliente',
      registerPayment: 'Registrar cobro'
    },
    status: {
      pending: 'Pendiente',
      confirmed: 'Confirmada',
      completed: 'Completada',
      cancelled: 'Cancelada',
      noShow: 'No se presentó'
    },
    welcome: {
      title: '¡Bienvenido a Cronix!',
      subtitle: 'Crea tu cuenta de negocio para comenzar a gestionar tus citas.',
      button: 'Configurar mi negocio'
    },
    stats: {
      appointmentsToday: 'Citas hoy',
      pendingConfirmation: 'Por confirmar'
    },
    panels: {
      dayAppointments: 'Citas del día',
      noAppointments: 'Sin citas',
      noAppointmentsDesc: 'No hay citas programadas para este día.',
      scheduleAppointment: 'Agendar cita',
      cancelQuestion: '¿Cancelar esta cita?',
      cancelDesc: 'La cita será cancelada y el cliente notificado.',
      cancelNo: 'No, mantener',
      cancelYes: 'Sí, cancelar',
      edit: 'Editar',
      confirm: 'Confirmar',
      detailTitle: 'Detalle de cita',
      service: 'Servicio',
      time: 'Hora',
      duration: 'Duración',
      staff: 'Empleado',
      unassigned: 'Sin asignar',
      phone: 'Teléfono',
      notes: 'Notas',
      changeStatus: 'Cambiar estado',
      confirmApt: 'Confirmar cita',
      markCompleted: 'Marcar como completada',
      cancelApt: 'Cancelar cita',
      editFullApt: 'Editar cita completa',
      backToDay: 'Volver al día'
    }
  },
  en: {
    greeting: 'Good morning',
    tabs: { metrics: 'Metrics' },
    quickActions: {
      newAppointment: 'New appointment',
      newClient: 'New client',
      registerPayment: 'Register payment'
    },
    status: {
      pending: 'Pending',
      confirmed: 'Confirmed',
      completed: 'Completed',
      cancelled: 'Cancelled',
      noShow: 'No show'
    },
    welcome: {
      title: 'Welcome to Cronix!',
      subtitle: 'Create your business account to start managing your appointments.',
      button: 'Set up my business'
    },
    stats: {
      appointmentsToday: 'Appointments today',
      pendingConfirmation: 'Pending confirmation'
    },
    panels: {
      dayAppointments: 'Day appointments',
      noAppointments: 'No appointments',
      noAppointmentsDesc: 'No appointments scheduled for this day.',
      scheduleAppointment: 'Schedule appointment',
      cancelQuestion: 'Cancel this appointment?',
      cancelDesc: 'The appointment will be cancelled and the client notified.',
      cancelNo: 'No, keep it',
      cancelYes: 'Yes, cancel',
      edit: 'Edit',
      confirm: 'Confirm',
      detailTitle: 'Appointment detail',
      service: 'Service',
      time: 'Time',
      duration: 'Duration',
      staff: 'Staff',
      unassigned: 'Unassigned',
      phone: 'Phone',
      notes: 'Notes',
      changeStatus: 'Change status',
      confirmApt: 'Confirm appointment',
      markCompleted: 'Mark as completed',
      cancelApt: 'Cancel appointment',
      editFullApt: 'Edit full appointment',
      backToDay: 'Back to day'
    }
  },
  pt: {
    greeting: 'Bom dia',
    tabs: { metrics: 'Métricas' },
    quickActions: {
      newAppointment: 'Nova consulta',
      newClient: 'Novo cliente',
      registerPayment: 'Registrar pagamento'
    },
    status: {
      pending: 'Pendente',
      confirmed: 'Confirmada',
      completed: 'Concluída',
      cancelled: 'Cancelada',
      noShow: 'Não compareceu'
    },
    welcome: {
      title: 'Bem-vindo ao Cronix!',
      subtitle: 'Crie sua conta de negócio para começar a gerenciar suas consultas.',
      button: 'Configurar meu negócio'
    },
    stats: {
      appointmentsToday: 'Consultas hoje',
      pendingConfirmation: 'Para confirmar'
    },
    panels: {
      dayAppointments: 'Consultas do dia',
      noAppointments: 'Sem consultas',
      noAppointmentsDesc: 'Nenhuma consulta agendada para este dia.',
      scheduleAppointment: 'Agendar consulta',
      cancelQuestion: 'Cancelar esta consulta?',
      cancelDesc: 'A consulta será cancelada e o cliente notificado.',
      cancelNo: 'Não, manter',
      cancelYes: 'Sim, cancelar',
      edit: 'Editar',
      confirm: 'Confirmar',
      detailTitle: 'Detalhes da consulta',
      service: 'Serviço',
      time: 'Horário',
      duration: 'Duração',
      staff: 'Funcionário',
      unassigned: 'Sem atribuição',
      phone: 'Telefone',
      notes: 'Observações',
      changeStatus: 'Alterar status',
      confirmApt: 'Confirmar consulta',
      markCompleted: 'Marcar como concluída',
      cancelApt: 'Cancelar consulta',
      editFullApt: 'Editar consulta completa',
      backToDay: 'Voltar ao dia'
    }
  },
  fr: {
    greeting: 'Bonjour',
    tabs: { metrics: 'Métriques' },
    quickActions: {
      newAppointment: 'Nouveau rendez-vous',
      newClient: 'Nouveau client',
      registerPayment: 'Enregistrer paiement'
    },
    status: {
      pending: 'En attente',
      confirmed: 'Confirmé',
      completed: 'Terminé',
      cancelled: 'Annulé',
      noShow: 'Absent'
    },
    welcome: {
      title: 'Bienvenue sur Cronix!',
      subtitle: 'Créez votre compte professionnel pour gérer vos rendez-vous.',
      button: 'Configurer mon entreprise'
    },
    stats: {
      appointmentsToday: "Rendez-vous aujourd'hui",
      pendingConfirmation: 'À confirmer'
    },
    panels: {
      dayAppointments: 'Rendez-vous du jour',
      noAppointments: 'Aucun rendez-vous',
      noAppointmentsDesc: 'Aucun rendez-vous prévu pour ce jour.',
      scheduleAppointment: 'Planifier rendez-vous',
      cancelQuestion: 'Annuler ce rendez-vous?',
      cancelDesc: 'Le rendez-vous sera annulé et le client notifié.',
      cancelNo: 'Non, garder',
      cancelYes: 'Oui, annuler',
      edit: 'Modifier',
      confirm: 'Confirmer',
      detailTitle: 'Détail du rendez-vous',
      service: 'Service',
      time: 'Heure',
      duration: 'Durée',
      staff: 'Personnel',
      unassigned: 'Non assigné',
      phone: 'Téléphone',
      notes: 'Notes',
      changeStatus: 'Changer le statut',
      confirmApt: 'Confirmer le rendez-vous',
      markCompleted: 'Marquer comme terminé',
      cancelApt: 'Annuler le rendez-vous',
      editFullApt: 'Modifier complètement',
      backToDay: 'Retour au jour'
    }
  },
  it: {
    greeting: 'Buongiorno',
    tabs: { metrics: 'Metriche' },
    quickActions: {
      newAppointment: 'Nuovo appuntamento',
      newClient: 'Nuovo cliente',
      registerPayment: 'Registra pagamento'
    },
    status: {
      pending: 'In attesa',
      confirmed: 'Confermato',
      completed: 'Completato',
      cancelled: 'Annullato',
      noShow: 'Non presentato'
    },
    welcome: {
      title: 'Benvenuto in Cronix!',
      subtitle: 'Crea il tuo account business per iniziare a gestire gli appuntamenti.',
      button: 'Configura il mio business'
    },
    stats: {
      appointmentsToday: 'Appuntamenti oggi',
      pendingConfirmation: 'Da confermare'
    },
    panels: {
      dayAppointments: 'Appuntamenti del giorno',
      noAppointments: 'Nessun appuntamento',
      noAppointmentsDesc: 'Nessun appuntamento programmato per questo giorno.',
      scheduleAppointment: 'Pianifica appuntamento',
      cancelQuestion: 'Annullare questo appuntamento?',
      cancelDesc: "L'appuntamento verrà annullato e il cliente notificato.",
      cancelNo: 'No, mantieni',
      cancelYes: 'Sì, annulla',
      edit: 'Modifica',
      confirm: 'Conferma',
      detailTitle: 'Dettaglio appuntamento',
      service: 'Servizio',
      time: 'Ora',
      duration: 'Durata',
      staff: 'Personale',
      unassigned: 'Non assegnato',
      phone: 'Telefono',
      notes: 'Note',
      changeStatus: 'Cambia stato',
      confirmApt: 'Conferma appuntamento',
      markCompleted: 'Segna come completato',
      cancelApt: 'Annulla appuntamento',
      editFullApt: 'Modifica completa',
      backToDay: 'Torna al giorno'
    }
  },
  de: {
    greeting: 'Guten Morgen',
    tabs: { metrics: 'Metriken' },
    quickActions: {
      newAppointment: 'Neuer Termin',
      newClient: 'Neuer Kunde',
      registerPayment: 'Zahlung registrieren'
    },
    status: {
      pending: 'Ausstehend',
      confirmed: 'Bestätigt',
      completed: 'Abgeschlossen',
      cancelled: 'Abgesagt',
      noShow: 'Nicht erschienen'
    },
    welcome: {
      title: 'Willkommen bei Cronix!',
      subtitle: 'Erstellen Sie Ihr Geschäftskonto, um Ihre Termine zu verwalten.',
      button: 'Mein Unternehmen einrichten'
    },
    stats: {
      appointmentsToday: 'Termine heute',
      pendingConfirmation: 'Zu bestätigen'
    },
    panels: {
      dayAppointments: 'Termine des Tages',
      noAppointments: 'Keine Termine',
      noAppointmentsDesc: 'Keine Termine für diesen Tag geplant.',
      scheduleAppointment: 'Termin planen',
      cancelQuestion: 'Diesen Termin absagen?',
      cancelDesc: 'Der Termin wird abgesagt und der Kunde benachrichtigt.',
      cancelNo: 'Nein, behalten',
      cancelYes: 'Ja, absagen',
      edit: 'Bearbeiten',
      confirm: 'Bestätigen',
      detailTitle: 'Termindetails',
      service: 'Leistung',
      time: 'Uhrzeit',
      duration: 'Dauer',
      staff: 'Mitarbeiter',
      unassigned: 'Nicht zugewiesen',
      phone: 'Telefon',
      notes: 'Notizen',
      changeStatus: 'Status ändern',
      confirmApt: 'Termin bestätigen',
      markCompleted: 'Als erledigt markieren',
      cancelApt: 'Termin absagen',
      editFullApt: 'Termin vollständig bearbeiten',
      backToDay: 'Zurück zum Tag'
    }
  }
};

// Deep merge: merges src into target (non-destructive)
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
let fixed = 0;

for (const locale of locales) {
  const filePath = path.join('messages', `${locale}.json`);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  
  if (!data.dashboard) data.dashboard = {};
  deepMerge(data.dashboard, missingKeys[locale]);
  
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  fixed++;
  console.log(`✅ ${locale}.json — dashboard keys injected`);
}

console.log(`\n🎉 Done! Fixed ${fixed} locale files.`);
