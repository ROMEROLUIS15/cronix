/**
 * orchestrator/example.ts — Usage examples demonstrating the Phase 1 core.
 *
 * Run with: npx tsx lib/ai/orchestrator/example.ts
 *
 * Shows:
 *   1. External user booking flow (multi-turn with confirmation)
 *   2. Owner booking flow (direct execution, no confirmation)
 *   3. Data query via LLM reasoning path
 *   4. State reset
 */

import { orchestrator } from './ai-orchestrator'
import type { AiInput, BusinessContext } from './types'

// ── Shared mock context ──────────────────────────────────────────────────────

const mockContext: BusinessContext = {
  businessId: 'biz-001',
  businessName: 'Salón Bella',
  timezone: 'America/Caracas',
  workingHours: {
    monday: { open: '09:00', close: '18:00' },
    tuesday: { open: '09:00', close: '18:00' },
    wednesday: { open: '09:00', close: '18:00' },
    thursday: { open: '09:00', close: '18:00' },
    friday: { open: '09:00', close: '18:00' },
    saturday: { open: '09:00', close: '14:00' },
  },
  services: [
    { id: 'svc-1', name: 'Corte de Cabello', duration_min: 30, price: 25 },
    { id: 'svc-2', name: 'Tinte', duration_min: 60, price: 40 },
    { id: 'svc-3', name: 'Peinado', duration_min: 20, price: 15 },
  ],
  activeAppointments: [],
  bookedSlots: [],
  aiRules: 'Siempre confirma los datos antes de agendar.',
}

function makeInput(
  text: string,
  userId: string,
  userRole: 'external' | 'owner' | 'employee',
  channel: 'whatsapp' | 'web',
  history: AiInput['history'] = [],
): AiInput {
  return {
    text,
    userId,
    businessId: 'biz-001',
    userRole,
    timezone: 'America/Caracas',
    channel,
    history,
    context: mockContext,
    userName: userRole === 'external' ? 'María López' : 'Carlos Admin',
  }
}

// ── Helper: Print a turn ─────────────────────────────────────────────────────

function printTurn(
  turn: number,
  userText: string,
  response: { text: string; actionPerformed: boolean; state: { flow: string } },
) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  TURNO ${turn}`)
  console.log(`  Usuario: "${userText}"`)
  console.log(`  IA:      "${response.text}"`)
  console.log(`  Action:  ${response.actionPerformed ? '✅ Sí' : '❌ No'}`)
  console.log(`  State:   flow=${response.state.flow}`)
  console.log(`${'═'.repeat(60)}\n`)
}

// ── Example 1: External user booking (WhatsApp, requires confirmation) ────────

async function exampleExternalBooking() {
  console.log('\n' + '█'.repeat(60))
  console.log('  EJEMPLO 1: Cliente externo (WhatsApp) — Agendar con confirmación')
  console.log('█'.repeat(60))

  let history: AiInput['history'] = []

  // Turn 1: Booking intent
  let input = makeInput('Quiero agendar una cita', 'phone-123', 'external', 'whatsapp', history)
  let output = await orchestrator.process(input)
  history = output.history
  printTurn(1, 'Quiero agendar una cita', output)

  // Turn 2: Provide client name
  input = makeInput('A nombre de María López', 'phone-123', 'external', 'whatsapp', history)
  output = await orchestrator.process(input)
  history = output.history
  printTurn(2, 'A nombre de María López', output)

  // Turn 3: Provide service
  input = makeInput('Para corte de cabello', 'phone-123', 'external', 'whatsapp', history)
  output = await orchestrator.process(input)
  history = output.history
  printTurn(3, 'Para corte de cabello', output)

  // Turn 4: Provide date and time (fast path extraction)
  input = makeInput('Mañana a las 3 pm', 'phone-123', 'external', 'whatsapp', history)
  output = await orchestrator.process(input)
  history = output.history
  printTurn(4, 'Mañana a las 3 pm', output)

  // Turn 5: Confirm
  input = makeInput('Sí, confirmo', 'phone-123', 'external', 'whatsapp', history)
  output = await orchestrator.process(input)
  history = output.history
  printTurn(5, 'Sí, confirmo', output)

  // Turn 6: New topic after completed booking
  input = makeInput('Gracias, ¿qué servicios tienen?', 'phone-123', 'external', 'whatsapp', history)
  output = await orchestrator.process(input)
  history = output.history
  printTurn(6, '¿Qué servicios tienen?', output)
}

// ── Example 2: Owner booking (Web, direct execution, no confirmation) ─────────

async function exampleOwnerBooking() {
  console.log('\n' + '█'.repeat(60))
  console.log('  EJEMPLO 2: Dueño (Web) — Agendar sin confirmación')
  console.log('█'.repeat(60))

  let history: AiInput['history'] = []

  // Turn 1: Booking intent with full data
  let input = makeInput(
    'Agenda un corte de cabello para mañana a las 3 pm',
    'user-owner-1',
    'owner',
    'web',
    history,
  )
  let output = await orchestrator.process(input)
  history = output.history
  printTurn(1, 'Agenda un corte de cabello para mañana a las 3 pm', output)

  // Turn 2: Query
  input = makeInput('¿Qué citas hay mañana?', 'user-owner-1', 'owner', 'web', history)
  output = await orchestrator.process(input)
  history = output.history
  printTurn(2, '¿Qué citas hay mañana?', output)
}

// ── Example 3: Data query via LLM reasoning path ─────────────────────────────

async function exampleQueryWithLlm() {
  console.log('\n' + '█'.repeat(60))
  console.log('  EJEMPLO 3: Consulta que pasa por LLM (sin fast path)')
  console.log('█'.repeat(60))

  let history: AiInput['history'] = []

  // This query doesn't match fast path keywords → goes to LLM
  let input = makeInput(
    'Hola, ¿cómo estás? Necesito información sobre las citas.',
    'phone-456',
    'external',
    'whatsapp',
    history,
  )
  let output = await orchestrator.process(input)
  history = output.history
  printTurn(1, 'Hola, necesito información sobre las citas', output)
}

// ── Example 4: State reset ───────────────────────────────────────────────────

async function exampleReset() {
  console.log('\n' + '█'.repeat(60))
  console.log('  EJEMPLO 4: Reset de estado')
  console.log('█'.repeat(60))

  await orchestrator.reset('phone-123', 'biz-001')
  console.log('  Estado de phone-123 reseteado correctamente.')

  // Verify: next message starts fresh
  const input = makeInput('Quiero agendar', 'phone-123', 'external', 'whatsapp', [])
  const output = await orchestrator.process(input)
  console.log(`  IA respondió: "${output.text}"`)
  console.log(`  Flow después del reset: ${output.state.flow}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  try {
    await exampleExternalBooking()
    await exampleOwnerBooking()
    await exampleQueryWithLlm()
    await exampleReset()

    console.log('\n' + '█'.repeat(60))
    console.log('  TODOS LOS EJEMPLOS COMPLETADOS EXITOSAMENTE')
    console.log('█'.repeat(60) + '\n')
  } catch (err) {
    console.error('Error running examples:', err)
    process.exit(1)
  }
}

// Run if executed directly
main()
