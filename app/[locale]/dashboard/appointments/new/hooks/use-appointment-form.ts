'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import { getContainer } from '@/lib/container'
import { notifyOwner } from '@/lib/services/push-notify.service'
import { parseVoiceCommand } from '@/lib/actions/voice-assistant'
import { notificationForAppointmentCreated } from '@/lib/use-cases/notifications.use-case'
import {
  evaluateDoubleBooking,
  checkEmployeeConflict,
  checkClientConflict,
  getLocalDayBoundaries,
} from '@/lib/use-cases/appointments.use-case'
import type { Client, Service, User, DoubleBookingLevel } from '@/types'
import { logger } from '@/lib/logger'

// ── Web Speech API types ─────────────────────────────────────────────────────
interface SpeechRecognitionEventData {
  readonly results: SpeechRecognitionResultList
}
interface SpeechRecognitionInstance {
  lang:            string
  continuous:      boolean
  interimResults:  boolean
  onstart:         (() => void) | null
  onend:           (() => void) | null
  onerror:         (() => void) | null
  onresult:        ((event: SpeechRecognitionEventData) => void) | null
  start():         void
}
interface SpeechRecognitionConstructor {
  new(): SpeechRecognitionInstance
}
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?:       SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

// ── Types ────────────────────────────────────────────────────────────────────

interface AppointmentForm {
  client_id:        string
  service_ids:      string[]
  assigned_user_id: string
  start_at:         string
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

interface UseAppointmentFormReturn {
  // Data
  clients:    Client[]
  services:   Service[]
  users:      User[]
  loadingData: boolean
  fetchError:  string | null

  // Form
  form:       AppointmentForm
  setForm:    React.Dispatch<React.SetStateAction<AppointmentForm>>

  // Computed
  selectedServices: Service[]
  totalDuration:    number
  totalPrice:       number
  preselectedDate:  string | null

  // Validation
  validation: ValidationState
  setConfirmed: React.Dispatch<React.SetStateAction<boolean>>
  canSubmit:    boolean

  // Notification settings
  bizNotif:      BizNotifSettings
  skipReminder:  boolean
  setSkipReminder: React.Dispatch<React.SetStateAction<boolean>>

  // Submit
  saving:   boolean
  msg:      { type: 'success' | 'error'; text: string } | null
  handleSubmit: (e: React.FormEvent) => Promise<void>

