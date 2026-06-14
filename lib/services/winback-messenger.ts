/**
 * winback-messenger.ts — Concrete adapter for the retention IRetentionMessenger
 * port. Sends the approved Meta win-back template (HSM) via the WhatsApp Edge
 * Function, mapping its boolean result into the domain Result<void>.
 *
 * Spec: docs/specs/modulo-retencion/manifest.md §4, §7.
 */

import { ok, fail, type Result } from '@/types/result'
import { sendReactivationMessage } from '@/lib/services/whatsapp.service'
import type {
  IRetentionMessenger,
  SendWinbackParams,
} from '@/lib/domain/use-cases/retention/types'

/** Approved Meta template name (modulo-retencion §7). */
export const WINBACK_TEMPLATE = 'client_winback'

export class WinbackMessenger implements IRetentionMessenger {
  async sendWinback(params: SendWinbackParams): Promise<Result<void>> {
    const res = await sendReactivationMessage({
      to: params.to,
      clientName: params.clientName,
      businessName: params.businessName,
      template: WINBACK_TEMPLATE,
    })

    if (!res.success) {
      return fail(res.error ?? 'No se pudo enviar la plantilla de reenganche.')
    }
    return ok(undefined)
  }
}
