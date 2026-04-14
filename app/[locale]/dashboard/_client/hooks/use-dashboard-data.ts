/**
 * use-dashboard-data — Extracts all data fetching and mutations from the
 * dashboard client component into a reusable hook.
 *
 * Uses getContainer() from @/lib/container instead of getRepos(supabase).
 */

'use client';

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths } from 'date-fns'
import { getBrowserContainer } from '@/lib/browser-container'
import {
  notificationForAppointmentConfirmed,
  notificationForAppointmentCancelled,
} from '@/lib/use-cases/notifications.use-case'
import { notifyOwner } from '@/lib/services/push-notify.service'
import { logger } from '@/lib/logger'
import type { AppointmentStatus, AppointmentWithRelations } from '@/types'
import type { DashboardStats } from '@/app/[locale]/dashboard/_hooks/useDashboard'

// ── Hook ─────────────────────────────────────────────────────────────────────

interface UseDashboardDataProps {
  businessId: string | null
  initialStats: DashboardStats
  initialHasServices: boolean
}

export interface UseDashboardDataReturn {
  // Data
  monthApts: AppointmentWithRelations[]
  stats: DashboardStats
  hasServices: boolean | undefined
  loading: boolean

  // Date helpers
  calendarDays: Date[]

  // Navigation
  currentMonth: Date
  setCurrentMonth: React.Dispatch<React.SetStateAction<Date>>
  goToPrevMonth: () => void
  goToNextMonth: () => void

  // Mutations
  handleUpdateStatus: (status: AppointmentStatus, selectedApt: AppointmentWithRelations | null, onSuccess?: () => void) => Promise<void>
  deleteAppointment: (id: string, selectedApt: AppointmentWithRelations | null, onDone?: () => void) => Promise<void>
  quickConfirmApt: (aptId: string) => Promise<void>

  // Mutation state
  updatingStatus: boolean
  deletingId: string | null
  actionError: string | null
  setActionError: React.Dispatch<React.SetStateAction<string | null>>
  setConfirmDelete: React.Dispatch<React.SetStateAction<string | null>>
  confirmDelete: string | null
}

