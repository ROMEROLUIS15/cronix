/**
 * use-dashboard-data — Extracts all data fetching and mutations from the
 * dashboard client component into a reusable hook.
 *
 * Uses getContainer() from @/lib/container instead of getRepos(supabase).
 */

'use client';

import { useState, useCallback, useEffect } from 'react'
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

import { parseISO, isPast } from 'date-fns' // For simpler time checking

// ── Hook ─────────────────────────────────────────────────────────────────────

interface UseDashboardDataProps {
  businessId: string | null
  initialStats: DashboardStats
  initialHasServices: boolean
  /**
   * Server-pre-fetched appointments for the current month range. When provided,
   * React Query uses them as initialData so the calendar paints filled on the
   * first frame instead of waiting for the client-side fetch. Only valid for
   * the initial range — month navigation still fetches normally.
   */
  initialMonthApts?: AppointmentWithRelations[]
  /** YYYY-MM-DD start of the range matching initialMonthApts. */
  initialRangeStart?: string
  /** YYYY-MM-DD end of the range matching initialMonthApts. */
  initialRangeEnd?: string
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
  initialMonthApts,
  initialRangeStart,
  initialRangeEnd,
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

  // Month appointments. The current visible range only receives SSR initialData
  // when it matches what the server pre-fetched (initial mount); navigating to
  // a different month falls back to a normal client fetch.
  const useInitialMonthData =
    !!initialMonthApts
    && initialRangeStart === rangeStart
    && initialRangeEnd   === rangeEnd

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
    ...(useInitialMonthData ? { initialData: initialMonthApts } : {}),
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

  // Realtime appointment invalidation lives in <VoiceAssistantFab/> on the
  // dashboard layout — `cronix-realtime-{businessId}` already listens to every
  // event on the appointments table and invalidates the same React Query keys.
  // Subscribing here again would open a second WebSocket channel for the same
  // events and trigger duplicate invalidations on every write. Don't do it.

  // ── Auto-Completion Hook ────────────────────────────────────────────────
  // Walk past appointments whose end_at is in the past, fire-and-forget the
  // status updates in parallel. Previously this was a sequential `for await`
  // loop: with N expired rows the dashboard paid N serial Supabase round-trips
  // before settling, each one re-triggering invalidations through the realtime
  // channel. Promise.allSettled fans them out concurrently and lets the rest
  // of the UI carry on.
  useEffect(() => {
    if (loadingApts || !businessId || !monthApts || monthApts.length === 0) return

    const parts = new Date().toISOString().split('T')
    const todayStr = parts[0]
    if (!todayStr) return

    const expired = monthApts.filter(apt => {
      if (apt.status !== 'pending' && apt.status !== 'confirmed') return false
      return isPast(parseISO(apt.end_at))
    })

    if (expired.length === 0) return

    void Promise.allSettled(
      expired.map(apt =>
        updateStatusMutation.mutateAsync({ appointmentId: apt.id, status: 'completed' })
          .then(() => logger.info('dashboard', `Auto-checked out appointment ${apt.id}`))
          .catch(() => logger.error('dashboard', `Failed to auto-checkout ${apt.id}`)),
      ),
    )
  }, [monthApts, loadingApts, businessId, updateStatusMutation])

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
          tag: `confirmed-${selectedApt.id}`,
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
          tag: `cancelled-${selectedApt.id}`,
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
      await updateStatusMutation.mutateAsync({ appointmentId: id, status: 'cancelled' })

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
          tag: `deleted-${id}`,
        })
      }

      setConfirmDelete(null)
      if (selectedApt?.id === id) onDone?.()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Error deleting appointment')
    } finally {
      setDeletingId(null)
    }
  }, [businessId, updateStatusMutation])

  const quickConfirmApt = useCallback(async (aptId: string) => {
    setUpdatingStatus(true)
    try {
      if (!businessId) throw new Error('No business ID')

      // The appointment is already in the React Query cache (the calendar is
      // displaying it). A second fetch to look it up by ID was wasted round-trip.
      const cachedApts = queryClient.getQueryData<AppointmentWithRelations[]>(
        ['appointments', businessId, rangeStart, rangeEnd],
      )
      const apt = cachedApts?.find(a => a.id === aptId)

      await updateStatusMutation.mutateAsync({ appointmentId: aptId, status: 'confirmed' })

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
          tag: `confirmed-${aptId}`,
        })
      }
    } finally {
      setUpdatingStatus(false)
    }
  }, [businessId, queryClient, rangeStart, rangeEnd, updateStatusMutation])

  // ── Return ──────────────────────────────────────────────────────────────

  return {
    monthApts: monthApts.filter(apt => apt.status !== 'cancelled'),
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
