/**
 * output-shield.ts — Validación del output del LLM antes de enviarlo al usuario.
 *
 * Detecta patrones de prompt injection, jailbreak y exfiltración de datos en las
 * RESPUESTAS del LLM. Si detecta algo sospechoso → retorna un mensaje de fallback
 * seguro en lugar de vocalizar contenido comprometido.
 *
 * No logea el texto completo para no convertir los logs en otro vector de ataque.
 *
 * Enhanced: Added Unicode normalization, multilingual bypass patterns, and
 * semantic structure checks.
 */

import { logger } from '@/lib/logger'

// Patrones que NUNCA deberían aparecer en una respuesta legítima de un asistente de voz de negocio
const INJECTION_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // ── Prompt injection / jailbreak ─────────────────────────────────────────
  { name: 'system_prompt_leak',   pattern: /system\s*prompt|instrucciones?\s*(del?\s*sistema|originale?s?)/i },
  { name: 'instruction_override', pattern: /ignora[re]?\s+(todas?\s+)?las?\s+instrucci[óo]n?s?|ignore\s+(todas?\s+)?(las?\s+)?instrucci[óo]n?s?(?=\s*|anterior)/i },
  { name: 'role_override',        pattern: /act[uú]a\s+(como|ahora)\s+(si\s+)?(eres|seas|siento)|act[uú]a\s+ahora\s+como\s+\w+/i },
  { name: 'internal_reveal',      pattern: /instrucciones?\s*(del?\s*sistema|originale?s?)/i },

  // ── Multilingual injection patterns (Portuguese, English, French) ────────
  { name: 'pt_injection',         pattern: /ignore\s+(todas?\s+)?as?\s+instru[cç][õo]es?|aja\s+agora\s+como/i },
  { name: 'fr_injection',         pattern: /ignore\s+(toutes?\s+)?les?\s+instructions?|agis\s+comme/i },
  { name: 'en_override',          pattern: /disregard\s+(all\s+)?(previous|prior)\s+instructions?|you\s+are\s+now\s+/i },

  // ── Unicode/encoding bypass attempts ─────────────────────────────────────
  { name: 'unicode_bypass',       pattern: /[\u00E0-\u00FF][\u0300-\u036f]/ },  // Accented chars + combining diacritics
  { name: 'zero_width_injection', pattern: /[\u200B-\u200D\uFEFF\u2060\u00AD]{2,}/ },  // Multiple zero-width chars
  { name: 'html_entity_encoding', pattern: /&#?[0-9a-f]{1,6};/i },
  { name: 'url_encoding_abuse',   pattern: /(?:%[0-9a-f]{2}){3,}/i },  // 3+ consecutive URL-encoded chars

  // ── Code / injection attacks ──────────────────────────────────────────────
  { name: 'sql_injection',        pattern: /\b(SELECT|INSERT|UPDATE|DELETE|DROP|TRUNCATE|UNION|ALTER)\s+/i },
  { name: 'xss_injection',        pattern: /<script|javascript:|on\w+\s*=/i },
  { name: 'url_injection',        pattern: /https?:\/\//i },
  { name: 'markdown_code_block',  pattern: /```[\w]*\n[\s\S]{10,} ```/i },  // Large code blocks

  // ── Data exfiltration — PII and tenant data ───────────────────────────────
  { name: 'uuid_leak',            pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
  { name: 'phone_leak',           pattern: /\b\+?\d[\d\s\-(). ]{9,}\d\b/ },

  // ── Tool name leakage — complete list of all registered tools ────────────
  {
    name: 'tool_name_leak',
    pattern: /\b(get_today_summary|book_appointment|cancel_appointment|reschedule_appointment|register_payment|get_client_debt|get_client_appointments|get_inactive_clients|get_revenue_stats|get_monthly_forecast|send_reactivation_message|create_client|get_clients|get_staff|get_services|get_upcoming_gaps|confirm_booking|reschedule_booking|cancel_booking)\b/,
  },

  // ── Structural attacks ───────────────────────────────────────────────────
  { name: 'json_structure_leak',  pattern: /\{"tool":\s*"[^"]+",\s*"arguments":\s*\{/ },  // Tool call structure
  { name: 'base64_encoded_payload', pattern: /(?:[A-Za-z0-9+/]{4}){20,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/ },  // Long base64 strings
]

const SAFE_FALLBACK = 'Lo siento, no pude formular una respuesta adecuada. Por favor, intenta de nuevo.'

/**
 * Valida el output del LLM antes de enviarlo al TTS y al cliente.
 * Retorna el texto original si es seguro, o el fallback si detecta un patrón sospechoso.
 */
export function shieldOutput(text: string, userId?: string): string {
  if (!text?.trim()) return SAFE_FALLBACK

  // Normalize unicode before pattern matching (prevents homoglyph bypasses)
  const normalizedText = text.normalize('NFKC')

  for (const { name, pattern } of INJECTION_PATTERNS) {
    if (pattern.test(normalizedText)) {
      logger.warn('OUTPUT-SHIELD', `Suspicious pattern blocked: ${name}`, { userId })
      return SAFE_FALLBACK
    }
  }

  return text
}
