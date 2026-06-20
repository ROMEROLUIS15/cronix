/**
 * output-sanitizer.ts — Guards the text that reaches the client.
 *
 * The 8B occasionally leaks internal syntax (tool calls, JSON args, catalog UUIDs).
 * These pure helpers strip it and detect it so a hallucinated payload never reaches
 * the customer, and PII is redacted before anything is written to a trace.
 */

const TOOL_NAME_ALTERNATION = '(?:confirm|cancel|reschedule)_booking'

/** Removes leaked tool syntax, JSON args and catalog UUIDs from a model reply. */
export function sanitizeOutput(text: string): string {
  if (!text) return text
  return text
    .replace(/<function=[^>]*>[\s\S]*?<\/function>/gi, '')
    .replace(/<function>[\s\S]*?<\/function>/gi, '')
    .replace(/\[(?:CONFIRM|CANCEL|RESCHEDULE)_[^\]]+\]/gi, '')
    .replace(/\{[\s\S]*?"(?:service_id|client_id|appointment_id|date|time)":[\s\S]*?\}/gi, '')
    // Strip plaintext tool invocations leaking through when tool_choice is 'none'
    .replace(new RegExp(`\\b${TOOL_NAME_ALTERNATION}\\s*\\([^)]*\\)`, 'gi'), '')
    .replace(new RegExp(`\\b${TOOL_NAME_ALTERNATION}\\s*[:=]\\s*\\{[^}]*\\}`, 'gi'), '')
    .replace(new RegExp(`\\b${TOOL_NAME_ALTERNATION}\\b`, 'gi'), '')
    // Strip leaked catalog identifiers: the 8B sometimes echoes the prompt's
    // "Servicio … | REF#<uuid>" line verbatim. Drop the "| REF#uuid" tail first,
    // then any bare UUID still in prose. The REF# id must never reach the client.
    .replace(/\s*\|\s*(?:REF#?\s*)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
    .replace(/\bREF#?\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    // Collapse whitespace left behind
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when the text still carries internal syntax after sanitization. */
export function containsInternalSyntax(text: string): boolean {
  // Bare UUIDs leaked by the 8B when the confirmation gate blocks tool access
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text.trim())) return true
  return new RegExp(`<function[=\\s>]|(?:CONFIRM|CANCEL|RESCHEDULE)_|"service_id"|"client_id"|"appointment_id"|\\b${TOOL_NAME_ALTERNATION}\\b`, 'i').test(text)
}

export const INTERNAL_SYNTAX_FALLBACK = 'Estoy verificando la información. ¿Podrías confirmarme?'

/** Redacts phone numbers and bearer tokens; keeps dates/times intact for debugging. */
export function scrubPII(text: string): string {
  if (!text) return ''
  return text
    .replace(/\+?\d{7,}/g, '[PHONE]')          // 7+ consecutive digits = phone (dates have '-', times ':')
    .replace(/Bearer\s+[\w.\-]+/gi, '[TOKEN]')
    .slice(0, 1000)
}

// A confirmation proposal carrying a date+time. After the deterministic redesign the
// LLM must NEVER emit one of these — if it does, it's a hallucination to catch.
export const BOOKING_PROPOSAL_DETECT_RE = /¿\s*confirmo\s+tu\s+cita\s+de[\s\S]+para\s+el[\s\S]+a\s+las\s+/i