  // Voice
  isListening: boolean
  aiParsing:   boolean
  handleVoiceAssistant: () => void
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAppointmentForm(): UseAppointmentFormReturn {
  const router          = useRouter()
  const searchParams    = useSearchParams()
  const { businessId, loading: contextLoading } = useBusinessContext()
  const preselectedDate = searchParams.get('date')

  const [form,        setForm]        = useState<AppointmentForm>({
    client_id:        '',
    service_ids:      [],
    assigned_user_id: '',
    start_at:         preselectedDate ? `${preselectedDate}T00:00` : '',
    notes:            '',
  })
  const [clients,         setClients]         = useState<Client[]>([])
  const [services,        setServices]        = useState<Service[]>([])
  const [users,           setUsers]           = useState<User[]>([])
  const [loadingData,     setLoadingData]     = useState(true)
  const [fetchError,      setFetchError]      = useState<string | null>(null)

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
  const [isListening,   setIsListening]   = useState(false)
  const [aiParsing,     setIsAiParsing]   = useState(false)

  // ── Load form data ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!businessId) {
      if (!contextLoading) setLoadingData(false)
      return
    }
    async function init() {
      try {
        setFetchError(null)
        const container = await getContainer()

        const [clientsRes, servicesRes, membersRes, bizRes] = await Promise.all([
          container.clients.getAll(businessId!),
          container.services.getActive(businessId!),
          container.users.getTeamMembers(businessId!),
          container.businesses.getSettings(businessId!),
        ])

        if (!clientsRes.error) setClients(clientsRes.data ?? [])
        if (!servicesRes.error) setServices(servicesRes.data as any ?? [])
        if (!membersRes.error) setUsers(membersRes.data as any ?? [])

        if (!bizRes.error && bizRes.data?.settings) {
          const notif = (bizRes.data.settings as { notifications?: { whatsapp?: boolean; reminderHours?: number[] } } | null)?.notifications
          const hours = notif?.reminderHours?.[0] ?? 24
          setBizNotif({ whatsapp: notif?.whatsapp ?? false, reminderMinutes: hours * 60 })
        }
      } catch (err) {
        console.error('Error initializing appointment form:', err)
        setFetchError('No pudimos cargar los datos necesarios. Revisa tu conexión.')
      } finally {
        setLoadingData(false)
      }
    }
    init()
  }, [businessId, contextLoading])

  // ── Computed ───────────────────────────────────────────────────────────
  const selectedServices = services.filter(s => form.service_ids.includes(s.id))
  const totalDuration    = selectedServices.reduce((sum, s) => sum + s.duration_min, 0)
  const totalPrice       = selectedServices.reduce((sum, s) => sum + s.price, 0)

  // ── Validation ─────────────────────────────────────────────────────────
  const runValidation = useCallback(async (opts?: { excludeId?: string }) => {
    if (!form.client_id || !form.start_at || !form.service_ids.length || !businessId) {
      return { slotBlocked: false, bookingLevel: 'allowed' as DoubleBookingLevel, bookingMsg: '' }
    }

    const container = await getContainer()

    const selectedSvcs = services.filter(s => form.service_ids.includes(s.id))
    const duration     = selectedSvcs.reduce((sum, s) => sum + s.duration_min, 0) || 30
    const startObj = new Date(form.start_at)
    const endObj   = new Date(startObj.getTime() + duration * 60_000)
    const { start, end } = getLocalDayBoundaries(form.start_at)

    const daySlotsResult = await container.appointments.getDaySlots(businessId, start, end)
    const dayApts = daySlotsResult.error ? [] : (daySlotsResult.data ?? [])

    // 1) Employee conflict
    if (form.assigned_user_id) {
      const empConflict = checkEmployeeConflict({
        proposedStart: startObj,
        proposedEnd:   endObj,
        existing:      dayApts,
        employeeId:    form.assigned_user_id,
        excludeId:     opts?.excludeId,
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
      if (a.id === opts?.excludeId) return false
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
      excludeId:     opts?.excludeId,
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
    const clientApts    = (dayApts).filter(a => a.client_id === form.client_id && a.id !== opts?.excludeId)
    const existingSlots = clientApts.map(a => ({
      time:    new Date(a.start_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
      service: '',
    }))
    const doubleResult = evaluateDoubleBooking({ existingCount: clientApts.length, existingSlots })

    return { slotBlocked: false, bookingLevel: doubleResult.level, bookingMsg: doubleResult.message }
  }, [form.client_id, form.start_at, form.service_ids, form.assigned_user_id, businessId, services, clients, users])

  // Debounced validation effect
  useEffect(() => {
    setValidation(v => ({ ...v, validating: true, slotError: null }))

    if (!form.client_id || !form.start_at || !form.service_ids.length || !businessId) {
      setValidation({ doubleBookingLevel: 'allowed', doubleBookingMsg: '', slotError: null, confirmed: false, validating: false })
      return
    }

    const t = setTimeout(async () => {
      const result = await runValidation()
      setValidation(v => ({
        ...v,
        slotError:          result.slotBlocked ? (result.slotMsg ?? null) : null,
        doubleBookingLevel: result.bookingLevel,
        doubleBookingMsg:   result.bookingMsg,
        confirmed:          result.slotBlocked ? v.confirmed : false,
        validating:         false,
      }))
    }, 400)

    return () => { clearTimeout(t); setValidation(v => ({ ...v, validating: false })) }
  }, [form.client_id, form.start_at, JSON.stringify(form.service_ids), form.assigned_user_id, businessId, services, runValidation])

  const canSubmit =
    !validation.validating &&
    !validation.slotError &&
    validation.doubleBookingLevel !== 'blocked' &&
    !(validation.doubleBookingLevel === 'warn' && !validation.confirmed)

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!businessId) return
    setSaving(true)

    const fresh = await runValidation()
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

    const container = await getContainer()

    let newApt: { id: string } | null = null
    const result = await container.appointments.create({
      business_id:      businessId,
      client_id:        form.client_id,
      service_ids:      form.service_ids,
      assigned_user_id: form.assigned_user_id || null,
      start_at:         startObj.toISOString(),
      end_at:           endObj.toISOString(),
      notes:            form.notes || null,
      status:           'pending',
      is_dual_booking:  validation.doubleBookingLevel === 'warn',
    })

    if (!result.error) newApt = result.data

    if (newApt) {
      if (bizNotif.whatsapp) {
        const remindAt = new Date(Date.UTC(
          startObj.getUTCFullYear(), startObj.getUTCMonth(), startObj.getUTCDate()
        )).toISOString()

        if (!skipReminder) {
          await container.reminders.upsert(newApt.id, businessId, remindAt, 0)
        } else {
          await container.reminders.forceCancel(newApt.id, businessId, remindAt, 0)
        }
      }

      const clientName  = clients.find(c => c.id === form.client_id)?.name ?? 'cliente'
      const serviceName = selectedServices.map(s => s.name).join(', ') || 'servicio'
      const timeStr     = startObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
      const notifPayload = notificationForAppointmentCreated(businessId, clientName, serviceName, timeStr)
      container.notifications.create(notifPayload)

      notifyOwner({
        title: '📅 Nueva cita agendada',
        body:  `${clientName} · ${serviceName} · ${timeStr}`,
        url:   `/dashboard/appointments/${newApt.id}`,
      }).catch(err => {
        logger.error('Failed to send push notification to owner', err)
      })
    }

    setSaving(false)
    if (!newApt) {
      setMsg({ type: 'error', text: 'Error al crear la cita. Intenta de nuevo.' })
    } else {
      setMsg({ type: 'success', text: 'Cita creada correctamente' })
      setTimeout(() => { router.push('/dashboard/appointments'); router.refresh() }, 1200)
    }
  }

  // ── Voice Assistant ────────────────────────────────────────────────────
  const handleVoiceAssistant = useCallback(() => {
    const win = window as SpeechRecognitionWindow
    const SpeechRecognitionCtor = win.SpeechRecognition ?? win.webkitSpeechRecognition
    if (!SpeechRecognitionCtor) {
      setMsg({ type: 'error', text: 'Tu navegador no soporta reconocimiento de voz.' })
      return
    }

    if (isListening) {
      setIsListening(false)
      return
    }

    const recognition = new SpeechRecognitionCtor()
    recognition.lang = 'es-CO'
    recognition.continuous = false
    recognition.interimResults = false

    recognition.onstart = () => setIsListening(true)
    recognition.onend   = () => setIsListening(false)
    recognition.onerror = () => setIsListening(false)

    recognition.onresult = async (event: SpeechRecognitionEventData) => {
      const transcript = event.results[0]?.[0]?.transcript
      if (!transcript) return

      setIsAiParsing(true)
      const parsed = await parseVoiceCommand(transcript, { services, clients })
      setIsAiParsing(false)

      if (parsed) {
        setForm(f => ({
          ...f,
          client_id:        parsed.client_id        || f.client_id,
          service_ids:      parsed.service_id       ? [parsed.service_id] : f.service_ids,
          start_at:         parsed.date && parsed.time ? `${parsed.date}T${parsed.time}` : f.start_at,
          notes:            parsed.notes            || f.notes,
          assigned_user_id: parsed.assigned_user_id || f.assigned_user_id,
        }))
        setMsg({ type: 'success', text: 'Entendido. He rellenado el formulario por ti.' })
      } else {
        setMsg({ type: 'error', text: 'No pude procesar el comando de voz. Intenta de nuevo.' })
      }
    }

    recognition.start()
  }, [isListening, services, clients])

  return {
    clients, services, users, loadingData, fetchError,
    form, setForm,
    selectedServices, totalDuration, totalPrice, preselectedDate,
    validation,
    setConfirmed: useCallback((v: React.SetStateAction<boolean>) => setValidation(prev => ({ ...prev, confirmed: typeof v === 'function' ? v(prev.confirmed) : v })), []),
    canSubmit,
    bizNotif, skipReminder, setSkipReminder,
    saving, msg, handleSubmit,
    isListening, aiParsing, handleVoiceAssistant,
  }
}
