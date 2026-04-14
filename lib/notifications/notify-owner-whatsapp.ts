/**
 * notify-owner-whatsapp.ts — Send WhatsApp notification to business owner.
 *
 * Calls the whatsapp-service Edge Function to send a template message
 * to the business owner's phone number.
 */

import { createClient } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'

export interface WhatsAppOwnerParams {
  phone: string
  clientName: string
  serviceName: string
  date: string
  time: string
  type: 'created' | 'confirmed' | 'cancelled' | 'rescheduled'
}

/**
 * Sends a WhatsApp notification to the business owner.
 * Fire-and-forget — errors are logged but never thrown.
 */
export async function notifyOwnerWhatsApp(params: WhatsAppOwnerParams): Promise<void> {
  try {
    const supabase = createClient()
    
    // Build message based on type
    let message = ''
    switch (params.type) {
      case 'created':
      case 'confirmed':
        message = `¡Nueva cita agendada! 👋\n\nCliente: *${params.clientName}*\nServicio: *${params.serviceName}*\nFecha: *${params.date}*\nHora: *${params.time}*\n\n¡Tu agenda ha sido actualizada! 💪`
        break
      case 'cancelled':
        message = `¡Cita cancelada! ❌\n\nCliente: *${params.clientName}*\nServicio: *${params.serviceName}*\nFecha: *${params.date}*\nHora: *${params.time}*\n\n¡Tienes un nuevo espacio libre! 💪`
        break
      case 'rescheduled':
        message = `¡Cita reagendada! 🔄\n\nCliente: *${params.clientName}*\nServicio: *${params.serviceName}*\nNueva fecha: *${params.date}*\nNueva hora: *${params.time}*\n\n¡Tu agenda ha sido actualizada! 💪`
        break
    }

    const { error } = await supabase.functions.invoke('whatsapp-service', {
      body: {
        to: params.phone,
        clientName: params.clientName,
        businessName: 'tu negocio', // Will be overridden by template
        date: params.date,
        time: params.time,
        message, // Custom message for owner notification
      },
    })
    
    if (error) {
      logger.warn('whatsapp-owner', 'invoke error', error.message)
    }
  } catch (err) {
    logger.warn('whatsapp-owner', 'unexpected error', err)
  }
}
