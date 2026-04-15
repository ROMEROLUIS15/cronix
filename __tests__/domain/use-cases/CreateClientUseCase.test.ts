/**
 * CreateClientUseCase.test.ts
 *
 * Tests for CreateClientUseCase.execute():
 *   - Successful registration
 *   - Empty name validation
 *   - Whitespace-only name trimming
 *   - Repo error propagation
 *   - Phone is optional
 */

import { describe, it, expect, vi } from 'vitest'
import { CreateClientUseCase } from '@/lib/domain/use-cases/CreateClientUseCase'
import type { IClientRepository } from '@/lib/domain/repositories/IClientRepository'

function makeClientRepo(overrides: Partial<IClientRepository> = {}): IClientRepository {
  return {
    getById:         vi.fn().mockResolvedValue({ data: null, error: null }),
    findActiveForAI: vi.fn().mockResolvedValue({ data: [], error: null }),
    insert:          vi.fn().mockResolvedValue({
      data: { id: 'cli-uuid-new', name: 'Ana Torres', phone: '3001234567' },
      error: null,
    }),
    ...overrides,
  } as unknown as IClientRepository
}

describe('CreateClientUseCase', () => {

  it('registers client and returns id + name', async () => {
    const repo   = makeClientRepo()
    const uc     = new CreateClientUseCase(repo)
    const result = await uc.execute({ businessId: 'biz-1', name: 'Ana Torres', phone: '3001234567' })

    expect(result.error).toBeNull()
    expect(result.data?.id).toBe('cli-uuid-new')
    expect(result.data?.name).toBe('Ana Torres')
  })

  it('passes businessId and name to repo.insert', async () => {
    const repo = makeClientRepo()
    const uc   = new CreateClientUseCase(repo)
    await uc.execute({ businessId: 'biz-1', name: 'Ana Torres' })

    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ business_id: 'biz-1', name: 'Ana Torres' })
    )
  })

  it('trims whitespace from name before inserting', async () => {
    const repo = makeClientRepo({
      insert: vi.fn().mockResolvedValue({ data: { id: 'cli-1', name: 'Ana Torres', phone: '' }, error: null }),
    })
    const uc = new CreateClientUseCase(repo)
    await uc.execute({ businessId: 'biz-1', name: '   Ana Torres   ' })

    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ana Torres' })
    )
  })

  it('fails with error when name is empty string', async () => {
    const repo   = makeClientRepo()
    const uc     = new CreateClientUseCase(repo)
    const result = await uc.execute({ businessId: 'biz-1', name: '' })

    expect(result.error).toBeTruthy()
    expect(result.data).toBeNull()
    expect(repo.insert).not.toHaveBeenCalled()
  })

  it('fails with error when name is whitespace-only', async () => {
    const repo   = makeClientRepo()
    const uc     = new CreateClientUseCase(repo)
    const result = await uc.execute({ businessId: 'biz-1', name: '   ' })

    expect(result.error).toBeTruthy()
    expect(repo.insert).not.toHaveBeenCalled()
  })

  it('succeeds without phone (phone is optional)', async () => {
    const repo = makeClientRepo({
      insert: vi.fn().mockResolvedValue({ data: { id: 'cli-2', name: 'Pedro', phone: '' }, error: null }),
    })
    const uc     = new CreateClientUseCase(repo)
    const result = await uc.execute({ businessId: 'biz-1', name: 'Pedro' })

    expect(result.error).toBeNull()
    expect(result.data?.id).toBe('cli-2')
  })

  it('propagates repo error', async () => {
    const repo = makeClientRepo({
      insert: vi.fn().mockResolvedValue({ data: null, error: 'Unique constraint violation' }),
    })
    const uc     = new CreateClientUseCase(repo)
    const result = await uc.execute({ businessId: 'biz-1', name: 'Test' })

    expect(result.error).toBeTruthy()
    expect(result.data).toBeNull()
  })

  it('fails when repo returns null data without error', async () => {
    const repo = makeClientRepo({
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    })
    const uc     = new CreateClientUseCase(repo)
    const result = await uc.execute({ businessId: 'biz-1', name: 'Test' })

    expect(result.error).toBeTruthy()
    expect(result.data).toBeNull()
  })

  it('passes trimmed phone to repo when provided', async () => {
    const repo = makeClientRepo({
      insert: vi.fn().mockResolvedValue({ data: { id: 'cli-3', name: 'Luis', phone: '3009876543' }, error: null }),
    })
    const uc = new CreateClientUseCase(repo)
    await uc.execute({ businessId: 'biz-1', name: 'Luis', phone: '  3009876543  ' })

    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '3009876543' })
    )
  })
})
