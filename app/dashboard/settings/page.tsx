'use client'

import { useState, useEffect } from 'react'
import { Store, Clock, Bell, Save, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import type { Business, BusinessSettings } from '@/types'

const CATEGORIES = [
  'Barbería', 'Salón de belleza', 'Clínica', 'Consultorio médico',
  'Spa', 'Entrenador personal', 'Restaurante', 'Consultoría',
  'Estética / Belleza', 'Salud / Medicina', 'Deportes / Gimnasio', 'Otros',
]

const DAYS = [
  { key: 'mon', label: 'Lunes' },
  { key: 'tue', label: 'Martes' },
  { key: 'wed', label: 'Miércoles' },
  { key: 'thu', label: 'Jueves' },
  { key: 'fri', label: 'Viernes' },
  { key: 'sat', label: 'Sábado' },
  { key: 'sun', label: 'Domingo' },
]

interface DayHours {
  open: string
  close: string
  active: boolean
}

const DEFAULT_DAY: DayHours = { open: '09:00', close: '18:00', active: false }

function buildDefaultHours(): Record<string, DayHours> {
  const result: Record<string, DayHours> = {}
  for (const { key } of DAYS) {
    result[key] = { ...DEFAULT_DAY }
  }
  return result
}

function getHour(hours: Record<string, DayHours>, key: string): DayHours {
  return hours[key] ?? { ...DEFAULT_DAY }
}

export default function SettingsPage() {
  const supabase = createClient()
  const [biz, setBiz] = useState<Business | null>(null)
  const [bizId, setBizId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingHours, setSavingHours] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [form, setForm] = useState({ name: '', category: '', phone: '', address: '' })
  const [hours, setHours] = useState<Record<string, DayHours>>(buildDefaultHours)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: dbUser } = await supabase
        .from('users').select('business_id').eq('id', user.id).single()
      if (!dbUser?.business_id) { setLoading(false); return }

      setBizId(dbUser.business_id)

      const { data: business } = await supabase
        .from('businesses').select('*').eq('id', dbUser.business_id).single()

      if (business) {
        setBiz(business)
        setForm({
          name:     business.name,
          category: business.category ?? '',
          phone:    business.phone ?? '',
          address:  business.address ?? '',
        })

        const wh = (business.settings as any)?.workingHours ?? {}
        const loaded = buildDefaultHours()
        for (const { key } of DAYS) {
          const val = wh[key]
          if (Array.isArray(val) && val.length === 2) {
            loaded[key] = {
              open:   String(val[0] ?? '09:00'),
              close:  String(val[1] ?? '18:00'),
              active: true,
            }
          }
        }
        setHours(loaded)
      }
      setLoading(false)
    }
    load()
  }, [])

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 4000)
  }

  const handleSaveBiz = async () => {
    if (!bizId) return
    setSaving(true)
    const { error } = await supabase
      .from('businesses')
      .update({
        name:     form.name.trim(),
        category: form.category,
        phone:    form.phone.trim() || null,
        address:  form.address.trim() || null,
      })
      .eq('id', bizId)
    setSaving(false)
    error
      ? showMsg('error', 'Error al guardar: ' + error.message)
      : showMsg('success', 'Perfil del negocio guardado correctamente')
  }

  const handleSaveHours = async () => {
    if (!bizId || !biz) return
    setSavingHours(true)
    const workingHours: Record<string, [string, string] | null> = {}
    for (const { key } of DAYS) {
      const h = getHour(hours, key)
      workingHours[key] = h.active ? [h.open, h.close] : null
    }
    const currentSettings = (biz.settings as any) ?? {}
    const { error } = await supabase
      .from('businesses')
      .update({ settings: { ...currentSettings, workingHours } })
      .eq('id', bizId)
    setSavingHours(false)
    error
      ? showMsg('error', 'Error al guardar horario: ' + error.message)
      : showMsg('success', 'Horario guardado correctamente')
  }

  const updateHour = (key: string, field: keyof DayHours, value: string | boolean) => {
    setHours((prev: Record<string, DayHours>): Record<string, DayHours> => {
      const current: DayHours = prev[key] ?? { ...DEFAULT_DAY }
      const updated: DayHours = { ...current, [field]: value }
      return { ...prev, [key]: updated }
    })
  }

  const settings = (biz?.settings as unknown as BusinessSettings) ?? {
    notifications: { whatsapp: false, email: false, reminderHours: [] },
    workingHours: {},
    maxDailyBookingsPerClient: 2,
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Ajustes</h1>
        <p className="text-muted-foreground text-sm">Configura tu negocio y preferencias</p>
      </div>

      {msg && (
        <div className={`p-4 rounded-xl flex items-center gap-3 text-sm border ${
          msg.type === 'success'
            ? 'bg-green-50 text-green-700 border-green-100'
            : 'bg-red-50 text-red-600 border-red-100'
        }`}>
          {msg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          {msg.text}
        </div>
      )}

      {/* Business Profile */}
      <Card>
        <div className="flex items-center gap-3 mb-5">
          <div className="h-9 w-9 rounded-xl bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
            <Store size={18} className="text-brand-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Perfil del Negocio</h2>
            <p className="text-xs text-muted-foreground">Información pública de tu negocio</p>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Nombre del negocio</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              className="input-base" placeholder="Nombre de tu negocio" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Categoría o rubro</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                className="input-base bg-card">
                <option value="">Selecciona una categoría</option>
                {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Teléfono</label>
              <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                className="input-base" placeholder="+57 300 000 0000" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Dirección</label>
            <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}
              className="input-base" placeholder="Calle, ciudad..." />
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSaveBiz} loading={saving} leftIcon={<Save size={16} />}>
              Guardar cambios
            </Button>
          </div>
        </div>
      </Card>

      {/* Working Hours */}
      <Card>
        <div className="flex items-center gap-3 mb-5">
          <div className="h-9 w-9 rounded-xl bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
            <Clock size={18} className="text-brand-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Horario de Atención</h2>
            <p className="text-xs text-muted-foreground">Define los horarios de cada día</p>
          </div>
        </div>
        <div className="space-y-3">
          {DAYS.map(({ key, label }) => {
            const h: DayHours = getHour(hours, key)
            return (
              <div key={key} className="flex items-center gap-4">
                <span className="text-sm font-medium text-foreground w-24 flex-shrink-0">{label}</span>
                {h.active ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input type="time" value={h.open}
                      onChange={e => updateHour(key, 'open', e.target.value)}
                      className="input-base max-w-[130px]" />
                    <span className="text-muted-foreground text-sm">–</span>
                    <input type="time" value={h.close}
                      onChange={e => updateHour(key, 'close', e.target.value)}
                      className="input-base max-w-[130px]" />
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground italic flex-1">Cerrado</span>
                )}
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={h.active}
                    onChange={e => updateHour(key, 'active', e.target.checked)}
                    className="rounded accent-brand-600" />
                  Activo
                </label>
              </div>
            )
          })}
          <div className="flex justify-end pt-2">
            <Button onClick={handleSaveHours} loading={savingHours} leftIcon={<Save size={16} />}>
              Guardar horario
            </Button>
          </div>
        </div>
      </Card>

      {/* Notifications */}
      <Card>
        <div className="flex items-center gap-3 mb-5">
          <div className="h-9 w-9 rounded-xl bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
            <Bell size={18} className="text-brand-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Recordatorios</h2>
            <p className="text-xs text-muted-foreground">Canales y ventanas de tiempo</p>
          </div>
        </div>
        <div className="space-y-4">
          {[
            { key: 'whatsapp', label: 'WhatsApp', desc: 'Recordatorios por WhatsApp Business API' },
            { key: 'email',    label: 'Email',    desc: 'Recordatorios por correo electrónico' },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between p-4 rounded-xl bg-surface">
              <div>
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox"
                  defaultChecked={settings.notifications?.[key as 'whatsapp' | 'email']}
                  className="sr-only peer" />
                <div className="w-10 h-5 bg-muted rounded-full peer peer-checked:bg-brand-600 transition-colors" />
                <div className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
              </label>
            </div>
          ))}
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Anticipación del recordatorio</p>
            <div className="flex gap-2 flex-wrap">
              {[1, 2, 6, 12, 24, 48].map(h => (
                <button key={h} className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${
                  (settings.notifications?.reminderHours ?? [24, 2]).includes(h)
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'border-border text-muted-foreground hover:border-brand-300'
                }`}>{h}h</button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card className="border-brand-200 dark:border-brand-800">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Plan actual: {biz?.plan ?? 'free'}</p>
            <p className="text-xs text-muted-foreground">Acceso completo a todas las funcionalidades</p>
          </div>
          <Button variant="secondary">Gestionar plan</Button>
        </div>
      </Card>
    </div>
  )
}