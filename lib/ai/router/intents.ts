/**
 * Canonical intents for the semantic router.
 *
 * Edit this file when you want to teach the router new phrasings, then
 * regenerate the embeddings JSON:
 *
 *     npx tsx scripts/seed-intent-embeddings.ts
 *
 * The script writes both:
 *   - lib/ai/router/intent-embeddings.generated.json
 *   - supabase/functions/_shared/router/intent-embeddings.generated.json
 *
 * Keep phrases short and varied (formal + colloquial). Avoid duplicates
 * across intents — they hurt confidence.
 */

import type { IntentDefinition } from './contracts'

export const INTENT_DEFINITIONS: ReadonlyArray<IntentDefinition> = [
  {
    name:        'book_appointment',
    description: 'Cliente quiere agendar/apartar/reservar una cita nueva.',
    examples: [
      { text: 'quiero agendar una cita' },
      { text: 'me podés apartar un turno para mañana' },
      { text: 'necesito reservar una hora' },
      { text: 'agéndame una cita' },
      { text: 'puedo hacer una cita' },
    ],
  },
  {
    name:        'cancel_appointment',
    description: 'Cliente quiere cancelar/anular una cita existente.',
    examples: [
      { text: 'quiero cancelar mi cita' },
      { text: 'anulá mi reserva por favor' },
      { text: 'cancelame la cita de mañana' },
      { text: 'ya no voy a ir, borra mi cita' },
    ],
  },
  {
    name:        'reschedule_appointment',
    description: 'Cliente quiere mover/cambiar fecha u hora de una cita existente.',
    examples: [
      { text: 'quiero reagendar mi cita' },
      { text: 'puedo mover la cita para otro día' },
      { text: 'cambiame la hora de mi cita' },
      { text: 'reprogramá mi turno' },
    ],
  },
  {
    name:        'check_availability',
    description: 'Cliente pregunta por horarios disponibles o disponibilidad.',
    examples: [
      { text: 'qué horarios tenés disponibles' },
      { text: 'cuándo tienen libre esta semana' },
      { text: 'hay espacio para mañana' },
      { text: 'a qué hora pueden atenderme' },
      { text: 'hay turno hoy' },
      { text: 'tienes hueco esta tarde' },
      { text: 'k tal hay disponibilidad' },
    ],
  },
  {
    name:        'pricing_inquiry',
    description: 'Cliente pregunta por el precio de un servicio.',
    examples: [
      { text: 'cuánto cuesta' },
      { text: 'cuál es el precio' },
      { text: 'qué precio tiene' },
      { text: 'cuánto vale la manicura' },
      { text: 'cuánto sale' },
    ],
  },
  {
    name:        'list_appointments',
    description: 'Cliente pregunta por sus citas activas.',
    examples: [
      { text: 'cuándo tengo mi próxima cita' },
      { text: 'qué citas tengo agendadas' },
      { text: 'cuál es mi reserva' },
      { text: 'a qué hora es lo mío' },
    ],
  },
  {
    name:        'greeting',
    description: 'Saludo inicial sin intención específica.',
    examples: [
      { text: 'hola' },
      { text: 'buenas' },
      { text: 'buen día' },
      { text: 'qué tal' },
    ],
  },
  {
    name:        'affirmation',
    description: 'Confirmación afirmativa del usuario (usada por el confirmation-gate).',
    examples: [
      { text: 'sí confirma' },
      { text: 'dale' },
      { text: 'listo' },
      { text: 'ok' },
      { text: 'perfecto procedé' },
    ],
  },
  {
    name:        'negation',
    description: 'Rechazo o negación del usuario.',
    examples: [
      { text: 'no' },
      { text: 'mejor no' },
      { text: 'cancela eso' },
      { text: 'no gracias' },
    ],
  },
]