export function useDashboardData({
  businessId,
  initialStats,
  initialHasServices,
}: UseDashboardDataProps): UseDashboardDataReturn {
  const queryClient = useQueryClient()

  // Date state
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date())

  // Mutation UI state
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // ── Date range computation ──────────────────────────────────────────────
  const rangeStart = format(startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const rangeEnd = format(endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 }), 'yyyy-MM-dd')

  // ── React Query: data fetching ──────────────────────────────────────────

  // Month appointments
  const { data: monthApts = [], isLoading: loadingApts } = useQuery({
    queryKey: ['appointments', businessId, rangeStart, rangeEnd],
    queryFn: async () => {
      if (!businessId) return []
      const container = getBrowserContainer()
      const result = await container.appointments.getMonthAppointments(businessId, rangeStart, rangeEnd)
      if (result.error) throw new Error(result.error)
      return result.data ?? []
    },
    enabled: !!businessId,
    staleTime: 5 * 60 * 1000,
  })

  // Dashboard stats
  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ['dashboard-stats', businessId],
    queryFn: async () => {
      if (!businessId) return { todayCount: 0, totalClients: 0, monthRevenue: 0, pending: 0 }
      const todayStr = format(new Date(), 'yyyy-MM-dd')
      const monthStart = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd')
      const container = getBrowserContainer()
      const result = await container.appointments.getDashboardStats(businessId, todayStr, monthStart)
      if (result.error) throw new Error(result.error)
      return result.data ?? { todayCount: 0, totalClients: 0, monthRevenue: 0, pending: 0 }
    },
    enabled: !!businessId,
    staleTime: 5 * 60 * 1000,
    initialData: initialStats,
  })

  // Has services
  const { data: hasServices } = useQuery({
    queryKey: ['has-services', businessId],
    queryFn: async () => {
      if (!businessId) return false
      const container = getBrowserContainer()
      const result = await container.services.hasAny(businessId)
      if (result.error) throw new Error(result.error)
      return result.data ?? false
    },
    enabled: !!businessId,
    staleTime: 5 * 60 * 1000,
    initialData: initialHasServices,
  })

  const loading = loadingApts || loadingStats

  // ── Derived state ───────────────────────────────────────────────────────

  const calendarDays = useCallback(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 })
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 })
    const days: Date[] = []
    let cur = start
    while (cur <= end) { days.push(cur); cur = addDays(cur, 1) }
    return days
  }, [currentMonth])()

  // ── Navigation ──────────────────────────────────────────────────────────

  const goToPrevMonth = useCallback(() => setCurrentMonth(m => subMonths(m, 1)), [])
  const goToNextMonth = useCallback(() => setCurrentMonth(m => addMonths(m, 1)), [])

  // ── Mutations via React Query ───────────────────────────────────────────

  const updateStatusMutation = useMutation({
    mutationFn: async ({ appointmentId, status }: { appointmentId: string; status: string }) => {
      if (!businessId) throw new Error('No business ID')
      const container = getBrowserContainer()
      const result = await container.appointments.updateStatus(appointmentId, status, businessId)
      if (result.error) throw new Error(result.error)
      return { appointmentId, status }
    },
    onMutate: async ({ appointmentId, status }) => {
      const previous = queryClient.getQueryData<AppointmentWithRelations[]>(['appointments', businessId, rangeStart, rangeEnd])
      queryClient.setQueryData<AppointmentWithRelations[]>(['appointments', businessId, rangeStart, rangeEnd], (old) =>
        old?.map(a => a.id === appointmentId ? { ...a, status: status as AppointmentStatus } : a)
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData<AppointmentWithRelations[]>(['appointments', businessId, rangeStart, rangeEnd], context?.previous)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['appointments', businessId] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-stats', businessId] })
    },
  })

  const handleUpdateStatus = useCallback(async (
    status: AppointmentStatus,
    selectedApt: AppointmentWithRelations | null,
    onSuccess?: () => void,
  ) => {
    if (!selectedApt || !businessId) return
    setUpdatingStatus(true)
    try {
      await updateStatusMutation.mutateAsync({ appointmentId: selectedApt.id, status })

      // Create notification for status changes
      if (status === 'confirmed' && selectedApt.status !== 'confirmed') {
        const payload = notificationForAppointmentConfirmed(
          businessId,
          selectedApt.client?.name ?? 'cliente',
          selectedApt.service?.name ?? 'servicio',
          new Date(selectedApt.start_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
        )
        const container = getBrowserContainer()
        void container.notifications.create(payload)
          .catch((err: Error) => logger.error('dashboard', `Failed to create confirmation notification: ${err.message}`))

        // Web push notification
        notifyOwner({
          title: payload.title,
          body: payload.content,
          url: '/dashboard',
        })
      } else if (status === 'cancelled' && selectedApt.status !== 'cancelled') {
        const payload = notificationForAppointmentCancelled(
          businessId,
          selectedApt.client?.name ?? 'cliente',
          selectedApt.service?.name ?? 'servicio',
        )
        const container = getBrowserContainer()
        void container.notifications.create(payload)
          .catch((err: Error) => logger.error('dashboard', `Failed to create cancellation notification: ${err.message}`))

        // Web push notification
        notifyOwner({
          title: payload.title,
          body: payload.content,
          url: '/dashboard',
        })
      }
      onSuccess?.()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Error updating status')
    } finally {
      setUpdatingStatus(false)
    }
  }, [businessId, updateStatusMutation])

  const deleteAppointment = useCallback(async (
    id: string,
    selectedApt: AppointmentWithRelations | null,
    onDone?: () => void,
  ) => {
    setDeletingId(id)
    try {
      if (!businessId) throw new Error('No business ID')
      const container = getBrowserContainer()
      const result = await container.appointments.updateStatus(id, 'cancelled', businessId)
      if (result.error) throw new Error(result.error)

      // Create notification for cancellation
      if (selectedApt) {
        const payload = notificationForAppointmentCancelled(
          businessId,
          selectedApt.client?.name ?? 'cliente',
          selectedApt.service?.name ?? 'servicio',
        )
        const container = getBrowserContainer()
        void container.notifications.create(payload)
          .catch((err: Error) => logger.error('dashboard', `Failed to create cancellation notification: ${err.message}`))

        // Web push notification
        notifyOwner({
          title: payload.title,
          body: payload.content,
          url: '/dashboard',
        })
      }

      setConfirmDelete(null)
      if (selectedApt?.id === id) onDone?.()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Error deleting appointment')
    } finally {
      setDeletingId(null)
    }
  }, [businessId])

  const quickConfirmApt = useCallback(async (aptId: string) => {
    setUpdatingStatus(true)
    try {
      if (!businessId) throw new Error('No business ID')
      const container = getBrowserContainer()
      
      // Fetch appointment details before confirming
      const todayStr = new Date().toISOString().split('T')[0]
      if (!todayStr) return
      
      const aptResult = await container.appointments.getMonthAppointments(
        businessId,
        todayStr,
        todayStr,
      )
      
      const apt = aptResult.data?.find(a => a.id === aptId)

      const result = await container.appointments.updateStatus(aptId, 'confirmed', businessId)
      if (result.error) {
        logger.error('dashboard', `Quick confirm failed: ${result.error}`)
        return
      }

      // Create notification for confirmation
      if (apt) {
        const payload = notificationForAppointmentConfirmed(
          businessId,
          apt.client?.name ?? 'cliente',
          apt.service?.name ?? 'servicio',
          new Date(apt.start_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
        )
        const container = getBrowserContainer()
        void container.notifications.create(payload)
          .catch((err: Error) => logger.error('dashboard', `Failed to create confirmation notification: ${err.message}`))

        // Web push notification
        notifyOwner({
          title: payload.title,
          body: payload.content,
          url: '/dashboard',
        })
      }
    } finally {
      setUpdatingStatus(false)
    }
  }, [businessId])

  // ── Return ──────────────────────────────────────────────────────────────

  return {
    monthApts,
    stats,
    hasServices,
    loading,
    calendarDays,
    currentMonth,
    setCurrentMonth,
    goToPrevMonth,
    goToNextMonth,
    handleUpdateStatus,
    deleteAppointment,
    quickConfirmApt,
    updatingStatus,
    deletingId,
    actionError,
    setActionError,
    setConfirmDelete,
    confirmDelete,
  }
}
