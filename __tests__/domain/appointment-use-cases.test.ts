import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CreateAppointmentUseCase } from '@/lib/domain/use-cases/CreateAppointmentUseCase'
import { CancelAppointmentUseCase } from '@/lib/domain/use-cases/CancelAppointmentUseCase'
import { RescheduleAppointmentUseCase } from '@/lib/domain/use-cases/RescheduleAppointmentUseCase'
import type { IAppointmentQueryRepository, IAppointmentCommandRepository } from '@/lib/domain/repositories'

const BIZ_ID     = 'biz-1'
const CLIENT_ID  = 'cli-1'
const APPT_ID    = 'appt-1'
const START      = '2026-06-09T10:00:00-05:00'
const END        = '2026-06-09T11:00:00-05:00'
const NEW_START  = '2026-06-09T11:30:00-05:00'
const NEW_END    = '2026-06-09T12:00:00-05:00'

function makeQueryRepo(overrides: Partial<IAppointmentQueryRepository> = {}): IAppointmentQueryRepository {
  return {
    getMonthAppointments: vi.fn(),
    getDayAppointments:   vi.fn(),
    getDaySlots:          vi.fn(),
    getForEdit:           vi.fn(),
    findConflicts:        vi.fn().mockResolvedValue({ data: [], error: null }),
    findUpcomingByClient: vi.fn(),
    findByDateRange:      vi.fn(),
    getDashboardStats:    vi.fn(),
    ...overrides,
  } as unknown as IAppointmentQueryRepository
}

function makeCommandRepo(overrides: Partial<IAppointmentCommandRepository> = {}): IAppointmentCommandRepository {
  return {
    create: vi.fn().mockResolvedValue({
      data: { id: 'new-id', business_id: BIZ_ID, client_id: CLIENT_ID, status: 'pending' },
      error: null,
    }),
    updateStatus: vi.fn().mockResolvedValue({ data: undefined, error: null }),
    reschedule:   vi.fn().mockResolvedValue({ data: undefined, error: null }),
    ...overrides,
  } as unknown as IAppointmentCommandRepository
}

describe('Appointment Use Cases — Acceptance Criteria', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('AC-1 — CreateAppointmentUseCase: slot ocupado bloquea creación', () => {
    it('debería fallar con "ocupado" cuando findConflicts retorna conflicto', async () => {
      // Arrange
      const queryRepo = makeQueryRepo({
        findConflicts: vi.fn().mockResolvedValue({ data: [{ id: 'conflict-1' }], error: null }),
      })
      const commandRepo = makeCommandRepo()
      const uc = new CreateAppointmentUseCase(queryRepo, commandRepo)

      // Act
      const result = await uc.execute({
        businessId: BIZ_ID, clientId: CLIENT_ID, serviceIds: ['svc-1'],
        startAt: START, endAt: END,
      })

      // Assert
      expect(result.error).toContain('ocupado')
      expect(result.data).toBeNull()
    })
  })

  describe('AC-2 — CreateAppointmentUseCase: slot libre permite creación', () => {
    it('debería retornar ok con id cuando el slot está libre', async () => {
      // Arrange
      const queryRepo = makeQueryRepo({
        findConflicts: vi.fn().mockResolvedValue({ data: [], error: null }),
      })
      const commandRepo = makeCommandRepo()
      const uc = new CreateAppointmentUseCase(queryRepo, commandRepo)

      // Act
      const result = await uc.execute({
        businessId: BIZ_ID, clientId: CLIENT_ID, serviceIds: ['svc-1'],
        startAt: START, endAt: END,
      })

      // Assert
      expect(result.error).toBeNull()
      expect(result.data?.id).toBeDefined()
    })
  })

  describe('AC-3 — CreateAppointmentUseCase: error de DB en findConflicts retorna fail', () => {
    it('debería fallar cuando findConflicts retorna error de DB', async () => {
      // Arrange
      const queryRepo = makeQueryRepo({
        findConflicts: vi.fn().mockResolvedValue({ data: null, error: 'DB error' }),
      })
      const commandRepo = makeCommandRepo()
      const uc = new CreateAppointmentUseCase(queryRepo, commandRepo)

      // Act
      const result = await uc.execute({
        businessId: BIZ_ID, clientId: CLIENT_ID, serviceIds: ['svc-1'],
        startAt: START, endAt: END,
      })

      // Assert
      expect(result.error).toBeTruthy()
      expect(result.data).toBeNull()
    })
  })

  describe('AC-4 — RescheduleAppointmentUseCase: excluye la propia cita del chequeo de conflicto', () => {
    it('debería pasar appointmentId como 4to argumento a findConflicts y retornar ok', async () => {
      // Arrange
      const queryRepo = makeQueryRepo()
      const commandRepo = makeCommandRepo()
      const uc = new RescheduleAppointmentUseCase(queryRepo, commandRepo)

      // Act
      const result = await uc.execute({
        businessId: BIZ_ID, appointmentId: APPT_ID,
        newStartAt: NEW_START, newEndAt: NEW_END,
      })

      // Assert
      expect(queryRepo.findConflicts).toHaveBeenCalledWith(BIZ_ID, NEW_START, NEW_END, APPT_ID)
      expect(result.error).toBeNull()
    })
  })

  describe('AC-5 — RescheduleAppointmentUseCase: slot nuevo ocupado bloquea reagendamiento', () => {
    it('debería fallar sin llamar a reschedule cuando el nuevo slot está ocupado', async () => {
      // Arrange
      const queryRepo = makeQueryRepo({
        findConflicts: vi.fn().mockResolvedValue({ data: [{ id: 'other-appt' }], error: null }),
      })
      const commandRepo = makeCommandRepo()
      const uc = new RescheduleAppointmentUseCase(queryRepo, commandRepo)

      // Act
      const result = await uc.execute({
        businessId: BIZ_ID, appointmentId: APPT_ID,
        newStartAt: NEW_START, newEndAt: NEW_END,
      })

      // Assert
      expect(result.error).toBeTruthy()
      expect(commandRepo.reschedule).not.toHaveBeenCalled()
    })
  })

  describe('AC-6 — CancelAppointmentUseCase: cancela correctamente', () => {
    it('debería retornar ok y llamar updateStatus con "cancelled" y businessId', async () => {
      // Arrange
      const commandRepo = makeCommandRepo({
        updateStatus: vi.fn().mockResolvedValue({ data: undefined, error: null }),
      })
      const uc = new CancelAppointmentUseCase(commandRepo)

      // Act
      const result = await uc.execute({ appointmentId: APPT_ID, businessId: BIZ_ID })

      // Assert
      expect(result.error).toBeNull()
      expect(commandRepo.updateStatus).toHaveBeenCalledWith(APPT_ID, 'cancelled', BIZ_ID)
    })
  })

  describe('AC-7 — CancelAppointmentUseCase: error de DB retorna fail', () => {
    it('debería fallar cuando updateStatus retorna error', async () => {
      // Arrange
      const commandRepo = makeCommandRepo({
        updateStatus: vi.fn().mockResolvedValue({ data: null, error: 'DB timeout' }),
      })
      const uc = new CancelAppointmentUseCase(commandRepo)

      // Act
      const result = await uc.execute({ appointmentId: APPT_ID, businessId: BIZ_ID })

      // Assert
      expect(result.error).toBeTruthy()
      expect(result.data).toBeNull()
    })
  })
})
