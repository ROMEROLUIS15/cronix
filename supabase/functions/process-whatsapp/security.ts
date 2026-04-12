/**
 * Security — QStash signature verification and message sanitization.
 */

import { Receiver }          from "https://esm.sh/@upstash/qstash@2.7.20"
import { captureException, addBreadcrumb } from "../_shared/sentry.ts"

// ── QStash signature verification ────────────────────────────────────────────

export async function verifyQStash(req: Request, rawBody: string): Promise<boolean> {
  try {
    const signature = req.headers.get("Upstash-Signature")

    if (!signature) {
      addBreadcrumb("No Upstash-Signature header found", 'security', 'error')
      return false
    }

    // @ts-ignore — Deno runtime global
    const currentKey = Deno.env.get("QSTASH_CURRENT_SIGNING_KEY")
    // @ts-ignore — Deno runtime global
    const nextKey    = Deno.env.get("QSTASH_NEXT_SIGNING_KEY")

    if (!currentKey || !nextKey) {
      captureException(new Error("QStash signing keys missing in env"), { stage: 'qstash_config' })
      return false
    }

    const receiver = new Receiver({ currentSigningKey: currentKey, nextSigningKey: nextKey })

    const isValid = await receiver.verify({ signature, body: rawBody })
      .catch(err => {
        captureException(err, { stage: 'qstash_verify' })
        return false
      })

    if (!isValid) {
      addBreadcrumb("QStash signature verification failed", 'security', 'warning')
    } else {
      addBreadcrumb("QStash signature valid", 'security', 'info')
    }

    return isValid
  } catch (error) {
    captureException(error, { stage: 'qstash_validation' })
    return false
  }
}

// ── Message sanitization (anti prompt-injection) ──────────────────────────────

export function sanitizeMessage(text: string): string {
  return text
    .slice(0, 500)
    // Normalize unicode homoglyphs and zero-width chars before pattern matching
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '') // zero-width & soft-hyphen
    // Strip fake action tags (prevent crafted commands from bypassing executor)
    .replace(/\[(CONFIRM|RESCHEDULE|CANCEL)_BOOKING[^\]]*\]/gi, '')
    // English injection patterns
    .replace(/ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions?/gi, '')
    .replace(/system\s+prompt\s*:/gi, '')
    .replace(/you\s+are\s+now/gi, '')
    .replace(/act\s+as\s+(?:a\s+)?(?:different|new|another)/gi, '')
    .replace(/disregard\s+(?:all\s+)?(?:previous|prior)\s+(?:instructions?|context)/gi, '')
    .replace(/forget\s+(?:everything|your\s+rules)/gi, '')
    // Spanish injection patterns
    .replace(/ignora?\s+(?:todas?\s+)?(?:las?\s+)?instrucciones?\s*(?:anteriores?|previas?)?/gi, '')
    .replace(/olvida\s+(?:todo|tus\s+reglas|las\s+instrucciones)/gi, '')
    .replace(/(?:eres|actúa|actua|compórtate|comportate)\s+(?:como|ahora)\s+/gi, '')
    .replace(/nuevo\s+rol\s*:/gi, '')
    .replace(/a\s+partir\s+de\s+ahora\s+(?:eres|serás)/gi, '')
    // Unicode-encoded bypass attempts (e.g. %69gnore, &#x69;gnore)
    .replace(/&#?x?[0-9a-f]{1,6};/gi, '')
    .replace(/%[0-9a-f]{2}/gi, '')
    // Strip markdown/XML that could confuse structured prompts
    .replace(/<[^>]+>/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim()
}
