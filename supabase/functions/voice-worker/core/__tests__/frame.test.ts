import { describe, it, expect } from 'vitest'
import {
  buildUserCorpus,
  findLastFrameBoundary,
  isTerminalAssistantMessage,
  type ChatTurn,
} from '../conversation/frame.ts'

describe('isTerminalAssistantMessage', () => {
  it('treats "Listo. Agendé..." as terminal', () => {
    expect(isTerminalAssistantMessage('Listo. Agendé a Luis para el 21 de mayo a las 15:00.')).toBe(true)
  })

  it('treats "Listo. Cancelé..." as terminal', () => {
    expect(isTerminalAssistantMessage('Listo. Cancelé la cita de Luis.')).toBe(true)
  })

  it('treats "Listo. Reagendé..." as terminal', () => {
    expect(isTerminalAssistantMessage('Listo. Reagendé la cita de Luis para el 22 de mayo.')).toBe(true)
  })

  it('treats "No encontré..." as terminal', () => {
    expect(isTerminalAssistantMessage('No encontré cita activa para Luis.')).toBe(true)
  })

  it('treats "No pude..." as terminal', () => {
    expect(isTerminalAssistantMessage('No pude crear la cita: error desconocido.')).toBe(true)
  })

  it('does NOT treat a question as terminal', () => {
    expect(isTerminalAssistantMessage('¿Para qué servicio?')).toBe(false)
  })

  it('does NOT treat an intermediate confirmation without ? as terminal', () => {
    expect(isTerminalAssistantMessage('Perfecto, te confirmo: 21 de mayo a las 3pm')).toBe(false)
  })

  it('does NOT treat a plain narrative line as terminal', () => {
    expect(isTerminalAssistantMessage('Tengo varios servicios disponibles')).toBe(false)
  })

  it('treats delete-client success as terminal (dangling-name regression)', () => {
    expect(isTerminalAssistantMessage('Cliente Carmen Soto (teléfono 04141234567) eliminado.')).toBe(true)
    expect(isTerminalAssistantMessage('Cliente Pedro eliminado.')).toBe(true)
  })

  it('does NOT close on create-client success (feeds "ahora agéndalo")', () => {
    expect(isTerminalAssistantMessage('Cliente "Pedro Pérez" registrado.')).toBe(false)
  })

  it('does NOT close on delete refusal (feeds "cancélalas primero")', () => {
    expect(isTerminalAssistantMessage('No se puede eliminar: Ana tiene 2 cita(s) futura(s). Cancélalas primero.')).toBe(false)
  })

  it('does NOT close on READ listings (feed the next write\'s anaphora)', () => {
    expect(isTerminalAssistantMessage('Tienes 3 citas el lunes 15 de junio. Ana a las 9 para Corte.')).toBe(false)
    expect(isTerminalAssistantMessage('Horarios libres el lunes: 9 de la mañana, 9 y media.')).toBe(false)
    expect(isTerminalAssistantMessage('Sí, Ana Torres está entre tus clientes, su teléfono es 04141234567.')).toBe(false)
  })
})

describe('findLastFrameBoundary', () => {
  it('returns -1 when no assistant message is terminal', () => {
    const h: ChatTurn[] = [
      { role: 'user',      content: 'agenda a Luis para el 21 de mayo a las 3pm' },
      { role: 'assistant', content: '¿Para qué servicio?' },
      { role: 'user',      content: 'corte' },
    ]
    expect(findLastFrameBoundary(h)).toBe(-1)
  })

  it('returns the index of the last "Listo." assistant message', () => {
    const h: ChatTurn[] = [
      { role: 'user',      content: 'agenda a Luis para mañana a las 3pm para corte' },
      { role: 'assistant', content: 'Listo. Agendé a Luis para corte mañana a las 15:00.' },
      { role: 'user',      content: 'ahora agenda a María' },
    ]
    expect(findLastFrameBoundary(h)).toBe(1)
  })
})

describe('buildUserCorpus — multi-turn collection (the reported bug)', () => {
  const inputText = 'corte'
  const history: ChatTurn[] = [
    { role: 'user',      content: 'agéndame a Luis Romero para el 21 de mayo a las 3pm' },
    { role: 'assistant', content: '¿Para qué servicio?' },
  ]

  it('keeps the first-turn date and time inside the corpus', () => {
    const { corpus } = buildUserCorpus(inputText, history)
    expect(corpus).toContain('21 de mayo')
    expect(corpus).toContain('3pm')
    expect(corpus).toContain('Luis Romero')
    expect(corpus).toContain('corte')
  })

  it('survives intermediate confirmations without ? (no premature cut)', () => {
    const withConfirmation: ChatTurn[] = [
      { role: 'user',      content: 'agéndame a Luis Romero para el 21 de mayo a las 3pm' },
      { role: 'assistant', content: '¿Para qué servicio?' },
      { role: 'user',      content: 'corte' },
      { role: 'assistant', content: 'Perfecto, te confirmo: corte el 21 de mayo a las 3pm' },
    ]
    const { corpus, cutoff } = buildUserCorpus('sí', withConfirmation)
    expect(cutoff).toBe(-1)
    expect(corpus).toContain('21 de mayo')
    expect(corpus).toContain('Luis Romero')
  })

  it('DOES cut after an explicit success ("Listo. ...")', () => {
    const after: ChatTurn[] = [
      { role: 'user',      content: 'agenda a Luis para el 21 de mayo a las 3pm para corte' },
      { role: 'assistant', content: 'Listo. Agendé a Luis para corte el 21 de mayo a las 15:00.' },
    ]
    const { corpus, cutoff } = buildUserCorpus('ahora agenda a María', after)
    expect(cutoff).toBe(1)
    expect(corpus).not.toContain('Luis')
    expect(corpus).not.toContain('21 de mayo')
    expect(corpus).toContain('María')
  })

  it('DOES cut after a terminal error ("No encontré ...")', () => {
    const after: ChatTurn[] = [
      { role: 'user',      content: 'reagenda a Pedro para el sábado a las 5pm' },
      { role: 'assistant', content: 'No encontré cita activa para Pedro.' },
    ]
    const { corpus, cutoff } = buildUserCorpus('agéndame a Luis', after)
    expect(cutoff).toBe(1)
    expect(corpus).not.toContain('sábado')
    expect(corpus).not.toContain('Pedro')
  })

  it('caps the corpus at 4000 chars', () => {
    const huge = 'x'.repeat(5000)
    const { corpus } = buildUserCorpus(huge, [])
    expect(corpus.length).toBeLessThanOrEqual(4000)
  })
})
