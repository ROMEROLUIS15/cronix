/**
 * winback-messenger.ts — Concrete adapter for the retention IRetentionMessenger
 * port. Sends the approved Meta win-back template (HSM) via the WhatsApp Edge
 * Function and classifies a failure as platform-wide or recipient-only.
 *
 * Spec: docs/specs/modulo-retencion/manifest.md §4, §7.
 */

import { sendReactivationMessage } from '@/lib/services/whatsapp.service'
import { classifyMetaSendError } from '@/lib/services/whatsapp-error-codes'
import type {
  IRetentionMessenger,
  SendWinbackParams,
  SendWinbackResult,
} from '@/lib/domain/use-cases/retention/types'

/** Approved Meta template name (modulo-retencion §7). */
export const WINBACK_TEMPLATE = 'client_winback'

const DEFAULT_FAILURE_MESSAGE = 'No se pudo enviar la plantilla de reenganche.'

export class WinbackMessenger implements IRetentionMessenger {
  async sendWinback(params: SendWinbackParams): Promise<SendWinbackResult> {
    const res = await sendReactivationMessage({
      to: params.to,
      clientName: params.clientName,
      businessName: params.businessName,
      template: WINBACK_TEMPLATE,
    })

    if (res.success) return { ok: true }

    const code = res.errorCode ?? null
    return {
      ok: false,
      failure: {
        scope: classifyMetaSendError(code),
        code,
        template: WINBACK_TEMPLATE,
        message: res.error ?? DEFAULT_FAILURE_MESSAGE,
      },
    }
  }
}
