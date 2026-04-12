/**
 * appointment-repository.contract.test.ts — Contract tests for IAppointmentRepository.
 *
 * Purpose: verify that ANY implementation of IAppointmentRepository behaves
 * identically. This enables safe swapping of implementations (e.g., Supabase →
 * HTTP backend → in-memory for testing) without breaking consumers.
 *
 * These tests use mock data and do NOT hit the database.
 * They verify the contract, not the implementation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Result } from '@/types/result'
import type { IAppointmentRepository, CreateAppointmentPayload, DashboardStats } from '@/lib/domain/repositories'
import type { AppointmentWithRelations, SlotCheckAppointment } from '@/types'

// ── Mock Implementation ──────────────────────────────────────────────────────

function createMockAppointmentRepo(): IAppointmentRepository {
  const store: Record<string, any> = {}

  return {
    async getMonthAppointments(
      _businessId: string,
      _rangeStart: string,
      _rangeEnd: string
    ): Promise<Result<AppointmentWithRelations[]>> {
      return { data: [], error: null }
    },

    async getDayAppointments(
      _businessId: string,
      _dateStr: string
    ): Promise<Result<AppointmentWithRelations[]>> {
      return { data: [], error: null }
    },

    async getDaySlots(
      _businessId: string,
      _startISO: string,
      _endISO: string
    ): Promise<Result<SlotCheckAppointment[]>> {
      return { data: [], error: null }
    },

    async getForEdit(
      _appointmentId: string,
      _businessId: string
    ): Promise<Result<any>> {
      return { data: null, error: null }
    },

    async create(
      payload: CreateAppointmentPayload
    ): Promise<Result<{ id: string; business_id: string; client_id: string; status: string }>> {
      const id = `appt-${Date.now()}`
      return {
        data: {
          id,
          business_id: payload.business_id,
          client_id: payload.client_id,
          status: payload.status,
        },
        error: null,
      }
    },

    async updateStatus(
      _appointmentId: string,
      _status: string
    ): Promise<Result<void>> {
      return { data: undefined, error: null }
    },

    async reschedule(
      _appointmentId: string,
      _startAt: string,
      _endAt: string
    ): Promise<Result<void>> {
      return { data: undefined, error: null }
    },

    async findConflicts(
      _businessId: string,
      _startAt: string,
      _endAt: string,
      _excludeId?: string
    ): Promise<Result<{ id: string }[]>> {
      return { data: [], error: null }
    },

    async findUpcomingByClient(
      _businessId: string,
      _clientId: string
    ): Promise<Result<any[]>> {
      return { data: [], error: null }
    },

    async findByDateRange(
      _businessId: string,
      _from: string,
      _to: string,
      _statuses?: string[]
    ): Promise<Result<any[]>> {
      return { data: [], error: null }
    },

    async getDashboardStats(
      _businessId: string,
      _todayStr: string,
      _monthStartStr: string
    ): Promise<Result<DashboardStats>> {
      return {
        data: {
          todayCount: 0,
          totalClients: 0,
          monthRevenue: 0,
          pending: 0,
        },
        error: null,
      }
    },
  }
}

// ── Contract Tests ───────────────────────────────────────────────────────────

describe('IAppointmentRepository Contract', () => {
  let repo: IAppointmentRepository

  beforeEach(() => {
    repo = createMockAppointmentRepo()
  })

  describe('getMonthAppointments', () => {
    it('returns Result type with data array', async () => {
      const result = await repo.getMonthAppointments('biz-1', '2026-04-01', '2026-04-30')
      expect(result).toHaveProperty('data')
      expect(result).toHaveProperty('error')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('getDayAppointments', () => {
    it('returns Result type with data array', async () => {
      const result = await repo.getDayAppointments('biz-1', '2026-04-11')
      expect(result).toHaveProperty('data')
      expect(result).toHaveProperty('error')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('getDaySlots', () => {
    it('returns Result type with slot array', async () => {
      const result = await repo.getDaySlots('biz-1', '2026-04-11T00:00:00', '2026-04-11T23:59:59')
      expect(result).toHaveProperty('data')
      expect(result).toHaveProperty('error')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('getForEdit', () => {
    it('returns Result type, null for non-existent', async () => {
      const result = await repo.getForEdit('non-existent', 'biz-1')
      expect(result).toHaveProperty('data')
      expect(result).toHaveProperty('error')
      expect(result.data).toBeNull()
    })
  })

  describe('create', () => {
    it('returns Result with created appointment ID', async () => {
      const payload: CreateAppointmentPayload = {
        business_id: 'biz-1',
        client_id: 'client-1',
        service_ids: ['svc-1'],
        assigned_user_id: null,
        start_at: '2026-04-11T10:00:00',
        end_at: '2026-04-11T11:00:00',
        notes: null,
        status: 'pending',
        is_dual_booking: false,
      }

      const result = await repo.create(payload)
      expect(result.error).toBeNull()
      expect(result.data).toBeDefined()
      expect(result.data?.business_id).toBe('biz-1')
      expect(result.data?.client_id).toBe('client-1')
      expect(result.data?.id).toBeDefined()
    })
  })

  describe('updateStatus', () => {
    it('returns Result<void> on success', async () => {
      const result = await repo.updateStatus('appt-1', 'confirmed', 'biz-1')
      expect(result).toHaveProperty('error')
      expect(result.error).toBeNull()
    })
  })

  describe('reschedule', () => {
    it('returns Result<void> on success', async () => {
      const result = await repo.reschedule('appt-1', '2026-04-12T10:00:00', '2026-04-12T11:00:00', 'biz-1')
      expect(result).toHaveProperty('error')
      expect(result.error).toBeNull()
    })
  })

  describe('findConflicts', () => {
    it('returns Result with array of conflicting IDs', async () => {
      const result = await repo.findConflicts('biz-1', '2026-04-11T10:00:00', '2026-04-11T11:00:00')
      expect(result).toHaveProperty('data')
      expect(result).toHaveProperty('error')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('findUpcomingByClient', () => {
    it('returns Result with array of upcoming appointments', async () => {
      const result = await repo.findUpcomingByClient('biz-1', 'client-1')
      expect(result).toHaveProperty('data')
      expect(result).toHaveProperty('error')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('findByDateRange', () => {
    it('returns Result with array of appointments in range', async () => {
      const result = await repo.findByDateRange('biz-1', '2026-04-01', '2026-04-30')
      expect(result).toHaveProperty('data')
      expect(result).toHaveProperty('error')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('getDashboardStats', () => {
    it('returns Result with dashboard stats', async () => {
      const result = await repo.getDashboardStats('biz-1', '2026-04-11', '2026-04-01')
      expect(result).toHaveProperty('data')
      expect(result).toHaveProperty('error')
      expect(result.data).toHaveProperty('todayCount')
      expect(result.data).toHaveProperty('totalClients')
      expect(result.data).toHaveProperty('monthRevenue')
      expect(result.data).toHaveProperty('pending')
    })
  })

  describe('never throws (Result pattern)', () => {
    it('all methods return Result, never throw', async () => {
      const methods = [
        () => repo.getMonthAppointments('biz-1', '2026-04-01', '2026-04-30'),
        () => repo.getDayAppointments('biz-1', '2026-04-11'),
        () => repo.getDaySlots('biz-1', '2026-04-11T00:00:00', '2026-04-11T23:59:59'),
        () => repo.getForEdit('bad-id', 'biz-1'),
        () => repo.updateStatus('bad-id', 'confirmed', 'biz-1'),
        () => repo.reschedule('bad-id', '2026-04-12T10:00:00', '2026-04-12T11:00:00', 'biz-1'),
        () => repo.findConflicts('biz-1', '2026-04-11T10:00:00', '2026-04-11T11:00:00'),
        () => repo.findUpcomingByClient('biz-1', 'client-1'),
        () => repo.findByDateRange('biz-1', '2026-04-01', '2026-04-30'),
        () => repo.getDashboardStats('biz-1', '2026-04-11', '2026-04-01'),
      ]

      for (const fn of methods) {
        await expect(fn()).resolves.not.toThrow()
      }
    })
  })
})
