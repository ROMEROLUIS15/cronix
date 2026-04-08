const fs = require('fs');
const path = require('path');

const keys = {
  es: {
    title: 'Ajustes', subtitle: 'Configura tu negocio y preferencias', saveSuccess: 'Perfil del negocio guardado correctamente', saveError: 'Error al guardar: ', saveHoursSuccess: 'Horario guardado correctamente', saveHoursError: 'Error al guardar horario: ', saveNotifSuccess: 'Preferencias de recordatorio guardadas', saveNotifError: 'Error al guardar notificaciones: ', saveLuisFabActive: 'Asistente activado en pantalla', saveLuisFabInactive: 'Asistente ocultado', saveLuisFabError: 'Error al cambiar visibilidad', copyHoursSuccess: 'Horarios copiados a los días abiertos', bizProfile: 'Perfil del Negocio', bizProfileSub: 'Información pública de tu negocio', bizName: 'Nombre del negocio', bizNamePlace: 'Nombre de tu negocio', category: 'Categoría o rubro', categoryPlace: 'Selecciona una categoría', phone: 'Teléfono', address: 'Dirección', addressPlace: 'Calle, ciudad...', saveChanges: 'Guardar cambios',
    waLinkTitle: 'Link de WhatsApp', waLinkSub: 'Comparte este enlace para que tus clientes agenden por WhatsApp', copied: 'Copiado', copy: 'Copiar', waDescGenerated: 'Cuando un cliente abre este enlace, WhatsApp se abre con tu negocio pre-seleccionado. Ideal para Instagram, tarjetas de presentación o tu página web.', waDescNoGenerated: 'Tu negocio aún no tiene un enlace de WhatsApp generado.', generateWaLink: 'Generar enlace de WhatsApp', generateWaError: 'Error al generar el enlace',
    hoursTitle: 'Horario de Atención', hoursSub: 'Define los horarios de cada día', copyToAll: 'Copiar a todos', open: 'Abierto', close: 'Cerrado', from: 'Desde', to: 'Hasta', saveHoursBtn: 'Guardar todos los horarios',
    adminNotifTitle: 'Notificaciones del Administrador', adminNotifSub: 'Alertas de reservas automáticas exclusivas para el dueño', waBiz: 'WhatsApp del Negocio', waBizSub: 'Recibe notificaciones instantáneas en tu celular cada vez que la IA agende una nueva cita.', verified: 'Verificado: ', linkWa: 'Vincular mi WhatsApp',
    aiAssistantTitle: 'Asistente Inteligente', aiAssistantSub: 'Preferencias de IA y automatización',
    fabTitle: 'Botón flotante de Luis IA', fabSub: 'Muestra u oculta el botón walkie-talkie en todas tus pantallas',
    remindersTitle: 'Recordatorios', remindersSub: 'Canales y ventanas de tiempo',
    waChannel: 'WhatsApp', waChannelSub: 'Recordatorios automáticos a clientes por WhatsApp', saveRemindersBtn: 'Guardar preferencias',
    sendTest: 'Enviar prueba', testSent: 'Prueba enviada', testsRemaining: 'pruebas restantes', notifTestSuccess: 'Recordatorio de prueba enviado',
    pushNotifs: 'Notificaciones Push', pushBlocked: 'Bloqueadas — actívalas en la configuración de tu navegador', pushMissingConfig: 'Error: clave VAPID no configurada en el servidor', pushSwUnavail: 'Requiere build de producción — prueba con next build && next start', pushLoading: 'Procesando…', pushSubscribed: 'Activo en este dispositivo', pushUnsubscribed: 'Recibe alertas de citas en este dispositivo', saveReminders: 'Guardar recordatorios'
  },
  en: {
    title: 'Settings', subtitle: 'Configure your business and preferences', saveSuccess: 'Business profile saved successfully', saveError: 'Error saving: ', saveHoursSuccess: 'Working hours saved successfully', saveHoursError: 'Error saving hours: ', saveNotifSuccess: 'Reminder preferences saved', saveNotifError: 'Error saving notifications: ', saveLuisFabActive: 'Assistant active on screen', saveLuisFabInactive: 'Assistant hidden', saveLuisFabError: 'Error changing visibility', copyHoursSuccess: 'Hours copied to open days', bizProfile: 'Business Profile', bizProfileSub: 'Public information of your business', bizName: 'Business name', bizNamePlace: 'Your business name', category: 'Category', categoryPlace: 'Select category', phone: 'Phone', address: 'Address', addressPlace: 'Street, city...', saveChanges: 'Save changes',
    waLinkTitle: 'WhatsApp Link', waLinkSub: 'Share this link for your clients to book via WhatsApp', copied: 'Copied', copy: 'Copy', waDescGenerated: 'When a client opens this link, WhatsApp opens with your business pre-selected.', waDescNoGenerated: 'Your business still doesn\'t have a generated WhatsApp link.', generateWaLink: 'Generate WhatsApp link', generateWaError: 'Error generating link',
    hoursTitle: 'Working Hours', hoursSub: 'Define your daily schedule', copyToAll: 'Copy to all', open: 'Open', close: 'Closed', from: 'From', to: 'To', saveHoursBtn: 'Save all hours',
    adminNotifTitle: 'Admin Notifications', adminNotifSub: 'Automatic booking alerts exclusively for the owner', waBiz: 'Business WhatsApp', waBizSub: 'Receive instant notifications on your phone whenever the AI books a new appointment.', verified: 'Verified: ', linkWa: 'Link my WhatsApp',
    aiAssistantTitle: 'Smart Assistant', aiAssistantSub: 'AI and automation preferences',
    fabTitle: 'Luis IA floating button', fabSub: 'Show or hide the walkie-talkie button on all screens',
    remindersTitle: 'Reminders', remindersSub: 'Channels and time windows',
    waChannel: 'WhatsApp', waChannelSub: 'Automatic reminders to clients via WhatsApp', saveRemindersBtn: 'Save preferences',
    sendTest: 'Send test', testSent: 'Test sent', testsRemaining: 'tests remaining', notifTestSuccess: 'Test reminder sent',
    pushNotifs: 'Push Notifications', pushBlocked: 'Blocked — enable them in your browser settings', pushMissingConfig: 'Error: VAPID key not configured on server', pushSwUnavail: 'Requires production build — try next build && next start', pushLoading: 'Processing…', pushSubscribed: 'Active on this device', pushUnsubscribed: 'Receive appointment alerts on this device', saveReminders: 'Save reminders'
  },
  pt: {
    title: 'Configurações', subtitle: 'Configure seu negócio e preferências', saveSuccess: 'Perfil do negócio salvo com sucesso', saveError: 'Erro ao salvar: ', saveHoursSuccess: 'Horários salvos com sucesso', saveHoursError: 'Erro ao salvar horários: ', saveNotifSuccess: 'Preferências de lembrete salvas', saveNotifError: 'Erro ao salvar notificações: ', saveLuisFabActive: 'Assistente ativo na tela', saveLuisFabInactive: 'Assistente oculto', saveLuisFabError: 'Erro ao alterar visibilidade', copyHoursSuccess: 'Horários copiados', bizProfile: 'Perfil do Negócio', bizProfileSub: 'Informações públicas', bizName: 'Nome do negócio', bizNamePlace: 'Nome do seu negócio', category: 'Categoria', categoryPlace: 'Selecione a categoria', phone: 'Telefone', address: 'Endereço', addressPlace: 'Rua, cidade...', saveChanges: 'Salvar alterações',
    waLinkTitle: 'Link do WhatsApp', waLinkSub: 'Compartilhe este link para seus clientes agendarem pelo WhatsApp', copied: 'Copiado', copy: 'Copiar', waDescGenerated: 'Quando um cliente abre este link, o WhatsApp abre com seu negócio pré-selecionado.', waDescNoGenerated: 'Seu negócio ainda não tem um link do WhatsApp', generateWaLink: 'Gerar link do WhatsApp', generateWaError: 'Erro ao gerar',
    hoursTitle: 'Horário de Funcionamento', hoursSub: 'Defina os horários diários', copyToAll: 'Copiar para todos', open: 'Aberto', close: 'Fechado', from: 'Das', to: 'Até', saveHoursBtn: 'Salvar todos horários',
    adminNotifTitle: 'Notificações Admin', adminNotifSub: 'Alertas de reserva automáticos para o dono', waBiz: 'WhatsApp do Negócio', waBizSub: 'Receba notificações instantâneas no seu celular sempre que a IA agendar.', verified: 'Verificado: ', linkWa: 'Vincular meu WhatsApp',
    aiAssistantTitle: 'Assistente Inteligente', aiAssistantSub: 'Preferências de automação IA',
    fabTitle: 'Botão flutuante Luis IA', fabSub: 'Mostrar/ocultar botão em todas as telas',
    remindersTitle: 'Lembretes', remindersSub: 'Canais e janelas de tempo',
    waChannel: 'WhatsApp', waChannelSub: 'Lembretes automáticos para clientes por WhatsApp', saveRemindersBtn: 'Salvar preferências',
    sendTest: 'Enviar teste', testSent: 'Teste enviado', testsRemaining: 'testes restantes', notifTestSuccess: 'Lembrete de teste enviado',
    pushNotifs: 'Notificações Push', pushBlocked: 'Bloqueadas — ative nas configurações do seu navegador', pushMissingConfig: 'Erro: chave VAPID não configurada', pushSwUnavail: 'Requer build de produção', pushLoading: 'Processando…', pushSubscribed: 'Ativo neste dispositivo', pushUnsubscribed: 'Receba alertas de compromisso neste dispositivo', saveReminders: 'Salvar lembretes'
  },
  fr: {
    title: 'Paramètres', subtitle: 'Configuration', saveSuccess: 'Sauvegardé avec succès', saveError: 'Erreur: ', saveHoursSuccess: 'Heures sauvegardées', saveHoursError: 'Erreur: ', saveNotifSuccess: 'Préférences sauvegardées', saveNotifError: 'Erreur: ', saveLuisFabActive: 'Assistant activé', saveLuisFabInactive: 'Assistant masqué', saveLuisFabError: 'Erreur', copyHoursSuccess: 'Copié', bizProfile: 'Profil', bizProfileSub: 'Infos publiques', bizName: 'Nom', bizNamePlace: 'Nom entreprise', category: 'Catégorie', categoryPlace: 'Catégorie', phone: 'Téléphone', address: 'Adresse', addressPlace: 'Adresse', saveChanges: 'Sauvegarder',
    waLinkTitle: 'Lien WhatsApp', waLinkSub: 'Lien', copied: 'Copié', copy: 'Copier', waDescGenerated: 'Lien', waDescNoGenerated: 'Aucun lien', generateWaLink: 'Créer', generateWaError: 'Erreur',
    hoursTitle: 'Heures', hoursSub: 'Horaire', copyToAll: 'Copier', open: 'Ouvert', close: 'Fermé', from: 'De', to: 'À', saveHoursBtn: 'Sauvegarder',
    adminNotifTitle: 'Notifications Admin', adminNotifSub: 'Alertes owner', waBiz: 'WhatsApp', waBizSub: 'Notifications WhatsApp', verified: 'Vérifié: ', linkWa: 'Lier',
    aiAssistantTitle: 'Assistant IA', aiAssistantSub: 'IA',
    fabTitle: 'Bulle IA', fabSub: 'Activer',
    remindersTitle: 'Rappels', remindersSub: 'Temps',
    waChannel: 'WhatsApp', waChannelSub: 'Rappels', saveRemindersBtn: 'Sauvegarder',
    sendTest: 'Test', testSent: 'Envoyé', testsRemaining: 'restants', notifTestSuccess: 'Test envoyé',
    pushNotifs: 'Notifications Push', pushBlocked: 'Bloqué', pushMissingConfig: 'Erreur de clé VAPID', pushSwUnavail: 'Nécessite build', pushLoading: 'En cours…', pushSubscribed: 'Actif', pushUnsubscribed: 'Recevez des alertes sur cet appareil', saveReminders: 'Sauvegarder rappels'
  },
  it: {
    title: 'Impostazioni', subtitle: 'Configurazione', saveSuccess: 'Salvato con successo', saveError: 'Errore: ', saveHoursSuccess: 'Orari salvati', saveHoursError: 'Errore: ', saveNotifSuccess: 'Preferenze salvate', saveNotifError: 'Errore: ', saveLuisFabActive: 'Assistente attivo', saveLuisFabInactive: 'Assistente nascosto', saveLuisFabError: 'Errore', copyHoursSuccess: 'Copiato', bizProfile: 'Profilo', bizProfileSub: 'Info pubbliche', bizName: 'Nome', bizNamePlace: 'Nome', category: 'Categoria', categoryPlace: 'Categoria', phone: 'Telefono', address: 'Indirizzo', addressPlace: 'Indirizzo', saveChanges: 'Salva',
    waLinkTitle: 'Link WhatsApp', waLinkSub: 'Link', copied: 'Copiato', copy: 'Copia', waDescGenerated: 'Link', waDescNoGenerated: 'Nessun link', generateWaLink: 'Crea', generateWaError: 'Errore',
    hoursTitle: 'Orari', hoursSub: 'Programma', copyToAll: 'Copia', open: 'Aperto', close: 'Chiuso', from: 'Da', to: 'A', saveHoursBtn: 'Salva',
    adminNotifTitle: 'Notifiche Admin', adminNotifSub: 'Notifiche owner', waBiz: 'WhatsApp', waBizSub: 'Notifiche WhatsApp', verified: 'Verificato: ', linkWa: 'Collega',
    aiAssistantTitle: 'Assistente IA', aiAssistantSub: 'IA',
    fabTitle: 'Bottone IA', fabSub: 'Attiva',
    remindersTitle: 'Promemoria', remindersSub: 'Tempi',
    waChannel: 'WhatsApp', waChannelSub: 'Promemoria', saveRemindersBtn: 'Salva',
    sendTest: 'Test', testSent: 'Inviato', testsRemaining: 'rimanenti', notifTestSuccess: 'Test inviato',
    pushNotifs: 'Notifiche Push', pushBlocked: 'Bloccato', pushMissingConfig: 'Errore VAPID', pushSwUnavail: 'Richiede build', pushLoading: 'In corso…', pushSubscribed: 'Attivo', pushUnsubscribed: 'Ricevi avvisi di appuntamenti su questo dispositivo', saveReminders: 'Salva promemoria'
  },
  de: {
    title: 'Einstellungen', subtitle: 'Konfiguration', saveSuccess: 'Erfolgreich gespeichert', saveError: 'Fehler: ', saveHoursSuccess: 'Zeiten gespeichert', saveHoursError: 'Fehler: ', saveNotifSuccess: 'Einstellungen gespeichert', saveNotifError: 'Fehler: ', saveLuisFabActive: 'Assistent aktiv', saveLuisFabInactive: 'Assistent verborgen', saveLuisFabError: 'Fehler', copyHoursSuccess: 'Kopiert', bizProfile: 'Profil', bizProfileSub: 'Öffentlich', bizName: 'Name', bizNamePlace: 'Name', category: 'Kategorie', categoryPlace: 'Kategorie', phone: 'Telefon', address: 'Adresse', addressPlace: 'Adresse', saveChanges: 'Speichern',
    waLinkTitle: 'WhatsApp-Link', waLinkSub: 'Link', copied: 'Kopiert', copy: 'Kopieren', waDescGenerated: 'Link', waDescNoGenerated: 'Kein Link', generateWaLink: 'Erstellen', generateWaError: 'Fehler',
    hoursTitle: 'Zeiten', hoursSub: 'Zeiten', copyToAll: 'Kopieren', open: 'Offen', close: 'Geschlossen', from: 'Von', to: 'Bis', saveHoursBtn: 'Speichern',
    adminNotifTitle: 'Admin-Benachrichtigungen', adminNotifSub: 'Berechtigungen', waBiz: 'WhatsApp', waBizSub: 'WhatsApp', verified: 'Verifiziert: ', linkWa: 'Verknüpfen',
    aiAssistantTitle: 'KI-Assistent', aiAssistantSub: 'KI',
    fabTitle: 'KI-Button', fabSub: 'Aktivieren',
    remindersTitle: 'Erinnerungen', remindersSub: 'Zeit',
    waChannel: 'WhatsApp', waChannelSub: 'Erinnerungen', saveRemindersBtn: 'Speichern',
    sendTest: 'Test', testSent: 'Gesendet', testsRemaining: 'verbleibend', notifTestSuccess: 'Test gesendet',
    pushNotifs: 'Push-Benachrichtigungen', pushBlocked: 'Blockiert', pushMissingConfig: 'Fehler VAPID', pushSwUnavail: 'Erfordert Build', pushLoading: 'Verarbeitung…', pushSubscribed: 'Aktiv', pushUnsubscribed: 'Erhalten Sie Benachrichtigungen', saveReminders: 'Erinnerungen speichern'
  }
};

for (const lang of Object.keys(keys)) {
  const filePath = path.join('messages', `${lang}.json`);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    data.settings = keys[lang];
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
}
console.log('JSONs updated for settings translations!');
