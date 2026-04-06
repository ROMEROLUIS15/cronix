/**
 * output-shield.ts — Validación del output del LLM antes de enviarlo al usuario.
 *
 * Detecta patrones de prompt injection, jailbreak y exfiltración de datos en las
 * RESPUESTAS del LLM. Si detecta algo sospechoso → retorna un mensaje de fallback
 * seguro en lugar de vocalizar contenido comprometido.
 *
 * No logea el texto completo para no convertir los logs en otro vector de ataque.
 */

import { logger } from '@/lib/logger'

// Patrones que NUNCA deberían aparecer en una respuesta legítima de un asistente de voz de negocio
const INJECTION_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // ── Prompt injection / jailbreak ─────────────────────────────────────────
  { name: 'system_prompt_leak',   pattern: /system\s*prompt/i },
  { name: 'instruction_override', pattern: /ignora?\s+(todas?\s+)?las?\s+instrucciones?/i },
  { name: 'role_override',        pattern: /act[uú]a\s+(como|ahora)\s+(si\s+)?eres/i },
  { name: 'internal_reveal',      pattern: /instrucciones?\s*(del?\s*sistema|originale?s?)/i },

  // ── Code / injection attacks ──────────────────────────────────────────────
  { name: 'sql_injection',        pattern: /\b(SELECT|INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i },
  { name: 'xss_injection',        pattern: /<script|javascript:/i },
  { name: 'url_injection',        pattern: /https?:\/\//i },

  // ── Data exfiltration — PII and tenant data ───────────────────────────────
  // UUIDs in responses = possible leak of internal IDs from other tenants
  { name: 'uuid_leak',            pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
  // Phone numbers (10+ consecutive digits) = possible leak of other clients' contact data
  { name: 'phone_leak',           pattern: /\b\+?\d[\d\s\-(). ]{9,}\d\b/ },

  // ── Tool name leakage — complete list of all registered tools ────────────
  {
    name: 'tool_name_leak',
    pattern: /\b(get_today_summary|book_appointment|cancel_appointment|reschedule_appointment|register_payment|get_client_debt|get_client_appointments|get_inactive_clients|get_revenue_stats|get_monthly_forecast|send_reactivation_message|create_client|get_clients|get_staff|get_services|get_upcoming_gaps|confirm_booking|reschedule_booking|cancel_booking)\b/,
  },
]

const SAFE_FALLBACK = 'Lo siento, no pude formular una respuesta adecuada. Por favor, intenta de nuevo.'

/**
 * Valida el output del LLM antes de enviarlo al TTS y al cliente.
 * Retorna el texto original si es seguro, o el fallback si detecta un patrón sospechoso.
 */
export function shieldOutput(text: string, userId?: string): string {
  if (!text?.trim()) return SAFE_FALLBACK

  for (const { name, pattern } of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      logger.warn('OUTPUT-SHIELD', `Suspicious pattern blocked: ${name}`, { userId })
      return SAFE_FALLBACK
    }
  }

  return text
}
