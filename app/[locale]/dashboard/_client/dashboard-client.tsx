"use client"

import { useState, useCallback, useMemo } from "react"
import dynamic from "next/dynamic"
import { isSameDay, parseISO } from "date-fns"
import { useBusinessContext } from "@/lib/hooks/use-business-context"
import { ServicesOnboardingBanner } from "@/components/dashboard/services-onboarding-banner"
import { WorkingHoursBanner } from "@/components/dashboard/working-hours-banner"
import { NoBusinessView } from "../_components/NoBusinessView"
import { DashboardHeader } from "../_components/DashboardHeader"
import { AgendaTab } from "../_components/AgendaTab"
import type { AppointmentStatus, AppointmentWithRelations } from "@/types"
import { useDashboardData } from "./hooks/use-dashboard-data"

// Off-critical-path widgets — none of these render until the user changes tab
// or opens a panel. Splitting them out of the initial JS bundle trims the
// dashboard's first-load JS by their combined weight (panels alone are ~400
// lines + their date-fns and lucide imports).
const ResumenTab = dynamic(() =>
  import("../_components/ResumenTab").then(m => ({ default: m.ResumenTab })),
)
const DayPanel = dynamic(() =>
  import("../_components/DayPanel").then(m => ({ default: m.DayPanel })),
)
const AptDetailPanel = dynamic(() =>
  import("../_components/AptDetailPanel").then(m => ({ default: m.AptDetailPanel })),
)

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
  /** Server-pre-fetched appointments for the visible month range. */
  initialMonthApts?: AppointmentWithRelations[]
  /** Range start matching initialMonthApts (yyyy-MM-dd). */
  initialRangeStart?: string
  /** Range end matching initialMonthApts (yyyy-MM-dd). */
  initialRangeEnd?: string
  /** Display name for greeting */
  userName: string
}

// ── Client Component ─────────────────────────────────────────────────────────

/**
 * DashboardClient — Full interactivity layer.
 *
 * Owns: UI state (tabs, panels, selected date).
 * Data fetching and mutations are delegated to useDashboardData hook.
 */
export function DashboardClient({
  initialStats,
  initialHasServices,
  initialMonthApts,
  initialRangeStart,
  initialRangeEnd,
  userName,
}: DashboardClientProps) {
  const { businessId } = useBusinessContext()

  // ── Data layer (hook) ─────────────────────────────────────────────────────

  const {
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
  } = useDashboardData({
    businessId,
    initialStats,
    initialHasServices,
    initialMonthApts,
    initialRangeStart,
    initialRangeEnd,
  })

  // ── UI state ──────────────────────────────────────────────────────────────

  const [tab,           setTab          ] = useState<"agenda" | "resumen">("agenda")
  const [selectedDate,  setSelectedDate ] = useState<Date>(new Date())
  const [selectedApt,   setSelectedApt  ] = useState<AppointmentWithRelations | null>(null)
  const [panelOpen,     setPanelOpen    ] = useState(false)
  const [dayPanelOpen,  setDayPanelOpen ] = useState(false)

  // ── Derived state ─────────────────────────────────────────────────────────

  const dayApts = useMemo(
    () => monthApts.filter(a => isSameDay(parseISO(a.start_at), selectedDate)),
    [monthApts, selectedDate],
  )

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

  // ── Mutation wrappers ─────────────────────────────────────────────────────

  const onUpdateStatus = useCallback(async (status: AppointmentStatus) => {
    await handleUpdateStatus(status, selectedApt)
  }, [handleUpdateStatus, selectedApt])

  const onDelete = useCallback(async (id: string) => {
    await deleteAppointment(id, selectedApt, () => { setPanelOpen(false); setSelectedApt(null) })
  }, [deleteAppointment, selectedApt])

  const onClearError = useCallback(() => setActionError(null), [setActionError])

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

        {businessId && <WorkingHoursBanner businessId={businessId} />}

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
          <ResumenTab 
            stats={stats ?? { todayCount: 0, totalClients: 0, monthRevenue: 0, pending: 0 }} 
            monthApts={monthApts}
          />
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
        onDeleteApt={onDelete}
        onQuickConfirm={quickConfirmApt}
      />

      <AptDetailPanel
        isOpen={panelOpen}
        apt={selectedApt}
        updatingStatus={updatingStatus}
        actionError={actionError}
        onClose={closeAptPanel}
        onStatusChange={onUpdateStatus}
        onClearError={onClearError}
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
