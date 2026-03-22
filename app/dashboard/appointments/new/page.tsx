'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  ArrowLeft, CalendarDays, AlertTriangle, Info,
  Loader2, CheckCircle2, AlertCircle, UserPlus, Ban,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DualBookingBadge } from '@/components/ui/badge'
import { ReminderSelector, type ReminderMinutes } from '@/components/ui/reminder-selector'
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import * as clientsRepo from '@/lib/repositories/clients.repo'
import * as servicesRepo from '@/lib/repositories/services.repo'
import { upsertReminder } from '@/lib/repositories/reminders.repo'
import {
  evaluateDoubleBooking,
  checkSlotOverlap,
  getLocalDayBoundaries,
} from '@/lib/use-cases/appointments.use-case'
import type { Client, Service, User, DoubleBookingLevel } from '@/types'

// ── Inner form component ───────────────────────────────────────────────────
function NewAppointmentForm() {
  const router          = useRouter()
  const searchParams    = useSearchParams()
  const { supabase, businessId, loading: contextLoading } = useBusinessContext()
  const preselectedDate = searchParams.get('date') // "yyyy-MM-dd" from calendar click

  const [form,               setForm]               = useState({
    client_id:        '',
    service_id:       '',
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
  const [reminderMinutes,    setReminderMinutes]    = useState<ReminderMinutes>(0)
  const [saving,             setSaving]             = useState(false)
  const [msg,                setMsg]                = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // ── Load form data ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!businessId) {
      if (!contextLoading) setLoadingData(false)
      return
    }
    async function init() {
      const [clientsData, servicesData, usersRes] = await Promise.all([
        clientsRepo.getClients(supabase, businessId!),
        servicesRepo.getActiveServices(supabase, businessId!),
        supabase.from('users').select('id, name').eq('business_id', businessId!).eq('is_active', true),
      ])
      setClients(clientsData as Client[])
      setServices(servicesData as Service[])
      if (usersRes.data) setUsers(usersRes.data as User[])
      setLoadingData(false)
    }
    init()
  }, [supabase, businessId, contextLoading])

  const selectedService = services.find(s => s.id === form.service_id)

  // ── Validation: slot overlap + double booking ──────────────────────────
  useEffect(() => {
    async function validate() {
      setSlotError(null)
      if (!form.client_id || !form.start_at || !form.service_id || !businessId) {
        setDoubleBookingLevel('allowed')
        setDoubleBookingMsg('')
        return
      }

      const svc      = services.find(s => s.id === form.service_id)
      const duration = svc?.duration_min ?? 30
      const startObj = new Date(form.start_at)
      const endObj   = new Date(startObj.getTime() + duration * 60_000)

      const { start, end } = getLocalDayBoundaries(form.start_at)

      const { data: dayApts } = await supabase
        .from('appointments')
        .select('id, start_at, end_at, client_id')
        .eq('business_id', businessId)
        .gte('start_at', start)
        .lte('start_at', end)
        .not('status', 'in', '("cancelled","no_show")')

      // 1. Slot overlap — blocks any client in the same time window
      const overlap = checkSlotOverlap({
        proposedStart: startObj,
        proposedEnd:   endObj,
        existing:      dayApts ?? [],
      })

      if (overlap.overlaps) {
        setSlotError(
          `El horario ${startObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}–${endObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} ya está ocupado (conflicto a las ${overlap.conflictTime}). Selecciona otro horario.`
        )
        setDoubleBookingLevel('blocked')
        setDoubleBookingMsg('')
        return
      }

      // 2. Double booking — warns if same client already has a cita that day
      const clientApts    = (dayApts ?? []).filter(a => a.client_id === form.client_id)
      const existingSlots = clientApts.map(a => ({
        time:    new Date(a.start_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
        service: '',
      }))

      const result = evaluateDoubleBooking({
        existingCount: clientApts.length,
        existingSlots,
      })
      setDoubleBookingLevel(result.level)
      setDoubleBookingMsg(result.message)
      setConfirmed(false)
    }

    const t = setTimeout(validate, 500)
    return () => clearTimeout(t)
  }, [form.client_id, form.start_at, form.service_id, businessId, services])

  const canSubmit =
    !slotError &&
    doubleBookingLevel !== 'blocked' &&
    !(doubleBookingLevel === 'warn' && !confirmed)

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!businessId || !canSubmit) return
    setSaving(true)

    const startObj = new Date(form.start_at)
    const endObj   = new Date(startObj.getTime() + (selectedService?.duration_min ?? 30) * 60_000)

    const { data: newApt, error } = await supabase
      .from('appointments')
      .insert({
        business_id:      businessId,
        client_id:        form.client_id,
        service_id:       form.service_id,
        assigned_user_id: form.assigned_user_id || null,
        start_at:         startObj.toISOString(),
        end_at:           endObj.toISOString(),
        notes:            form.notes || null,
        status:           'pending',
        is_dual_booking:  doubleBookingLevel === 'warn',
      })
      .select('id')
      .single()

    if (!error && newApt && reminderMinutes > 0) {
      const remindAt = new Date(startObj.getTime() - reminderMinutes * 60_000).toISOString()
      await upsertReminder(supabase, newApt.id, businessId, remindAt, reminderMinutes).catch(() => null)
    }

    setSaving(false)
    if (error) {
      setMsg({ type: 'error', text: 'Error al crear la cita: ' + error.message })
    } else {
      setMsg({ type: 'success', text: 'Cita creada correctamente' })
      setTimeout(() => { router.push('/dashboard/appointments'); router.refresh() }, 1200)
    }
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

      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#F2F2F2' }}>Nueva Cita</h1>
        <p className="text-sm" style={{ color: '#909098' }}>Completa los datos para agendar una cita</p>
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
              <select required value={form.client_id}
                onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}
                className="input-base bg-card">
                <option value="">Selecciona un cliente...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
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
                  <input
                    type="datetime-local"
                    required
                    value={form.start_at}
                    min={new Date().toISOString().slice(0, 16)}
                    onChange={e => setForm(f => ({ ...f, start_at: e.target.value }))}
                    className="input-base"
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

            {/* Servicio */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                Servicio *
              </label>
              <select required value={form.service_id}
                onChange={e => {
                  if (e.target.value === 'new-service') { router.push('/dashboard/services'); return }
                  setForm(f => ({ ...f, service_id: e.target.value }))
                }}
                className="input-base bg-card">
                <option value="">Selecciona un servicio...</option>
                {services.map(s => (
                  <option key={s.id} value={s.id}>{s.name} – {s.duration_min} min</option>
                ))}
                <option value="disabled-separator" disabled>─────────────────</option>
                <option value="new-service">✨ Añadir nuevo servicio...</option>
              </select>
              {selectedService && (
                <p className="mt-1.5 text-xs flex items-center gap-1" style={{ color: '#606068' }}>
                  <Info size={12} />
                  Duración: {selectedService.duration_min} min · Precio: ${selectedService.price.toLocaleString('es-CO')}
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

            {/* Recordatorio */}
            <ReminderSelector
              value={reminderMinutes}
              onChange={setReminderMinutes}
            />
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