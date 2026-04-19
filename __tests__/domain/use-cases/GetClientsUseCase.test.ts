import { describe, it, expect, vi } from 'vitest'
import { GetClientsUseCase } from '@/lib/domain/use-cases/GetClientsUseCase'
import type { IClientRepository } from '@/lib/domain/repositories'

function makeClient(overrides: object = {}) {
  return { id: 'cli-1', name: 'Ana Torres', phone: '3001234567', ...overrides }
}

function makeClientRepo(overrides: Partial<IClientRepository> = {}): IClientRepository {
  return {
    getById:         vi.fn(),
    findActiveForAI: vi.fn().mockResolvedValue({
      data: [makeClient(), makeClient({ id: 'cli-2', name: 'Pedro Ruiz', phone: null })],
      error: null,
    }),
    insert: vi.fn(),
    ...overrides,
  } as unknown as IClientRepository
}

describe('GetClientsUseCase', () => {

  it('returns all clients when no query provided', async () => {
    const uc     = new GetClientsUseCase(makeClientRepo())
    const result = await uc.execute({ businessId: 'biz-1' })

    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(2)
  })

  it('filters clients by query substring (case-insensitive)', async () => {
    const uc     = new GetClientsUseCase(makeClientRepo())
    const result = await uc.execute({ businessId: 'biz-1', query: 'pedro' })

    expect(result.data).toHaveLength(1)
    expect(result.data?.[0].name).toBe('Pedro Ruiz')
  })

  it('returns empty array when no client matches query', async () => {
    const uc     = new GetClientsUseCase(makeClientRepo())
    const result = await uc.execute({ businessId: 'biz-1', query: 'zzznomatch' })

    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(0)
  })

  it('ignores whitespace-only query and returns all clients', async () => {
    const uc     = new GetClientsUseCase(makeClientRepo())
    const result = await uc.execute({ businessId: 'biz-1', query: '   ' })

    expect(result.data).toHaveLength(2)
  })

  it('returns email as null for all clients', async () => {
    const uc     = new GetClientsUseCase(makeClientRepo())
    const result = await uc.execute({ businessId: 'biz-1' })

    expect(result.data?.every((c) => c.email === null)).toBe(true)
  })

  it('propagates null phone from repo', async () => {
    const uc     = new GetClientsUseCase(makeClientRepo())
    const result = await uc.execute({ businessId: 'biz-1', query: 'Pedro' })

    expect(result.data?.[0].phone).toBeNull()
  })

  it('propagates repo error', async () => {
    const repo = makeClientRepo({
      findActiveForAI: vi.fn().mockResolvedValue({ data: null, error: 'DB timeout' }),
    })
    const uc     = new GetClientsUseCase(repo)
    const result = await uc.execute({ businessId: 'biz-1' })

    expect(result.error).toBeTruthy()
    expect(result.data).toBeNull()
  })

  it('returns empty array when repo returns null data without error', async () => {
    const repo = makeClientRepo({
      findActiveForAI: vi.fn().mockResolvedValue({ data: null, error: null }),
    })
    const uc     = new GetClientsUseCase(repo)
    const result = await uc.execute({ businessId: 'biz-1' })

    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(0)
  })
})
