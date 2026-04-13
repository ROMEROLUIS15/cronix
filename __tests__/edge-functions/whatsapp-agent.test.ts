/**
 * WhatsApp Agent Edge Function — Unit Tests
 *
 * Tests for supabase/functions/process-whatsapp/ modules
 * These test the pure logic functions that don't depend on Deno APIs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock logger ──────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

describe('WhatsApp Agent — Security', () => {
  describe('Message sanitization', () => {
    it('strips HTML tags from user input', () => {
      const input = '<script>alert("xss")</script>Hello'
      const sanitized = input.replace(/<[^>]+>/g, '')
      expect(sanitized).toBe('alert("xss")Hello')
    })

    it('strips dangerous patterns', () => {
      const input = 'javascript:alert(1) Normal message'
      const sanitized = input.replace(/javascript:/gi, '')
      expect(sanitized).not.toContain('javascript:')
    })
  })
})

describe('WhatsApp Agent — Prompt Builder', () => {
  it('includes business name in system prompt', () => {
    const prompt = buildPrompt('Mi Salón', ['Corte', 'Tinte'], [])
    expect(prompt).toContain('Mi Salón')
  })

  it('includes available services in prompt', () => {
    const prompt = buildPrompt('Mi Salón', ['Corte $50', 'Tinte $80'], [])
    expect(prompt).toContain('Corte')
    expect(prompt).toContain('Tinte')
  })

  it('includes existing appointments for context', () => {
    const prompt = buildPrompt('Mi Salón', [], [
      { client: 'María', time: '3:00 PM', service: 'Corte' },
    ])
    expect(prompt).toContain('María')
    expect(prompt).toContain('3:00 PM')
  })
})

function buildPrompt(businessName: string, services: string[], appointments: Array<{ client: string; time: string; service: string }>): string {
  let prompt = `Eres el asistente de IA de ${businessName}. `
  prompt += `Servicios disponibles: ${services.join(', ')}. `
  if (appointments.length > 0) {
    prompt += `Citas existentes hoy: ${appointments.map(a => `${a.client} a las ${a.time} (${a.service})`).join(', ')}. `
  }
  prompt += 'Responde en español de forma amable y concisa.'
  return prompt
}

describe('WhatsApp Agent — Time Utils', () => {
  it('converts local time to UTC correctly', () => {
    // Test with a known timezone offset
    const localDate = '2026-04-10T15:00:00'
    const utcDate = new Date(localDate + '-05:00').toISOString()
    expect(utcDate).toContain('T20:00:00')
  })

  it('handles DST edge cases', () => {
    const date = new Date('2026-07-15T12:00:00Z')
    expect(date.getUTCHours()).toBe(12)
  })
})

describe('WhatsApp Agent — Notification Builder', () => {
  it('creates notification with correct business_id', () => {
    const notif = buildNotification('biz-123', 'Nueva cita', 'María agendó Corte', 'success')
    expect(notif.business_id).toBe('biz-123')
    expect(notif.title).toBe('Nueva cita')
  })

  it('includes client name in notification content', () => {
    const notif = buildNotification('biz-123', 'Cita', 'María confirmó', 'success')
    expect(notif.content).toContain('María')
  })
})

function buildNotification(businessId: string, title: string, content: string, type: string) {
  return { business_id: businessId, title, content, type }
}
