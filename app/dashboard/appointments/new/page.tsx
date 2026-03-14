'use client'

import { useState, useEffect } from 'react'
import { ArrowLeft, CalendarDays, AlertTriangle, Info, Loader2, CheckCircle2, AlertCircle, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DualBookingBadge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'
import { evaluateDoubleBooking } from '@/lib/appointments/validate-double-booking'
import type { Client, Service, User } from '@/types'

type DoubleBookingLevel = 'allowed' | 'warn' | 'blocked'

/**
 * Returns the local day boundaries as ISO strings for Supabase range queries.
 * Fixes timezone bug: datetime-local input values are in local time,
 * so we must query using local midnight boundaries, not UTC midnight.
 *
 * Example (UTC-4, Venezuela):
 *   input "2026-03-13T21:00" → dateStr "2026-03-13"
 *   localDayStart → "2026-03-13T04:00:00.000Z" (local midnight in UTC)
 *   localDayEnd   → "2026-03-14T03:59:59.999Z" (local 23:59 in UTC)
 */
function getLocalDayBoundaries(localDatetimeStr: string): { start: string; end: string } {
  const dateStr   = localDatetimeStr.split('T')[0]             // "2026-03-13"
  const dayStart  = new Date(`${dateStr}T00:00:00`)             // local midnight
  const dayEnd    = new Date(`${dateStr}T23:59:59.999`)         // local end of day
  return {
    start: dayStart.toISOString(),
    end:   dayEnd.toISOString(),
  }
}

export default function NewAppointmentPage() {
  const router   = useRouter()
  const supabase = createClient()

  const [businessId,         setBusinessId]         = useState<string | null>(null)
  const [form,               setForm]               = useState({
    client_id: '', service_id: '', assigned_user_id: '', start_at: '', notes: '',
  })
  const [clients,            setClients]            = useState<Client[]>([])
  const [services,           setServices]           = useState<Service[]>([])
  const [users,              setUsers]              = useState<User[]>([])
  const [loadingData,        setLoadingData]        = useState(true)
  const [doubleBookingLevel, setDoubleBookingLevel] = useState<DoubleBookingLevel>('allowed')
  const [doubleBookingMsg,   setDoubleBookingMsg]   = useState('')
  const [confirmed,          setConfirmed]          = useState(false)
  const [saving,             setSaving]             = useState(false)
  const [msg,                setMsg]                = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: dbUser } = await supabase
        .from('users').select('business_id').eq('id', user.id).single()
      if (!dbUser?.business_id) { setLoadingData(false); return }
      const bId = dbUser.business_id
      setBusinessId(bId)
      const [clientsRes, servicesRes, usersRes] = await Promise.all([
        supabase.from('clients').select('id, name, phone, email').eq('business_id', bId).is('deleted_at', null),
        supabase.from('services').select('id, name, duration_min, price').eq('business_id', bId).eq('is_active', true),
        supabase.from('users').select('id, name').eq('business_id', bId).eq('is_active', true),
      ])
      if (clientsRes.data)  setClients(clientsRes.data as Client[])
      if (servicesRes.data) setServices(servicesRes.data as Service[])
      if (usersRes.data)    setUsers(usersRes.data as User[])
      setLoadingData(false)
    }
    init()
  }, [])

  const selectedService = services.find(s => s.id === form.service_id)

  // Double-booking check — uses local day boundaries to avoid timezone crossing
  useEffect(() => {
    async function checkDoubleBooking() {
      if (!form.client_id || !form.start_at) {
        setDoubleBookingLevel('allowed'); setDoubleBookingMsg(''); return
      }
      const { start, end } = getLocalDayBoundaries(form.start_at)
      const { data } = await supabase
        .from('appointments')
        .select('start_at, service:services(name)')
        .eq('client_id', form.client_id)
        .gte('start_at', start)
        .lte('start_at', end)
        .not('status', 'in', '("cancelled")')
      const existingCount = data?.length || 0
      const existingSlots = (data || []).map((a: any) => ({
        time:    new Date(a.start_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
        service: a.service?.name || 'Cita',
      }))
      const result = evaluateDoubleBooking({ existingCount, existingSlots })
      setDoubleBookingLevel(result.level)
      setDoubleBookingMsg(result.message)
      setConfirmed(false)
    }
    const t = setTimeout(checkDoubleBooking, 500)
    return () => clearTimeout(t)
  }, [form.client_id, form.start_at])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!businessId || doubleBookingLevel === 'blocked') return
    if (doubleBookingLevel === 'warn' && !confirmed) return
    setSaving(true)
    const startObj = new Date(form.start_at)
    const endObj   = new Date(startObj.getTime() + (selectedService?.duration_min || 30) * 60000)
    const { error } = await supabase.from('appointments').insert({
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
      <div className="flex justify-center items-center py-20 text-muted-foreground">
        <Loader2 size={32} className="animate-spin" />
        <span className="ml-3 font-medium">Cargando formulario...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">

      {/* ── Navigation row — back to Agenda + shortcut to Nuevo Cliente ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link
          href="/dashboard/appointments"
          className="inline-flex items-center gap-2 text-sm font-semibold transition-all hover:opacity-80"
          style={{ color: '#3884FF' }}
        >
          <ArrowLeft size={16} /> Agenda
        </Link>
        <Link
          href="/dashboard/clients/new"
          className="inline-flex items-center gap-2 text-sm font-semibold px-3 py-1.5 rounded-xl transition-all hover:opacity-80"
          style={{
            background: 'rgba(0,98,255,0.1)',
            color:      '#3884FF',
            border:     '1px solid rgba(0,98,255,0.2)',
          }}
        >
          <UserPlus size={15} /> Nuevo Cliente
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Nueva Cita</h1>
        <p className="text-muted-foreground text-sm">Completa los datos para agendar una cita</p>
      </div>

      {msg && (
        <div
          className="flex items-center gap-3 text-sm p-4 rounded-xl"
          style={msg.type === 'success'
            ? { background: 'rgba(48,209,88,0.1)',  border: '1px solid rgba(48,209,88,0.2)',  color: '#30D158' }
            : { background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.2)',  color: '#FF6B6B' }
          }
        >
          {msg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          {msg.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <h2 className="text-base font-semibold text-foreground mb-4">Información de la cita</h2>
          <div className="space-y-4">

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Cliente *</label>
              <select required value={form.client_id}
                onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}
                className="input-base bg-card">
                <option value="">Selecciona un cliente...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Fecha y hora *</label>
              <input type="datetime-local" required value={form.start_at}
                onChange={e => setForm(f => ({ ...f, start_at: e.target.value }))}
                className="input-base" />
            </div>

            {doubleBookingLevel === 'warn' && (
              <div className="flex flex-col sm:flex-row items-start gap-3 p-4 rounded-2xl"
                style={{ background: 'rgba(255,214,10,0.08)', border: '1px solid rgba(255,214,10,0.25)' }}>
                <AlertTriangle size={18} style={{ color: '#FFD60A', flexShrink: 0, marginTop: '2px' }} />
                <div className="flex-1">
                  <p className="text-sm font-semibold flex items-center gap-2" style={{ color: '#FFD60A' }}>
                    Doble agenda detectada <DualBookingBadge />
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,214,10,0.75)' }}>{doubleBookingMsg}</p>
                  <label className="flex items-center gap-2 mt-3 cursor-pointer">
                    <input type="checkbox" checked={confirmed}
                      onChange={e => setConfirmed(e.target.checked)}
                      className="accent-brand-600 w-4 h-4 rounded" />
                    <span className="text-xs font-medium" style={{ color: '#FFD60A' }}>
                      Confirmo que deseo agregar una segunda cita el mismo día
                    </span>
                  </label>
                </div>
              </div>
            )}

            {doubleBookingLevel === 'blocked' && (
              <div className="flex items-start gap-3 p-4 rounded-2xl"
                style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.2)' }}>
                <AlertTriangle size={18} style={{ color: '#FF3B30', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: '#FF3B30' }}>Límite de doble agenda alcanzado</p>
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,59,48,0.75)' }}>
                    Este cliente ya tiene 2 citas programadas para ese día.
                  </p>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Servicio *</label>
              <select required value={form.service_id}
                onChange={e => setForm(f => ({ ...f, service_id: e.target.value }))}
                className="input-base bg-card">
                <option value="">Selecciona un servicio...</option>
                {services.map(s => (
                  <option key={s.id} value={s.id}>{s.name} – {s.duration_min} min</option>
                ))}
              </select>
              {selectedService && (
                <p className="mt-1.5 text-xs text-muted-foreground flex items-center gap-1">
                  <Info size={12} />
                  Duración: {selectedService.duration_min} min · Precio: ${selectedService.price.toLocaleString('es-CO')}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Empleado asignado</label>
              <select value={form.assigned_user_id}
                onChange={e => setForm(f => ({ ...f, assigned_user_id: e.target.value }))}
                className="input-base bg-card">
                <option value="">Sin asignar</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Notas (opcional)</label>
              <textarea rows={3} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Preferencias del cliente, instrucciones especiales..."
                className="input-base resize-none" />
            </div>
          </div>
        </Card>

        <div className="flex items-center justify-end gap-3 pb-10">
          <Link href="/dashboard/appointments">
            <Button variant="secondary" type="button">Cancelar</Button>
          </Link>
          <Button type="submit" loading={saving}
            disabled={doubleBookingLevel === 'blocked' || (doubleBookingLevel === 'warn' && !confirmed)}
            leftIcon={<CalendarDays size={16} />}>
            Agendar Cita
          </Button>
        </div>
      </form>
    </div>
  )
}