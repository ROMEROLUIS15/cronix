"use client"

import { useState, useCallback, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { format, addDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameDay, parseISO, addMonths, subMonths } from "date-fns"
import { useBusinessContext } from "@/lib/hooks/use-business-context"
import { getRepos } from "@/lib/repositories"
import { ServicesOnboardingBanner } from "@/components/dashboard/services-onboarding-banner"
import { NoBusinessView } from "../_components/NoBusinessView"
import { DashboardHeader } from "../_components/DashboardHeader"
import { AgendaTab } from "../_components/AgendaTab"
import { ResumenTab } from "../_components/ResumenTab"
import { DayPanel } from "../_components/DayPanel"
import { AptDetailPanel } from "../_components/AptDetailPanel"
import {
  notificationForAppointmentConfirmed,
  notificationForAppointmentCancelled,
} from "@/lib/use-cases/notifications.use-case"
import type { AppointmentStatus, AppointmentWithRelations } from "@/types"
import { logger } from "@/lib/logger"

// ── Types ────────────────────────────────────────────────────────────────────

export interface DashboardStats {
  todayCount:    number
  totalClients:  number
  monthRevenue:  number
  pending:       number
}

interface DashboardClientProps {
  /** Initial stats fetched server-side (for reference, React Query takes over) */
  initialStats: DashboardStats
  /** Whether the business has any services */
  initialHasServices: boolean
  /** Display name for greeting */
  userName: string
}

// ── Client Component ─────────────────────────────────────────────────────────

/**
 * DashboardClient — Full interactivity layer.
 *
 * Owns: UI state (tabs, panels, selected date), mutations, React Query cache.
 * Data fetching is handled by React Query — server-rendered initial data
 * arrives with the HTML and React Query hydrates from there.
 */
export function DashboardClient({
  initialStats,
  initialHasServices,
  userName,
}: DashboardClientProps) {
  const { supabase, businessId } = useBusinessContext()
  const queryClient = useQueryClient()
  const repos = useMemo(() => getRepos(supabase), [supabase])

  // ── UI state ──
  const [tab,           setTab          ] = useState<"agenda" | "resumen">("agenda")
  const [currentMonth,  setCurrentMonth ] = useState<Date>(new Date())
  const [selectedDate,  setSelectedDate ] = useState<Date>(new Date())
  const [selectedApt,   setSelectedApt  ] = useState<AppointmentWithRelations | null>(null)
  const [panelOpen,     setPanelOpen    ] = useState(false)
  const [dayPanelOpen,  setDayPanelOpen ] = useState(false)
  const [updatingStatus,setUpdatingStatus]= useState(false)
  const [deletingId,    setDeletingId   ] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [actionError,   setActionError  ] = useState<string | null>(null)

  // ── React Query: data fetching ────────────────────────────────────────────

  // Compute date range for the current view month
  const rangeStart = format(startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 }), "yyyy-MM-dd")
  const rangeEnd   = format(endOfWeek(endOfMonth(currentMonth),     { weekStartsOn: 1 }), "yyyy-MM-dd")

  // Month appointments
  const { data: monthApts = [], isLoading: loadingApts } = useQuery({
    queryKey: ['appointments', businessId, rangeStart, rangeEnd],
    queryFn: async () => {
      if (!businessId) return []
      const result = await repos.appointments.getMonthAppointments(businessId, rangeStart, rangeEnd)
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
      const todayStr = format(new Date(), "yyyy-MM-dd")
      const monthStart = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "yyyy-MM-dd")
      const result = await repos.appointments.getDashboardStats(businessId, todayStr, monthStart)
      if (result.error) throw new Error(result.error)
      return result.data ?? { todayCount: 0, totalClients: 0, monthRevenue: 0, pending: 0 }
    },
    enabled: !!businessId,
    staleTime: 5 * 60 * 1000,
    initialData: initialStats, // Server-rendered data
  })

  // Has services
  const { data: hasServices } = useQuery({
    queryKey: ['has-services', businessId],
    queryFn: async () => {
      if (!businessId) return false
      const result = await repos.services.hasAny(businessId)
      if (result.error) throw new Error(result.error)
      return result.data ?? false
    },
    enabled: !!businessId,
    staleTime: 5 * 60 * 1000,
    initialData: initialHasServices, // Server-rendered data
  })

  const loading = loadingApts || loadingStats

  // ── Derived state ─────────────────────────────────────────────────────────

  const dayApts = useMemo(
    () => monthApts.filter(a => isSameDay(parseISO(a.start_at), selectedDate)),
    [monthApts, selectedDate],
  )

  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 })
    const end   = endOfWeek(endOfMonth(currentMonth),     { weekStartsOn: 1 })
    const days: Date[] = []
    let cur = start
    while (cur <= end) { days.push(cur); cur = addDays(cur, 1) }
    return days
  }, [currentMonth])

  // ── Panel handlers ────────────────────────────────────────────────────────

  const handleDayClick = useCallback((day: Date) => {
    setSelectedDate(day); setDayPanelOpen(true); setSelectedApt(null); setPanelOpen(false)
  }, [])

  const openAptPanel  = useCallback((apt: AppointmentWithRelations) => {
    setSelectedApt(apt); setPanelOpen(true)
  }, [])

  const closeAptPanel = useCallback(() => {
    setPanelOpen(false); setTimeout(() => setSelectedApt(null), 300)
  }, [])

  const closeDayPanel = useCallback(() => {
    setDayPanelOpen(false); setPanelOpen(false)
  }, [])

  // ── Mutations via React Query ─────────────────────────────────────────────

  const updateStatusMutation = useMutation({
    mutationFn: async ({ appointmentId, status }: { appointmentId: string; status: string }) => {
      if (!businessId) throw new Error('No business ID')
      const result = await repos.appointments.updateStatus(appointmentId, status, businessId)
      if (result.error) throw new Error(result.error)
      return { appointmentId, status }
    },
    onMutate: async ({ appointmentId, status }) => {
      // Optimistic update
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

  const handleUpdateStatus = useCallback(async (status: AppointmentStatus) => {
    if (!selectedApt || !businessId) return
    setUpdatingStatus(true)
    try {
      await updateStatusMutation.mutateAsync({ appointmentId: selectedApt.id, status })
      setSelectedApt(prev => prev ? { ...prev, status } : null)

      // Create notification for status changes
      if (status === 'confirmed' && selectedApt.status !== 'confirmed') {
        const payload = notificationForAppointmentConfirmed(
          businessId,
          selectedApt.client?.name  ?? 'cliente',
          selectedApt.service?.name ?? 'servicio',
          new Date(selectedApt.start_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
        )
        void repos.notifications.create(payload)
          .catch((err: Error) => logger.error('dashboard', `Failed to create confirmation notification: ${err.message}`))
      } else if (status === 'cancelled' && selectedApt.status !== 'cancelled') {
        const payload = notificationForAppointmentCancelled(
          businessId,
          selectedApt.client?.name  ?? 'cliente',
          selectedApt.service?.name ?? 'servicio',
        )
        void repos.notifications.create(payload)
          .catch((err: Error) => logger.error('dashboard', `Failed to create cancellation notification: ${err.message}`))
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Error updating status')
    } finally {
      setUpdatingStatus(false)
    }
  }, [selectedApt, businessId, repos, updateStatusMutation])

  const deleteAppointment = useCallback(async (id: string) => {
    setDeletingId(id)
    try {
      if (!businessId) throw new Error('No business ID')
      const result = await repos.appointments.updateStatus(id, 'cancelled', businessId)
      if (result.error) throw new Error(result.error)
      setConfirmDelete(null)
      if (selectedApt?.id === id) { setPanelOpen(false); setSelectedApt(null) }
      void queryClient.invalidateQueries({ queryKey: ['appointments', businessId] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-stats', businessId] })
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Error deleting appointment')
    } finally {
      setDeletingId(null)
    }
  }, [businessId, repos, selectedApt, queryClient])

  const quickConfirmApt = useCallback(async (aptId: string) => {
    setUpdatingStatus(true)
    try {
      if (!businessId) throw new Error('No business ID')
      const result = await repos.appointments.updateStatus(aptId, 'confirmed', businessId)
      if (result.error) logger.error('dashboard', `Quick confirm failed: ${result.error}`)
      else void queryClient.invalidateQueries({ queryKey: ['appointments', businessId] })
    } finally {
      setUpdatingStatus(false)
    }
  }, [businessId, repos, queryClient])

  const goToPrevMonth = useCallback(() => setCurrentMonth(m => subMonths(m, 1)), [])
  const goToNextMonth = useCallback(() => setCurrentMonth(m => addMonths(m, 1)), [])

  // ── Render ────────────────────────────────────────────────────────────────

  // Guard: no business configured
  if (!loading && !businessId) return <NoBusinessView />

  return (
    <div className="flex h-full relative">
      {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
      <div className={`flex-1 min-w-0 space-y-4 md:space-y-3 animate-fade-in transition-all duration-300
        ${dayPanelOpen || panelOpen ? "lg:mr-80 xl:mr-96" : ""}`}
      >
        <DashboardHeader
          tab={tab}
          onTabChange={setTab}
          userName={userName}
        />

        {hasServices !== null && (
          <ServicesOnboardingBanner businessId={businessId ?? ""} hasServices={hasServices} />
        )}

        {tab === "agenda" && (
          <AgendaTab
            currentMonth={currentMonth}
            selectedDate={selectedDate}
            monthApts={monthApts}
            calendarDays={calendarDays}
            loading={loading}
            dayPanelOpen={dayPanelOpen}
            onPrevMonth={goToPrevMonth}
            onNextMonth={goToNextMonth}
            onDayClick={handleDayClick}
          />
        )}

        {tab === "resumen" && (
          <ResumenTab stats={stats ?? { todayCount: 0, totalClients: 0, monthRevenue: 0, pending: 0 }} />
        )}
      </div>

      {/* ── PANELS ───────────────────────────────────────────────────────── */}
      <DayPanel
        isOpen={dayPanelOpen}
        aptPanelOpen={panelOpen}
        selectedDate={selectedDate}
        dayApts={dayApts}
        loading={loading}
        updatingStatus={updatingStatus}
        deletingId={deletingId}
        confirmDelete={confirmDelete}
        onClose={closeDayPanel}
        onAptClick={openAptPanel}
        onConfirmDelete={setConfirmDelete}
        onDeleteApt={deleteAppointment}
        onQuickConfirm={quickConfirmApt}
      />

      <AptDetailPanel
        isOpen={panelOpen}
        apt={selectedApt}
        updatingStatus={updatingStatus}
        actionError={actionError}
        onClose={closeAptPanel}
        onStatusChange={handleUpdateStatus}
        onClearError={() => setActionError(null)}
      />

      {/* Backdrop — mobile only */}
      {(dayPanelOpen || panelOpen) && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 animate-fade-in"
          onClick={() => { closeDayPanel(); closeAptPanel() }}
        />
      )}
    </div>
  )
}
