'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import { getBrowserContainer } from '@/lib/browser-container'
import { createClient } from '@/lib/supabase/client'
import {
  evaluateDoubleBooking,
  checkEmployeeConflict,
  checkClientConflict,
  getLocalDayBoundaries,
} from '@/lib/use-cases/appointments.use-case'
import type { Client, Service, User, DoubleBookingLevel } from '@/types'
import { useTranslations } from 'next-intl'
import { logger } from '@/lib/logger'

// ── Types ────────────────────────────────────────────────────────────────────

interface AppointmentForm {
  client_id:        string
  service_ids:      string[]
  assigned_user_id: string
  start_at:         string
  status:           string
  notes:            string
}

interface ValidationState {
  doubleBookingLevel: DoubleBookingLevel
  doubleBookingMsg:   string
  slotError:          string | null
  confirmed:          boolean
  validating:         boolean
}

interface BizNotifSettings {
  whatsapp:         boolean
  reminderMinutes:  number
}

interface UseEditAppointmentFormReturn {
  // Data
  clients:    Client[]
  services:   Service[]
  users:      User[]
  loadingData: boolean
  notFound:    boolean

  // Form
  form:       AppointmentForm
  setForm:    React.Dispatch<React.SetStateAction<AppointmentForm>>

  // Computed
  selectedServices: Service[]
  totalDuration:    number
  totalPrice:       number

  // Validation
  validation: ValidationState
  setConfirmed: React.Dispatch<React.SetStateAction<boolean>>

  // Notification settings
  bizNotif:      BizNotifSettings
  skipReminder:  boolean
  setSkipReminder: React.Dispatch<React.SetStateAction<boolean>>

