'use client'

import { useState, useEffect } from 'react'
import {
  ArrowLeft, CalendarDays, AlertTriangle, Info,
  Loader2, CheckCircle2, AlertCircle, Save, Ban, Bell, BellOff,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DualBookingBadge } from '@/components/ui/badge'
import { ClientSelect } from '@/components/ui/client-select'
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import * as clientsRepo from '@/lib/repositories/clients.repo'
import * as servicesRepo from '@/lib/repositories/services.repo'
import * as appointmentsRepo from '@/lib/repositories/appointments.repo'
import * as usersRepo from '@/lib/repositories/users.repo'
import * as businessesRepo from '@/lib/repositories/businesses.repo'
import * as notificationsRepo from '@/lib/repositories/notifications.repo'
import {
  upsertReminder,
  cancelRemindersByAppointment,
} from '@/lib/repositories/reminders.repo'
import {
  evaluateDoubleBooking,
  checkEmployeeConflict,
  checkClientConflict,
  getLocalDayBoundaries,
} from '@/lib/use-cases/appointments.use-case'
import type { Client, Service, User, DoubleBookingLevel } from '@/types'
import { useTranslations } from 'next-intl'

function fmtReminder(mins: number) {
  if (mins >= 1440) return `${mins / 1440} día${mins >= 2880 ? 's' : ''}`
  if (mins >= 60)   return `${mins / 60} hora${mins >= 120 ? 's' : ''}`
  return `${mins} min`
}

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
  const t        = useTranslations('appointments.form')
  const statusT  = useTranslations('dashboard.status')
  const { supabase, businessId, loading: contextLoading } = useBusinessContext()

  const [loadingData, setLoadingData] = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [msg,         setMsg]         = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [form, setForm] = useState({
    client_id:        '',
    service_ids:      [] as string[],
    assigned_user_id: '',
    start_at:         '',
    status:           'pending',
    notes:            '',
  })

  const [clients,  setClients]  = useState<Client[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [users,    setUsers]    = useState<User[]>([])

  const [bizNotif,           setBizNotif]           = useState<{ whatsapp: boolean; reminderMinutes: number }>({ whatsapp: false, reminderMinutes: 1440 })
  const [skipReminder,       setSkipReminder]       = useState(false)
  const [doubleBookingLevel, setDoubleBookingLevel] = useState<DoubleBookingLevel>('allowed')
  const [doubleBookingMsg,   setDoubleBookingMsg]   = useState('')
  const [slotError,          setSlotError]          = useState<string | null>(null)
  const [confirmed,          setConfirmed]          = useState(false)
  const [validating,         setValidating]         = useState(false)

  // ── Initial load ───────────────────────────────────────────────────
  useEffect(() => {
    if (!businessId) {
      if (!contextLoading) setLoadingData(false)
      return
    }
    async function init() {
      const [clientsData, servicesData, membersData, aptData, bizSettings, existingReminder] = await Promise.all([
        clientsRepo.getClients(supabase, businessId!),
        servicesRepo.getActiveServices(supabase, businessId!),
        usersRepo.getBusinessMembers(supabase, businessId!),
        appointmentsRepo.getAppointmentForEdit(supabase, params.id, businessId!),
        businessesRepo.getBusinessSettings(supabase, businessId!),
        supabase
          .from('appointment_reminders')
          .select('id')
          .eq('appointment_id', params.id)
          .in('status', ['pending', 'sent'])
          .maybeSingle(),
      ])

      setClients(clientsData as Client[])
      setServices(servicesData as Service[])
      setUsers(membersData as User[])

      if (!aptData) {
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
      const notif = (bizSettings.settings as { notifications?: { whatsapp?: boolean; reminderHours?: number[] } } | null)?.notifications
      const hours  = notif?.reminderHours?.[0] ?? 24
      setBizNotif({ whatsapp: notif?.whatsapp ?? false, reminderMinutes: hours * 60 })
      // Si no hay reminder activo en la BD, el toggle "Omitir" debe estar ON
      setSkipReminder(!existingReminder.data)

      setLoadingData(false)
    }
    init()
  }, [supabase, businessId, contextLoading, params.id, router])

  const selectedServices = services.filter(s => form.service_ids.includes(s.id))
  const totalDuration    = selectedServices.reduce((sum, s) => sum + s.duration_min, 0)
  const totalPrice       = selectedServices.reduce((sum, s) => sum + s.price, 0)

  // ── Core validation logic (reused by effect debounce AND handleSubmit) ──
  async function runValidation(excludeId: string) {
    if (!form.client_id || !form.start_at || !form.service_ids.length || !businessId) {
      return { slotBlocked: false, bookingLevel: 'allowed' as DoubleBookingLevel, bookingMsg: '' }
    }

    const selectedSvcs = services.filter(s => form.service_ids.includes(s.id))
    const duration     = selectedSvcs.reduce((sum, s) => sum + s.duration_min, 0) || 30
    const startObj = new Date(form.start_at)
    const endObj   = new Date(startObj.getTime() + duration * 60_000)
    const { start, end } = getLocalDayBoundaries(form.start_at)

    const { data: dayApts } = await supabase
      .from('appointments')
      .select('id, start_at, end_at, client_id, assigned_user_id')
      .eq('business_id', businessId)
      .gte('start_at', start)
      .lte('start_at', end)
      .not('status', 'in', '("cancelled","no_show")')

    // 1) Employee conflict — each employee can only handle one client at a time.
    if (form.assigned_user_id) {
      const empConflict = checkEmployeeConflict({
        proposedStart: startObj,
        proposedEnd:   endObj,
        existing:      dayApts ?? [],
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

    // 1.5) Unassigned slot conflict — appointments without employee block the timeslot
    //      for all employees (e.g. AI-created bookings that haven't been assigned yet).
    const unassignedOverlap = (dayApts ?? []).find(a => {
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

    // 2) Client conflict — same client can't be in two places at once.
    const cliConflict = checkClientConflict({
      proposedStart: startObj,
      proposedEnd:   endObj,
      existing:      dayApts ?? [],
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

    // 3) Double booking count — warn/block by number of appointments that day.
    const clientApts = (dayApts ?? []).filter(
      a => a.client_id === form.client_id && a.id !== excludeId
    )
    const existingSlots = clientApts.map(a => ({
      time:    new Date(a.start_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
      service: '',
    }))
    const result = evaluateDoubleBooking({ existingCount: clientApts.length, existingSlots })

    return { slotBlocked: false, bookingLevel: result.level, bookingMsg: result.message }
  }

  // ── Validation: slot overlap + double booking ──────────────────────────
  useEffect(() => {
    setValidating(true)
    setSlotError(null)

    if (!form.client_id || !form.start_at || !form.service_ids.length || !businessId) {
      setDoubleBookingLevel('allowed')
      setDoubleBookingMsg('')
      setValidating(false)
      return
    }

    const t = setTimeout(async () => {
      const result = await runValidation(params.id)
      setSlotError(result.slotBlocked ? (result.slotMsg ?? null) : null)
      setDoubleBookingLevel(result.bookingLevel)
      setDoubleBookingMsg(result.bookingMsg)
      if (!result.slotBlocked) setConfirmed(false)
      setValidating(false)
    }, 400)

    return () => { clearTimeout(t); setValidating(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.client_id, form.start_at, JSON.stringify(form.service_ids), form.assigned_user_id, businessId, services])

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!businessId) return
    setSaving(true)

    // Re-validate right before saving — guards against race conditions
    const fresh = await runValidation(params.id)
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

    // Update appointment (service_id = first for backward compat)
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
        is_dual_booking:  doubleBookingLevel === 'warn',
        updated_at:       new Date().toISOString(),
      })
      .eq('id', params.id)
      .eq('business_id', businessId)

    // Sync junction table: delete old rows + insert new ones
    if (!error) {
      await supabase
        .from('appointment_services')
        .delete()
        .eq('appointment_id', params.id)

      if (form.service_ids.length > 0) {
        await supabase
          .from('appointment_services')
          .insert(form.service_ids.map((sid, i) => ({
            appointment_id: params.id,
            service_id:     sid,
            sort_order:     i,
          })))
      }
    }

    if (!error) {
      await cancelRemindersByAppointment(supabase, params.id).catch(() => null)
      if (bizNotif.whatsapp && businessId) {
        const remindAt = new Date(Date.UTC(
          startObj.getUTCFullYear(), startObj.getUTCMonth(), startObj.getUTCDate()
        )).toISOString()

        if (!skipReminder) {
          await upsertReminder(supabase, params.id, businessId, remindAt, 0).catch(() => null)
        } else {
          // Owner opted out — insert cancelled record so cron skips this appointment
          await supabase.from('appointment_reminders').insert({
            appointment_id: params.id,
            business_id:    businessId,
            remind_at:      remindAt,
            minutes_before: 0,
            status:         'cancelled',
            channel:        'whatsapp',
          }).then(() => null, () => null)
        }
      }

      // In-app notification for appointment update
      if (businessId) {
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
            appointmentId: params.id,
          },
        }
        // Fire-and-forget: notification failures don't block the flow
        notificationsRepo.createNotification(supabase, notifPayload)
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
        <span className="ml-3 font-medium">{t('loadingApt')}</span>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <Link href="/dashboard/appointments"
        className="btn-ghost inline-flex text-sm gap-2" style={{ color: '#909098' }}>
        <ArrowLeft size={16} /> {t('backToAgenda')}
      </Link>

      <div>
        <h1 className="text-2xl font-black" style={{ color: '#F2F2F2', letterSpacing: '-0.025em' }}>
          {t('editAptTitle')}
        </h1>
        <p className="text-sm" style={{ color: '#909098' }}>{t('editAptSubtitle')}</p>
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
              {t('infoTitle')}
            </h2>
          </div>

          <div className="space-y-4">
            {/* Client */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                {t('client')} <span style={{ color: '#FF3B30' }}>*</span>
              </label>
              <ClientSelect
                clients={clients}
                value={form.client_id}
                onChange={val => setForm(f => ({ ...f, client_id: val }))}
                required
              />
            </div>

            {/* Date/time */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                {t('dateTime')} <span style={{ color: '#FF3B30' }}>*</span>
              </label>
              <DateTimePicker
                value={form.start_at}
                onChange={v => setForm(f => ({ ...f, start_at: v }))}
                required
              />
            </div>

            {/* Slot overlap error */}
            {slotError && (
              <div className="flex items-start gap-3 p-4 rounded-2xl"
                style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.25)' }}>
                <Ban size={18} style={{ color: '#FF3B30', flexShrink: 0, marginTop: 2 }} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: '#FF3B30' }}>{t('slotErrors.title')}</p>
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
                    {t('slotErrors.doubleTitle')} <DualBookingBadge />
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,214,10,0.7)' }}>{doubleBookingMsg}</p>
                  <label className="flex items-center gap-2 mt-3 cursor-pointer">
                    <input type="checkbox" checked={confirmed}
                      onChange={e => setConfirmed(e.target.checked)}
                      className="w-4 h-4 rounded" style={{ accentColor: '#FFD60A' }} />
                    <span className="text-xs font-medium" style={{ color: '#FFD60A' }}>
                      {t('slotErrors.confirmDoubleKeep')}
                    </span>
                  </label>
                </div>
              </div>
            )}

            {/* Servicios (multi-select) */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                {t('services')} <span style={{ color: '#FF3B30' }}>*</span>
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
              </div>
              {selectedServices.length > 0 && (
                <p className="mt-2 text-xs flex items-center gap-1" style={{ color: '#606068' }}>
                  <Info size={12} />
                  {t('total')}: {totalDuration} min · ${totalPrice.toLocaleString('es-CO')}
                  {selectedServices.length > 1 && ` · ${selectedServices.length} ${t('servicesCount')}`}
                </p>
              )}
            </div>

            {/* Staff */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                {t('staff')}
              </label>
              <select value={form.assigned_user_id}
                onChange={e => setForm(f => ({ ...f, assigned_user_id: e.target.value }))}
                className="input-base">
                <option value="">{t('unassigned', { fallback: 'Sin asignar' })}</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                {t('status')}
              </label>
              <select value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="input-base">
                <option value="pending">{statusT('pending')}</option>
                <option value="confirmed">{statusT('confirmed')}</option>
                <option value="completed">{statusT('completed')}</option>
                <option value="cancelled">{statusT('cancelled')}</option>
                <option value="no_show">{statusT('noShow')}</option>
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                {t('notes')}
              </label>
              <textarea rows={3} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder={t('notesPlaceholder')}
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
                      ? t('reminderNone')
                      : t('reminderWhatsapp')
                    }
                  </span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <span className="text-xs" style={{ color: '#909098' }}>{t('skip')}</span>
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
            <Button variant="secondary" type="button">{t('cancel')}</Button>
          </Link>
          <Button type="submit" loading={saving}
            disabled={validating || !!slotError || doubleBookingLevel === 'blocked' || (doubleBookingLevel === 'warn' && !confirmed)}
            leftIcon={<Save size={16} />}>
            {t('save')}
          </Button>
        </div>
      </form>
    </div>
  )
}