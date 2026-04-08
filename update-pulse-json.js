const fs = require('fs');
const path = require('path');

const keys = {
  es: {
    title: 'Pulso del Sistema', subtitle: 'Observabilidad en tiempo real para Fundadores', noVitals: 'No se encontraron transmisiones de telemetría vital.', dlqTitle: 'Cola de Mensajes Muertos (Fallos IA)', criticalBadge: 'Crítico', noDlqTitle: 'No se encontraron mensajes muertos en la cola.', noDlqSub: 'Todos los sistemas funcionan normalmente.', thTimestamp: 'Marca de tiempo', thReason: 'Razón', thPayload: 'Carga útil', thAction: 'Acción', unknownFail: 'Fallo desconocido', viewPayload: 'Ver JSON de Carga Útil', retryBtn: 'Solicitar Reintento', refreshing: 'Actualizando...', refreshPulse: 'Actualizar Pulso'
  },
  en: {
    title: 'System Pulse', subtitle: 'Real-time Observability for Founders', noVitals: 'No vital telemetry streams found.', dlqTitle: 'Dead Letter Queue (AI Failures)', criticalBadge: 'Critical', noDlqTitle: 'No dead letters found in the queue.', noDlqSub: 'All systems are processing normally.', thTimestamp: 'Timestamp', thReason: 'Reason', thPayload: 'Payload', thAction: 'Action', unknownFail: 'Unknown failure', viewPayload: 'View Payload JSON', retryBtn: 'Request Retry', refreshing: 'Refreshing...', refreshPulse: 'Refresh Pulse'
  },
  pt: {
    title: 'Pulso do Sistema', subtitle: 'Observabilidade em tempo real para Fundadores', noVitals: 'Nenhum fluxo de telemetria vital encontrado.', dlqTitle: 'Fila de Mensagens Mortas (Falhas de IA)', criticalBadge: 'Crítico', noDlqTitle: 'Nenhuma mensagem morta encontrada na fila.', noDlqSub: 'Todos os sistemas operando normalmente.', thTimestamp: 'Data/Hora', thReason: 'Razão', thPayload: 'Carga', thAction: 'Ação', unknownFail: 'Falha desconhecida', viewPayload: 'Ver Payload JSON', retryBtn: 'Solicitar Repetição', refreshing: 'Atualizando...', refreshPulse: 'Atualizar Pulso'
  },
  fr: {
    title: 'Pouls du Système', subtitle: 'Observabilité en temps réel', noVitals: 'Aucune télémétrie vitale', dlqTitle: 'File d\'attente lettres mortes', criticalBadge: 'Critique', noDlqTitle: 'Aucun message', noDlqSub: 'Systèmes normaux', thTimestamp: 'Horodatage', thReason: 'Raison', thPayload: 'Données', thAction: 'Action', unknownFail: 'Inconnue', viewPayload: 'Voir JSON', retryBtn: 'Réessayer', refreshing: 'Rafraîchir...', refreshPulse: 'Rafraîchir'
  },
  it: {
    title: 'Pulsazioni di Sistema', subtitle: 'Osservabilità in tempo reale', noVitals: 'Nessuna telemetria vitale', dlqTitle: 'Coda Lettere Morte (Errori IA)', criticalBadge: 'Critico', noDlqTitle: 'Nessun messaggio', noDlqSub: 'Sistemi normali', thTimestamp: 'Data/Ora', thReason: 'Motivo', thPayload: 'Payload', thAction: 'Azione', unknownFail: 'Sconosciuto', viewPayload: 'Vedi JSON', retryBtn: 'Riprova', refreshing: 'Aggiornamento...', refreshPulse: 'Aggiorna'
  },
  de: {
    title: 'Systempuls', subtitle: 'Echtzeit-Beobachtbarkeit', noVitals: 'Keine kritische Telemetrie', dlqTitle: 'Dead Letter Queue (KI-Fehler)', criticalBadge: 'Kritisch', noDlqTitle: 'Keine Nachrichten', noDlqSub: 'Systeme normal', thTimestamp: 'Zeitstempel', thReason: 'Grund', thPayload: 'Nutzlast', thAction: 'Aktion', unknownFail: 'Unbekannt', viewPayload: 'JSON ansehen', retryBtn: 'Wiederholen', refreshing: 'Aktualisieren...', refreshPulse: 'Aktualisieren'
  }
};

for (const lang of Object.keys(keys)) {
  const filePath = path.join('messages', `${lang}.json`);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    data.adminPulse = keys[lang];
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
}
console.log('JSONs updated for adminPulse translations!');
