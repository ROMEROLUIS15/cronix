'use client'

import { useState, useEffect } from 'react'
import {
  ArrowLeft, CalendarDays, AlertTriangle, Info,
  Loader2, CheckCircle2, AlertCircle, Save, Ban,
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
import {
  upsertReminder,
  cancelRemindersByAppointment,
  getAppointmentReminder,
} from '@/lib/repositories/reminders.repo'
import {
  evaluateDoubleBooking,
  checkSlotOverlap,
  getLocalDayBoundaries,
} from '@/lib/use-cases/appointments.use-case'
import type { Client, Service, User, DoubleBookingLevel } from '@/types'

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

interface Props { params: { id: string } }

export default function EditAppointmentPage({ params }: Props) {
  const router   = useRouter()
  const { supabase, businessId, loading: contextLoading } = useBusinessContext()

  const [loadingData, setLoadingData] = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [msg,         setMsg]         = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [form, setForm] = useState({
    client_id:        '',
    service_id:       '',
    assigned_user_id: '',
    start_at:         '',
    status:           'pending',
    notes:            '',
  })

  const [clients,  setClients]  = useState<Client[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [users,    setUsers]    = useState<User[]>([])

  const [reminderMinutes,    setReminderMinutes]    = useState<ReminderMinutes>(0)
  const [doubleBookingLevel, setDoubleBookingLevel] = useState<DoubleBookingLevel>('allowed')
  const [doubleBookingMsg,   setDoubleBookingMsg]   = useState('')
  const [slotError,          setSlotError]          = useState<string | null>(null)
  const [confirmed,          setConfirmed]          = useState(false)

  // ── Initial load ───────────────────────────────────────────────────
  useEffect(() => {
    if (!businessId) {
      if (!contextLoading) setLoadingData(false)
      return
    }
    async function init() {
      const [clientsData, servicesData, usersRes, aptRes, existingReminder] = await Promise.all([
        clientsRepo.getClients(supabase, businessId!),
        servicesRepo.getActiveServices(supabase, businessId!),
        supabase.from('users').select('id, name').eq('business_id', businessId!).eq('is_active', true),
        supabase.from('appointments')
          .select('id, client_id, service_id, assigned_user_id, start_at, status, notes')
          .eq('id', params.id)
          .eq('business_id', businessId!)
          .single(),
        getAppointmentReminder(supabase, params.id).catch(() => null),
      ])

      setClients(clientsData as Client[])
      setServices(servicesData as Service[])
      if (usersRes.data) setUsers(usersRes.data as User[])

      if (!aptRes.data || aptRes.error) {
        router.push('/dashboard/appointments')
        return
      }

      const apt = aptRes.data
      setForm({
        client_id:        apt.client_id        ?? '',
        service_id:       apt.service_id       ?? '',
        assigned_user_id: apt.assigned_user_id ?? '',
        start_at:         toDatetimeLocal(apt.start_at),
        status:           apt.status           ?? 'pending',
        notes:            apt.notes            ?? '',
      })
      if (existingReminder) {
        const validMinutes: ReminderMinutes[] = [0, 30, 60, 120, 1440]
        const minutes = existingReminder.minutes_before as ReminderMinutes
        setReminderMinutes(validMinutes.includes(minutes) ? minutes : 0)
      }

      setLoadingData(false)
    }
    init()
  }, [supabase, businessId, contextLoading, params.id, router])

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

      // Use local day boundaries (timezone-safe)
      const { start, end } = getLocalDayBoundaries(form.start_at)

      const { data: dayApts } = await supabase
        .from('appointments')
        .select('id, start_at, end_at, client_id')
        .eq('business_id', businessId)
        .gte('start_at', start)
        .lte('start_at', end)
        .not('status', 'in', '("cancelled","no_show")')

      // 1. Slot overlap check — exclude current appointment
      const overlap = checkSlotOverlap({
        proposedStart: startObj,
        proposedEnd:   endObj,
        existing:      dayApts ?? [],
        excludeId:     params.id,
      })

      if (overlap.overlaps) {
        setSlotError(
          `El horario ${startObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}–${endObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} ya está ocupado (conflicto a las ${overlap.conflictTime}). Selecciona otro horario.`
        )
        setDoubleBookingLevel('blocked')
        setDoubleBookingMsg('')
        return
      }

      // 2. Double booking check for this client — exclude current appointment
      const clientApts = (dayApts ?? []).filter(
        a => a.client_id === form.client_id && a.id !== params.id
      )
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

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!businessId) return
    if (slotError || doubleBookingLevel === 'blocked') return
    if (doubleBookingLevel === 'warn' && !confirmed) return

    setSaving(true)
    const startObj = new Date(form.start_at)
    const endObj   = new Date(startObj.getTime() + (selectedService?.duration_min ?? 30) * 60_000)

    const { error } = await supabase
      .from('appointments')
      .update({
        client_id:        form.client_id,
        service_id:       form.service_id,
        assigned_user_id: form.assigned_user_id || null,
        start_at:         startObj.toISOString(),
        end_at:           endObj.toISOString(),
        status:           form.status as 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show',
        notes:            form.notes || null,
        is_dual_booking:  doubleBookingLevel === 'warn',
        updated_at:       new Date().toISOString(),
      })
      .eq('id', params.id)
      .eq('business_id', businessId)

    if (!error) {
      // Cancel existing pending reminder, then create new one if selected
      await cancelRemindersByAppointment(supabase, params.id).catch(() => null)
      if (reminderMinutes > 0 && businessId) {
        const remindAt = new Date(startObj.getTime() - reminderMinutes * 60_000).toISOString()
        await upsertReminder(supabase, params.id, businessId, remindAt, reminderMinutes).catch(() => null)
      }
    }

    setSaving(false)
    if (error) {
      setMsg({ type: 'error', text: 'Error al actualizar: ' + error.message })
    } else {
      setMsg({ type: 'success', text: 'Cita actualizada correctamente' })
      setTimeout(() => { router.push('/dashboard/appointments'); router.refresh() }, 1200)
    }
  }

  if (loadingData) {
    return (
      <div className="flex justify-center items-center py-20" style={{ color: '#909098' }}>
        <Loader2 size={32} className="animate-spin" />
        <span className="ml-3 font-medium">Cargando cita...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <Link href="/dashboard/appointments"
        className="btn-ghost inline-flex text-sm gap-2" style={{ color: '#909098' }}>
        <ArrowLeft size={16} /> Volver a Agenda
      </Link>

      <div>
        <h1 className="text-2xl font-black" style={{ color: '#F2F2F2', letterSpacing: '-0.025em' }}>
          Editar Cita
        </h1>
        <p className="text-sm" style={{ color: '#909098' }}>Modifica los datos de esta cita</p>
      </div>

      {msg && (
        <div className="p-4 rounded-xl flex items-center gap-3 text-sm"
          style={msg.type === 'success'
            ? { background: 'rgba(48,209,88,0.08)',  border: '1px solid rgba(48,209,88,0.2)',  color: '#30D158' }
            : { background: 'rgba(255,59,48,0.08)',  border: '1px solid rgba(255,59,48,0.2)',  color: '#FF3B30' }}>
          {msg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          {msg.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <div className="flex items-center gap-3 mb-5">
            <div className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(0,98,255,0.1)' }}>
              <CalendarDays size={18} style={{ color: '#0062FF' }} />
            </div>
            <h2 className="text-base font-semibold" style={{ color: '#F2F2F2' }}>
              Información de la cita
            </h2>
          </div>

          <div className="space-y-4">
            {/* Client */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                Cliente <span style={{ color: '#FF3B30' }}>*</span>
              </label>
              <select required value={form.client_id}
                onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}
                className="input-base">
                <option value="">Selecciona un cliente...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {/* Date/time */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                Fecha y hora <span style={{ color: '#FF3B30' }}>*</span>
              </label>
              <input type="datetime-local" required value={form.start_at}
                onChange={e => setForm(f => ({ ...f, start_at: e.target.value }))}
                className="input-base" />
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
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,214,10,0.7)' }}>{doubleBookingMsg}</p>
                  <label className="flex items-center gap-2 mt-3 cursor-pointer">
                    <input type="checkbox" checked={confirmed}
                      onChange={e => setConfirmed(e.target.checked)}
                      className="w-4 h-4 rounded" style={{ accentColor: '#FFD60A' }} />
                    <span className="text-xs font-medium" style={{ color: '#FFD60A' }}>
                      Confirmo que deseo mantener esta segunda cita el mismo día
                    </span>
                  </label>
                </div>
              </div>
            )}

            {/* Service */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                Servicio <span style={{ color: '#FF3B30' }}>*</span>
              </label>
              <select required value={form.service_id}
                onChange={e => setForm(f => ({ ...f, service_id: e.target.value }))}
                className="input-base">
                <option value="">Selecciona un servicio...</option>
                {services.map(s => (
                  <option key={s.id} value={s.id}>{s.name} – {s.duration_min} min</option>
                ))}
              </select>
              {selectedService && (
                <p className="mt-1.5 text-xs flex items-center gap-1" style={{ color: '#606068' }}>
                  <Info size={12} />
                  Duración: {selectedService.duration_min} min · Precio: ${selectedService.price.toLocaleString('es-CO')}
                </p>
              )}
            </div>

            {/* Staff */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                Empleado asignado
              </label>
              <select value={form.assigned_user_id}
                onChange={e => setForm(f => ({ ...f, assigned_user_id: e.target.value }))}
                className="input-base">
                <option value="">Sin asignar</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                Estado
              </label>
              <select value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="input-base">
                <option value="pending">Pendiente</option>
                <option value="confirmed">Confirmada</option>
                <option value="completed">Completada</option>
                <option value="cancelled">Cancelada</option>
                <option value="no_show">No asistió</option>
              </select>
            </div>

            {/* Notes */}
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
          <Button type="submit" loading={saving}
            disabled={!!slotError || doubleBookingLevel === 'blocked' || (doubleBookingLevel === 'warn' && !confirmed)}
            leftIcon={<Save size={16} />}>
            Guardar cambios
          </Button>
        </div>
      </form>
    </div>
  )
}