  // Submit
  saving:   boolean
  msg:      { type: 'success' | 'error'; text: string } | null
  handleSubmit: (e: React.FormEvent) => Promise<void>
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toDatetimeLocal(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return (
    d.getFullYear()
    + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0')
    + 'T' + String(d.getHours()).padStart(2, '0')
    + ':' + String(d.getMinutes()).padStart(2, '0')
  )
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useEditAppointmentForm(): UseEditAppointmentFormReturn {
  const router              = useRouter()
  const { id: appointmentId } = useParams<{ id: string }>()
  const t                   = useTranslations('appointments.form')
  const statusT             = useTranslations('dashboard')
  const { businessId, loading: contextLoading } = useBusinessContext()

  const [form, setForm] = useState<AppointmentForm>({
    client_id:        '',
    service_ids:      [],
    assigned_user_id: '',
    start_at:         '',
    status:           'pending',
    notes:            '',
  })

  const [clients,     setClients]     = useState<Client[]>([])
  const [services,    setServices]    = useState<Service[]>([])
  const [users,       setUsers]       = useState<User[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [notFound,    setNotFound]    = useState(false)

  const [validation, setValidation] = useState<ValidationState>({
    doubleBookingLevel: 'allowed',
    doubleBookingMsg:   '',
    slotError:          null,
    confirmed:          false,
    validating:         false,
  })

  const [bizNotif,      setBizNotif]      = useState<BizNotifSettings>({ whatsapp: false, reminderMinutes: 1440 })
  const [skipReminder,  setSkipReminder]  = useState(false)
  const [saving,        setSaving]        = useState(false)
  const [msg,           setMsg]           = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // ── Load form data ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!businessId) {
      if (!contextLoading) setLoadingData(false)
      return
    }
    async function init() {
      const container = getBrowserContainer()
      const supabase  = createClient()

      const [clientsResult, servicesResult, membersResult, aptResult, bizSettingsResult, existingReminder] = await Promise.all([
        container.clients.getAll(businessId!),
        container.services.getActive(businessId!),
        container.users.getTeamMembers(businessId!),
        container.appointments.getForEdit(appointmentId, businessId!),
        container.businesses.getSettings(businessId!),
        supabase
          .from('appointment_reminders')
          .select('id')
          .eq('appointment_id', appointmentId)
          .in('status', ['pending', 'sent'])
          .maybeSingle(),
      ])

      setClients((clientsResult.data ?? []) as Client[])
      setServices((servicesResult.data ?? []) as Service[])
      setUsers((membersResult.data ?? []) as User[])

      const aptData = aptResult.data
      if (!aptData) {
        setNotFound(true)
        router.push('/dashboard/appointments')
        return
      }

      const apt = aptData
      // Prefer junction table data; fall back to legacy service_id
      const junctionIds = (apt.appointment_services ?? [])
        .sort((a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order)
        .map((as: { service_id: string }) => as.service_id)
      const serviceIds = junctionIds.length > 0
        ? junctionIds
        : apt.service_id ? [apt.service_id] : []

      setForm({
        client_id:        apt.client_id        ?? '',
        service_ids:      serviceIds,
        assigned_user_id: apt.assigned_user_id ?? '',
        start_at:         toDatetimeLocal(apt.start_at),
        status:           apt.status           ?? 'pending',
        notes:            apt.notes            ?? '',
      })
      const notif = (bizSettingsResult.data?.settings as { notifications?: { whatsapp?: boolean; reminderHours?: number[] } } | null)?.notifications
      const hours  = notif?.reminderHours?.[0] ?? 24
      setBizNotif({ whatsapp: notif?.whatsapp ?? false, reminderMinutes: hours * 60 })
      // Si no hay reminder activo en la BD, el toggle "Omitir" debe estar ON
      setSkipReminder(!existingReminder.data)

      setLoadingData(false)
    }
    init()
  }, [businessId, contextLoading, appointmentId, router])

  // ── Computed ───────────────────────────────────────────────────────────
  const selectedServices = services.filter(s => form.service_ids.includes(s.id))
  const totalDuration    = selectedServices.reduce((sum, s) => sum + s.duration_min, 0)
  const totalPrice       = selectedServices.reduce((sum, s) => sum + s.price, 0)

  // ── Core validation logic (reused by effect debounce AND handleSubmit) ──
  const runValidation = useCallback(async (excludeId: string) => {
    if (!form.client_id || !form.start_at || !form.service_ids.length || !businessId) {
      return { slotBlocked: false, bookingLevel: 'allowed' as DoubleBookingLevel, bookingMsg: '' }
    }

    const container = getBrowserContainer()

    const selectedSvcs = services.filter(s => form.service_ids.includes(s.id))
    const duration     = selectedSvcs.reduce((sum, s) => sum + s.duration_min, 0) || 30
    const startObj = new Date(form.start_at)
    const endObj   = new Date(startObj.getTime() + duration * 60_000)
    const { start, end } = getLocalDayBoundaries(form.start_at)

    const daySlotsResult = await container.appointments.getDaySlots(businessId, start, end)
    const dayApts = daySlotsResult.error ? [] : (daySlotsResult.data ?? [])

    // 1) Employee conflict — each employee can only handle one client at a time.
    if (form.assigned_user_id) {
      const empConflict = checkEmployeeConflict({
        proposedStart: startObj,
        proposedEnd:   endObj,
        existing:      dayApts,
        employeeId:    form.assigned_user_id,
        excludeId,
      })

      if (empConflict.conflicts) {
        const employeeName = users.find(u => u.id === form.assigned_user_id)?.name ?? 'El empleado'
        return {
          slotBlocked: true,
          slotMsg: `${employeeName} ya tiene una cita de ${empConflict.conflictTime}. Disponible desde las ${empConflict.availableFrom}.`,
          bookingLevel: 'blocked' as DoubleBookingLevel,
          bookingMsg: '',
        }
      }
    }

    // 1.5) Unassigned slot conflict
    const unassignedOverlap = dayApts.find(a => {
      if (a.id === excludeId) return false
      if (a.assigned_user_id != null) return false
      const aStart = new Date(a.start_at)
      const aEnd   = new Date(a.end_at)
      return startObj < aEnd && endObj > aStart
    })
    if (unassignedOverlap) {
      const fmt = (d: Date) => d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
      const oStart = new Date(unassignedOverlap.start_at)
      const oEnd   = new Date(unassignedOverlap.end_at)
      return {
        slotBlocked: true,
        slotMsg: `Ya existe una cita sin asignar de ${fmt(oStart)} a ${fmt(oEnd)}. Asígnala a un empleado o elige otro horario.`,
        bookingLevel: 'blocked' as DoubleBookingLevel,
        bookingMsg: '',
      }
    }

    // 2) Client conflict
    const cliConflict = checkClientConflict({
      proposedStart: startObj,
      proposedEnd:   endObj,
      existing:      dayApts,
      clientId:      form.client_id,
      excludeId,
    })

    if (cliConflict.conflicts) {
      const clientName   = clients.find(c => c.id === form.client_id)?.name ?? 'El cliente'
      const assignedName = cliConflict.assignedUserId
        ? users.find(u => u.id === cliConflict.assignedUserId)?.name ?? 'otro empleado'
        : null
      const withText = assignedName ? ` con ${assignedName}` : ''
      return {
        slotBlocked: true,
        slotMsg: `${clientName} ya tiene cita de ${cliConflict.conflictTime}${withText}. Disponible desde las ${cliConflict.availableFrom}.`,
        bookingLevel: 'blocked' as DoubleBookingLevel,
        bookingMsg: '',
      }
    }

    // 3) Double booking count
    const clientApts    = dayApts.filter(a => a.client_id === form.client_id && a.id !== excludeId)
    const existingSlots = clientApts.map(a => ({
      time:    new Date(a.start_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
      service: '',
    }))
    const result = evaluateDoubleBooking({ existingCount: clientApts.length, existingSlots })

    return { slotBlocked: false, bookingLevel: result.level, bookingMsg: result.message }
  }, [form.client_id, form.start_at, form.service_ids, form.assigned_user_id, businessId, services, clients, users])

  // ── Validation: slot overlap + double booking ──────────────────────────
  useEffect(() => {
    setValidation(v => ({ ...v, validating: true, slotError: null }))

    if (!form.client_id || !form.start_at || !form.service_ids.length || !businessId) {
      setValidation({ doubleBookingLevel: 'allowed', doubleBookingMsg: '', slotError: null, confirmed: false, validating: false })
      return
    }

    const timer = setTimeout(async () => {
      const result = await runValidation(appointmentId)
      setValidation(v => ({
        ...v,
        slotError:          result.slotBlocked ? (result.slotMsg ?? null) : null,
        doubleBookingLevel: result.bookingLevel,
        doubleBookingMsg:   result.bookingMsg,
        confirmed:          result.slotBlocked ? v.confirmed : false,
        validating:         false,
      }))
    }, 400)

    return () => { clearTimeout(timer); setValidation(v => ({ ...v, validating: false })) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.client_id, form.start_at, JSON.stringify(form.service_ids), form.assigned_user_id, businessId, services])

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!businessId) return
    setSaving(true)

    // Re-validate right before saving
    const fresh = await runValidation(appointmentId)
    if (fresh.slotBlocked) {
      setValidation(v => ({ ...v, slotError: fresh.slotMsg ?? null, doubleBookingLevel: 'blocked' }))
      setSaving(false)
      return
    }
    if (fresh.bookingLevel === 'blocked') {
      setValidation(v => ({ ...v, doubleBookingLevel: 'blocked', doubleBookingMsg: fresh.bookingMsg }))
      setSaving(false)
      return
    }
    if (fresh.bookingLevel === 'warn' && !validation.confirmed) {
      setValidation(v => ({ ...v, doubleBookingLevel: 'warn', doubleBookingMsg: fresh.bookingMsg }))
      setSaving(false)
      return
    }

    const startObj = new Date(form.start_at)
    const endObj   = new Date(startObj.getTime() + (totalDuration || 30) * 60_000)

    // Update appointment — container doesn't support update yet, use supabase directly
    const supabase = createClient()
    const { error } = await supabase
      .from('appointments')
      .update({
        client_id:        form.client_id,
        service_id:       form.service_ids[0] ?? null,
        assigned_user_id: form.assigned_user_id || null,
        start_at:         startObj.toISOString(),
        end_at:           endObj.toISOString(),
        status:           form.status as 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show',
        notes:            form.notes || null,
        is_dual_booking:  validation.doubleBookingLevel === 'warn',
        updated_at:       new Date().toISOString(),
      })
      .eq('id', appointmentId)
      .eq('business_id', businessId)

    // Sync junction table: delete old rows + insert new ones
    if (!error) {
      await supabase
        .from('appointment_services')
        .delete()
        .eq('appointment_id', appointmentId)

      if (form.service_ids.length > 0) {
        await supabase
          .from('appointment_services')
          .insert(form.service_ids.map((sid, i) => ({
            appointment_id: appointmentId,
            service_id:     sid,
            sort_order:     i,
          })))
      }
    }

    // Handle reminders and notifications via container
    if (!error) {
      const container = getBrowserContainer()
      await container.reminders.cancelByAppointment(appointmentId).catch(() => null)
      if (bizNotif.whatsapp) {
        const remindAt = new Date(Date.UTC(
          startObj.getUTCFullYear(), startObj.getUTCMonth(), startObj.getUTCDate()
        )).toISOString()

        if (!skipReminder) {
          await container.reminders.upsert(appointmentId, businessId, remindAt, 0).catch(() => null)
        } else {
          await supabase.from('appointment_reminders').insert({
            appointment_id: appointmentId,
            business_id:    businessId,
            remind_at:      remindAt,
            minutes_before: 0,
            status:         'cancelled',
            channel:        'whatsapp',
          }).then(() => null, () => null)
        }
      }

      // In-app notification for appointment update
      const clientName  = clients.find(c => c.id === form.client_id)?.name ?? 'cliente'
      const serviceName = services.filter(s => form.service_ids.includes(s.id)).map(s => s.name).join(', ') || 'servicio'
      const timeStr     = startObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })

      const notifPayload = {
        business_id: businessId,
        title: '📝 Cita actualizada',
        content: `${clientName} • ${serviceName} a las ${timeStr}`,
        type: 'info' as const,
        metadata: {
          event: 'appointment.updated',
          appointmentId: appointmentId,
        },
      }
      container.notifications.create(notifPayload).catch(() => null)
    }

    setSaving(false)
    if (error) {
      setMsg({ type: 'error', text: 'Error al actualizar: ' + error.message })
    } else {
      setMsg({ type: 'success', text: 'Cita actualizada correctamente' })
      setTimeout(() => { router.push('/dashboard/appointments'); router.refresh() }, 1200)
    }
  }

  return {
    clients, services, users, loadingData, notFound,
    form, setForm,
    selectedServices, totalDuration, totalPrice,
    validation,
    setConfirmed: useCallback((v: React.SetStateAction<boolean>) => setValidation(prev => ({ ...prev, confirmed: typeof v === 'function' ? v(prev.confirmed) : v })), []),
    bizNotif, skipReminder, setSkipReminder,
    saving, msg, handleSubmit,
  }
}
