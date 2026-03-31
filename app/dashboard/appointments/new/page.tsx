'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  ArrowLeft, CalendarDays, AlertTriangle, Info,
  Loader2, CheckCircle2, AlertCircle, UserPlus, Ban, Bell, BellOff,
  Mic, MicOff
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DualBookingBadge } from '@/components/ui/badge'
import { ClientSelect } from '@/components/ui/client-select'
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import * as clientsRepo from '@/lib/repositories/clients.repo'
import * as servicesRepo from '@/lib/repositories/services.repo'
import * as appointmentsRepo from '@/lib/repositories/appointments.repo'
import * as usersRepo from '@/lib/repositories/users.repo'
import * as businessesRepo from '@/lib/repositories/businesses.repo'
import { upsertReminder } from '@/lib/repositories/reminders.repo'
import { notifyOwner } from '@/lib/services/push-notify.service'
import { parseVoiceCommand } from '@/lib/actions/voice-assistant'
import {
  evaluateDoubleBooking,
  checkEmployeeConflict,
  checkClientConflict,
  getLocalDayBoundaries,
} from '@/lib/use-cases/appointments.use-case'
import type { Client, Service, User, DoubleBookingLevel } from '@/types'
import { DateTimePicker } from '@/components/ui/date-time-picker'

// ── Web Speech API types (not yet in lib.dom.d.ts for this TS version) ────────
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

function fmtReminder(mins: number) {
  if (mins >= 1440) return `${mins / 1440} día${mins >= 2880 ? 's' : ''}`
  if (mins >= 60)   return `${mins / 60} hora${mins >= 120 ? 's' : ''}`
  return `${mins} min`
}

// ── Inner form component ───────────────────────────────────────────────────
function NewAppointmentForm() {
  const router          = useRouter()
  const searchParams    = useSearchParams()
  const { supabase, businessId, loading: contextLoading } = useBusinessContext()
  const preselectedDate = searchParams.get('date') // "yyyy-MM-dd" from calendar click

  const [form,               setForm]               = useState({
    client_id:        '',
    service_ids:      [] as string[],
    assigned_user_id: '',
    start_at:         preselectedDate ? `${preselectedDate}T00:00` : '',
    notes:            '',
  })
  const [clients,            setClients]            = useState<Client[]>([])
  const [services,           setServices]           = useState<Service[]>([])
  const [users,              setUsers]              = useState<User[]>([])
  const [loadingData,        setLoadingData]        = useState(true)
  const [doubleBookingLevel, setDoubleBookingLevel] = useState<DoubleBookingLevel>('allowed')
  const [doubleBookingMsg,   setDoubleBookingMsg]   = useState('')
  const [slotError,          setSlotError]          = useState<string | null>(null)
  const [confirmed,          setConfirmed]          = useState(false)
  const [validating,         setValidating]         = useState(false)
  const [bizNotif,           setBizNotif]           = useState<{ whatsapp: boolean; reminderMinutes: number }>({ whatsapp: false, reminderMinutes: 1440 })
  const [skipReminder,       setSkipReminder]       = useState(false)
  const [saving,             setSaving]             = useState(false)
  const [msg,                setMsg]                = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [isListening,        setIsListening]        = useState(false)
  const [aiParsing,          setAiParsing]          = useState(false)

  // ── Load form data ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!businessId) {
      if (!contextLoading) setLoadingData(false)
      return
    }
    async function init() {
      const [clientsData, servicesData, membersData, bizSettings] = await Promise.all([
        clientsRepo.getClients(supabase, businessId!),
        servicesRepo.getActiveServices(supabase, businessId!),
        usersRepo.getBusinessMembers(supabase, businessId!),
        businessesRepo.getBusinessSettings(supabase, businessId!),
      ])
      setClients(clientsData as Client[])
      setServices(servicesData as Service[])
      setUsers(membersData as User[])
      // Load business notification settings
      const notif = (bizSettings.settings as { notifications?: { whatsapp?: boolean; reminderHours?: number[] } } | null)?.notifications
      const hours  = notif?.reminderHours?.[0] ?? 24
      setBizNotif({ whatsapp: notif?.whatsapp ?? false, reminderMinutes: hours * 60 })
      setLoadingData(false)
    }
    init()
  }, [supabase, businessId, contextLoading])

  const selectedServices = services.filter(s => form.service_ids.includes(s.id))
  const totalDuration    = selectedServices.reduce((sum, s) => sum + s.duration_min, 0)
  const totalPrice       = selectedServices.reduce((sum, s) => sum + s.price, 0)

  // ── Core validation logic (reused by effect debounce AND handleSubmit) ──
  async function runValidation(opts?: { excludeId?: string }) {
    if (!form.client_id || !form.start_at || !form.service_ids.length || !businessId) {
      return { slotBlocked: false, bookingLevel: 'allowed' as DoubleBookingLevel, bookingMsg: '' }
    }

    const selectedSvcs = services.filter(s => form.service_ids.includes(s.id))
    const duration     = selectedSvcs.reduce((sum, s) => sum + s.duration_min, 0) || 30
    const startObj = new Date(form.start_at)
    const endObj   = new Date(startObj.getTime() + duration * 60_000)
    const { start, end } = getLocalDayBoundaries(form.start_at)

    const dayApts = await appointmentsRepo.getDaySlots(supabase, businessId, start, end)

    // 1) Employee conflict — each employee can only handle one client at a time.
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

    // 1.5) Unassigned slot conflict — appointments without employee block the timeslot
    //      for all employees (e.g. AI-created bookings that haven't been assigned yet).
    const unassignedOverlap = dayApts.find(a => {
      if (a.id === opts?.excludeId) return false
      if (a.assigned_user_id != null) return false // skip employee-assigned appointments
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

    // 2) Client conflict — same client can't be in two places at once.
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

    // 3) Double booking count — warn/block by number of appointments that day.
    const clientApts    = (dayApts).filter(a => a.client_id === form.client_id && a.id !== opts?.excludeId)
    const existingSlots = clientApts.map(a => ({
      time:    new Date(a.start_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
      service: '',
    }))
    const result = evaluateDoubleBooking({ existingCount: clientApts.length, existingSlots })

    return { slotBlocked: false, bookingLevel: result.level, bookingMsg: result.message }
  }

  // ── Validation: slot overlap + double booking ──────────────────────────
  useEffect(() => {
    // Mark as validating immediately — disables submit button until check completes
    setValidating(true)
    setSlotError(null)

    if (!form.client_id || !form.start_at || !form.service_ids.length || !businessId) {
      setDoubleBookingLevel('allowed')
      setDoubleBookingMsg('')
      setValidating(false)
      return
    }

    const t = setTimeout(async () => {
      const result = await runValidation()
      setSlotError(result.slotBlocked ? (result.slotMsg ?? null) : null)
      setDoubleBookingLevel(result.bookingLevel)
      setDoubleBookingMsg(result.bookingMsg)
      if (!result.slotBlocked) setConfirmed(false)
      setValidating(false)
    }, 400)

    return () => { clearTimeout(t); setValidating(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.client_id, form.start_at, JSON.stringify(form.service_ids), form.assigned_user_id, businessId, services])

  const canSubmit =
    !validating &&
    !slotError &&
    doubleBookingLevel !== 'blocked' &&
    !(doubleBookingLevel === 'warn' && !confirmed)

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!businessId) return
    setSaving(true)

    // Re-validate right before saving — guards against race conditions where
    // another appointment was created after the debounced check ran.
    const fresh = await runValidation()
    if (fresh.slotBlocked) {
      setSlotError(fresh.slotMsg ?? null)
      setDoubleBookingLevel('blocked')
      setSaving(false)
      return
    }
    if (fresh.bookingLevel === 'blocked') {
      setDoubleBookingLevel('blocked')
      setDoubleBookingMsg(fresh.bookingMsg)
      setSaving(false)
      return
    }
    if (fresh.bookingLevel === 'warn' && !confirmed) {
      setDoubleBookingLevel('warn')
      setDoubleBookingMsg(fresh.bookingMsg)
      setSaving(false)
      return
    }

    const startObj = new Date(form.start_at)
    const endObj   = new Date(startObj.getTime() + (totalDuration || 30) * 60_000)

    let newApt: { id: string } | null = null
    try {
      newApt = await appointmentsRepo.createAppointment(supabase, {
        business_id:      businessId,
        client_id:        form.client_id,
        service_ids:      form.service_ids,
        assigned_user_id: form.assigned_user_id || null,
        start_at:         startObj.toISOString(),
        end_at:           endObj.toISOString(),
        notes:            form.notes || null,
        status:           'pending',
        is_dual_booking:  doubleBookingLevel === 'warn',
      })
    } catch { /* handled below */ }

    if (newApt) {
      // Reminder WhatsApp
      if (bizNotif.whatsapp) {
        const remindAt = new Date(Date.UTC(
          startObj.getUTCFullYear(), startObj.getUTCMonth(), startObj.getUTCDate()
        )).toISOString()

        if (!skipReminder) {
          // Create pending reminder — cron will send WhatsApp at 8 PM
          await upsertReminder(supabase, newApt.id, businessId, remindAt, 0).catch(() => null)
        } else {
          // Owner opted out — insert cancelled record so cron skips this appointment
          await supabase.from('appointment_reminders').insert({
            appointment_id: newApt.id,
            business_id:    businessId,
            remind_at:      remindAt,
            minutes_before: 0,
            status:         'cancelled',
            channel:        'whatsapp',
          }).then(() => null, () => null)
        }
      }

      // Web Push al dueño: notificación inmediata de nueva cita
      const clientName  = clients.find(c => c.id === form.client_id)?.name ?? 'cliente'
      const serviceName = selectedServices.map(s => s.name).join(', ') || 'servicio'
      const timeStr     = startObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
      notifyOwner({
        title: '📅 Nueva cita agendada',
        body:  `${clientName} · ${serviceName} · ${timeStr}`,
        url:   `/dashboard/appointments/${newApt.id}`,
      }).catch(() => null)
    }

    setSaving(false)
    if (!newApt) {
      setMsg({ type: 'error', text: 'Error al crear la cita. Intenta de nuevo.' })
    } else {
      setMsg({ type: 'success', text: 'Cita creada correctamente' })
      setTimeout(() => { router.push('/dashboard/appointments'); router.refresh() }, 1200)
    }
  }

  // ── Voice Assistant Logic ──────────────────────────────────────────────
  const handleVoiceAssistant = () => {
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

      setAiParsing(true)
      const parsed = await parseVoiceCommand(transcript, { services, clients })
      setAiParsing(false)

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
  }

  if (loadingData) {
    return (
      <div className="flex justify-center items-center py-20" style={{ color: '#909098' }}>
        <Loader2 size={32} className="animate-spin" />
        <span className="ml-3 font-medium">Cargando formulario...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">

      {/* Mobile nav — solid blue buttons */}
      <div className="flex sm:hidden items-center gap-3">
        <Link href="/dashboard/appointments"
          className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold px-3 py-2.5 rounded-xl"
          style={{ background: '#0062FF', color: '#fff', border: '1px solid #0062FF' }}>
          <ArrowLeft size={16} /> Agenda
        </Link>
        <Link href="/dashboard/clients/new"
          className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold px-3 py-2.5 rounded-xl"
          style={{ background: '#0062FF', color: '#fff', border: '1px solid #0062FF' }}>
          <UserPlus size={15} /> Nuevo Cliente
        </Link>
      </div>

      {/* Desktop nav — text links */}
      <div className="hidden sm:flex items-center justify-between gap-3">
        <Link href="/dashboard/appointments"
          className="inline-flex items-center gap-2 text-sm font-semibold hover:opacity-80 transition-opacity"
          style={{ color: '#3884FF' }}>
          <ArrowLeft size={16} /> Agenda
        </Link>
        <Link href="/dashboard/clients/new"
          className="inline-flex items-center gap-2 text-sm font-semibold px-3 py-1.5 rounded-xl hover:opacity-80 transition-opacity"
          style={{ background: 'rgba(0,98,255,0.1)', color: '#3884FF', border: '1px solid rgba(0,98,255,0.2)' }}>
          <UserPlus size={15} /> Nuevo Cliente
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#F2F2F2' }}>Nueva Cita</h1>
          <p className="text-sm" style={{ color: '#909098' }}>Completa los datos para agendar una cita</p>
        </div>
        
        <Button 
          type="button"
          onClick={handleVoiceAssistant}
          disabled={aiParsing}
          variant="secondary"
          className={`h-11 w-11 p-0 rounded-full flex items-center justify-center transition-all ${isListening ? 'animate-pulse bg-red-500/20 border-red-500/50 text-red-500' : ''}`}
          title="Asistente de Voz AI"
        >
          {aiParsing ? (
            <Loader2 className="animate-spin text-brand-500" size={20} />
          ) : isListening ? (
            <MicOff size={20} />
          ) : (
            <Mic size={20} />
          )}
        </Button>
      </div>

      {msg && (
        <div className="flex items-center gap-3 text-sm p-4 rounded-xl"
          style={msg.type === 'success'
            ? { background: 'rgba(48,209,88,0.1)',  border: '1px solid rgba(48,209,88,0.2)',  color: '#30D158' }
            : { background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.2)',  color: '#FF6B6B' }}>
          {msg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          {msg.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <h2 className="text-base font-semibold mb-4" style={{ color: '#F2F2F2' }}>
            Información de la cita
          </h2>
          <div className="space-y-4">

            {/* Cliente */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                Cliente *
              </label>
              <ClientSelect
                clients={clients}
                value={form.client_id}
                onChange={val => setForm(f => ({ ...f, client_id: val }))}
                required
              />
            </div>

            {/* Fecha y hora — dos modos */}
            <div className="space-y-3">
              {preselectedDate ? (
                <>
                  {/* Fecha bloqueada en azul — viene del calendario */}
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                      Fecha
                    </label>
                    <div
                      className="input-base flex items-center gap-2"
                      style={{
                        background:  'rgba(0,98,255,0.08)',
                        border:      '1px solid rgba(0,98,255,0.35)',
                        color:       '#3884FF',
                        cursor:      'default',
                        userSelect:  'none',
                      }}
                    >
                      <CalendarDays size={15} style={{ flexShrink: 0 }} />
                      <span className="font-semibold">
                        {new Date(`${preselectedDate}T00:00`).toLocaleDateString('es-CO', {
                          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                        })}
                      </span>
                    </div>
                  </div>

                  {/* Solo hora editable */}
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                      Hora *
                    </label>
                    <input
                      type="time"
                      required
                      value={form.start_at.split('T')[1] ?? ''}
                      onChange={e => setForm(f => ({
                        ...f,
                        start_at: `${preselectedDate}T${e.target.value}`,
                      }))}
                      className="input-base"
                    />
                  </div>
                </>
              ) : (
                /* Flujo normal — fecha + hora juntos */
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                    Fecha y hora *
                  </label>
                  <DateTimePicker
                    value={form.start_at}
                    min={new Date().toISOString().slice(0, 16)}
                    onChange={v => setForm(f => ({ ...f, start_at: v }))}
                    required
                  />
                </div>
              )}
            </div>

            {/* Slot overlap error */}
            {slotError && (
              <div className="flex items-start gap-3 p-4 rounded-2xl"
                style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.25)' }}>
                <Ban size={18} style={{ color: '#FF3B30', flexShrink: 0, marginTop: 2 }} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: '#FF3B30' }}>Horario no disponible</p>
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,59,48,0.75)' }}>{slotError}</p>
                </div>
              </div>
            )}

            {/* Double booking warn */}
            {!slotError && doubleBookingLevel === 'warn' && (
              <div className="flex flex-col sm:flex-row items-start gap-3 p-4 rounded-2xl"
                style={{ background: 'rgba(255,214,10,0.06)', border: '1px solid rgba(255,214,10,0.25)' }}>
                <AlertTriangle size={18} style={{ color: '#FFD60A', flexShrink: 0, marginTop: 2 }} />
                <div className="flex-1">
                  <p className="text-sm font-semibold flex items-center gap-2" style={{ color: '#FFD60A' }}>
                    Doble agenda detectada <DualBookingBadge />
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,214,10,0.75)' }}>{doubleBookingMsg}</p>
                  <label className="flex items-center gap-2 mt-3 cursor-pointer">
                    <input type="checkbox" checked={confirmed}
                      onChange={e => setConfirmed(e.target.checked)}
                      className="w-4 h-4 rounded" style={{ accentColor: '#FFD60A' }} />
                    <span className="text-xs font-medium" style={{ color: '#FFD60A' }}>
                      Confirmo que deseo agregar una segunda cita el mismo día
                    </span>
                  </label>
                </div>
              </div>
            )}

            {/* Servicios (multi-select) */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                Servicios *
              </label>
              <div className="space-y-2">
                {services.map(s => {
                  const isSelected = form.service_ids.includes(s.id)
                  return (
                    <label
                      key={s.id}
                      className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all"
                      style={{
                        background: isSelected ? 'rgba(0,98,255,0.08)' : '#212125',
                        border: isSelected ? '1px solid rgba(0,98,255,0.35)' : '1px solid #2E2E33',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          setForm(f => ({
                            ...f,
                            service_ids: isSelected
                              ? f.service_ids.filter(id => id !== s.id)
                              : [...f.service_ids, s.id],
                          }))
                        }}
                        className="w-4 h-4 rounded flex-shrink-0"
                        style={{ accentColor: '#0062FF' }}
                      />
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: s.color ?? '#ccc' }}
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium" style={{ color: isSelected ? '#F2F2F2' : '#909098' }}>
                          {s.name}
                        </span>
                      </div>
                      <span className="text-xs flex-shrink-0" style={{ color: '#606068' }}>
                        {s.duration_min} min · ${s.price.toLocaleString('es-CO')}
                      </span>
                    </label>
                  )
                })}
                <button
                  type="button"
                  onClick={() => router.push('/dashboard/services')}
                  className="w-full text-left p-3 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
                  style={{ background: '#212125', border: '1px solid #2E2E33', color: '#3884FF' }}
                >
                  + Añadir nuevo servicio...
                </button>
              </div>
              {selectedServices.length > 0 && (
                <p className="mt-2 text-xs flex items-center gap-1" style={{ color: '#606068' }}>
                  <Info size={12} />
                  Total: {totalDuration} min · ${totalPrice.toLocaleString('es-CO')}
                  {selectedServices.length > 1 && ` · ${selectedServices.length} servicios`}
                </p>
              )}
            </div>

            {/* Empleado */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                Empleado asignado
              </label>
              <select value={form.assigned_user_id}
                onChange={e => setForm(f => ({ ...f, assigned_user_id: e.target.value }))}
                className="input-base bg-card">
                <option value="">Sin asignar</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>

            {/* Notas */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                Notas (opcional)
              </label>
              <textarea rows={3} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Preferencias del cliente, instrucciones especiales..."
                className="input-base resize-none" />
            </div>

            {/* Recordatorio automático */}
            {bizNotif.whatsapp ? (
              <div className="flex items-center justify-between p-3 rounded-xl"
                style={{ background: '#212125', border: '1px solid #2E2E33' }}>
                <div className="flex items-center gap-2">
                  {skipReminder
                    ? <BellOff size={14} style={{ color: '#606068' }} />
                    : <Bell    size={14} style={{ color: '#0062FF' }} />
                  }
                  <span className="text-sm" style={{ color: skipReminder ? '#606068' : '#F2F2F2' }}>
                    {skipReminder
                      ? 'Sin recordatorio para esta cita'
                      : 'WhatsApp · 8 PM día anterior'
                    }
                  </span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <span className="text-xs" style={{ color: '#909098' }}>Omitir</span>
                  <div className="relative">
                    <input type="checkbox" className="sr-only peer"
                      checked={skipReminder} onChange={e => setSkipReminder(e.target.checked)} />
                    <div className="w-8 h-4 rounded-full transition-colors"
                      style={{ background: skipReminder ? '#FF3B30' : '#3A3A3F' }} />
                    <div className="absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
                  </div>
                </label>
              </div>
            ) : null}
          </div>
        </Card>

        <div className="flex items-center justify-end gap-3 pb-10">
          <Link href="/dashboard/appointments">
            <Button variant="secondary" type="button">Cancelar</Button>
          </Link>
          <Button type="submit" loading={saving} disabled={!canSubmit}
            leftIcon={<CalendarDays size={16} />}>
            Agendar Cita
          </Button>
        </div>
      </form>
    </div>
  )
}

// ── Page export — Suspense required for useSearchParams ───────────────────
export default function NewAppointmentPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center items-center py-20" style={{ color: '#909098' }}>
        <Loader2 size={32} className="animate-spin" />
        <span className="ml-3 font-medium">Cargando formulario...</span>
      </div>
    }>
      <NewAppointmentForm />
    </Suspense>
  )
}