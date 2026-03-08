import type { Metadata } from 'next'
import { Settings, Store, Clock, Bell, Users } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { mockBusiness } from '@/lib/mock/data'
import type { BusinessSettings } from '@/types'

export const metadata: Metadata = { title: 'Ajustes' }

const DAYS = [
  { key: 'mon', label: 'Lunes' },
  { key: 'tue', label: 'Martes' },
  { key: 'wed', label: 'Miércoles' },
  { key: 'thu', label: 'Jueves' },
  { key: 'fri', label: 'Viernes' },
  { key: 'sat', label: 'Sábado' },
  { key: 'sun', label: 'Domingo' },
]

export default function SettingsPage() {
  const biz = mockBusiness
  const settings = (biz.settings as unknown as BusinessSettings) || {
    notifications: { whatsapp: false, email: false, reminderHours: [] },
    workingHours: {},
    maxDailyBookingsPerClient: 0
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Ajustes</h1>
        <p className="text-muted-foreground text-sm">Configura tu negocio y preferencias</p>
      </div>

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
            <input defaultValue={biz.name} className="input-base" id="biz-name" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Categoría</label>
              <input defaultValue={biz.category} className="input-base" id="biz-category" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Teléfono</label>
              <input defaultValue={biz.phone ?? ''} className="input-base" id="biz-phone" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Dirección</label>
            <input defaultValue={biz.address ?? ''} className="input-base" id="biz-address" />
          </div>
          <div className="flex justify-end">
            <Button>Guardar cambios</Button>
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
            const hours = settings.workingHours?.[key] as [string, string] | null
            return (
              <div key={key} className="flex items-center gap-4">
                <span className="text-sm font-medium text-foreground w-24 flex-shrink-0">{label}</span>
                {hours ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="time"
                      defaultValue={hours[0]}
                      className="input-base max-w-[130px]"
                      id={`${key}-open`}
                    />
                    <span className="text-muted-foreground text-sm">—</span>
                    <input
                      type="time"
                      defaultValue={hours[1]}
                      className="input-base max-w-[130px]"
                      id={`${key}-close`}
                    />
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground italic">Cerrado</span>
                )}
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer flex-shrink-0">
                  <input type="checkbox" defaultChecked={!!hours} className="rounded accent-brand-600" />
                  Activo
                </label>
              </div>
            )
          })}
          <div className="flex justify-end pt-2">
            <Button>Guardar horario</Button>
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
          <div className="flex items-center justify-between p-4 rounded-xl bg-surface">
            <div>
              <p className="text-sm font-medium text-foreground">WhatsApp</p>
              <p className="text-xs text-muted-foreground">Recordatorios por WhatsApp Business API</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" defaultChecked className="sr-only peer" />
              <div className="w-10 h-5 bg-muted rounded-full peer peer-checked:bg-brand-600 transition-colors duration-200" />
              <div className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 peer-checked:translate-x-5" />
            </label>
          </div>
          <div className="flex items-center justify-between p-4 rounded-xl bg-surface">
            <div>
              <p className="text-sm font-medium text-foreground">Email</p>
              <p className="text-xs text-muted-foreground">Recordatorios por correo electrónico</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" defaultChecked className="sr-only peer" />
              <div className="w-10 h-5 bg-muted rounded-full peer peer-checked:bg-brand-600 transition-colors duration-200" />
              <div className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 peer-checked:translate-x-5" />
            </label>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Anticipación del recordatorio</p>
            <div className="flex gap-2 flex-wrap">
              {[1, 2, 6, 12, 24, 48].map((h) => (
                <button
                  key={h}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-all duration-150 ${
                    [24, 2].includes(h)
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'border-border text-muted-foreground hover:border-brand-300'
                  }`}
                >
                  {h}h
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <Button>Guardar notificaciones</Button>
          </div>
        </div>
      </Card>

      {/* Plan badge */}
      <Card className="border-brand-200 dark:border-brand-800">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Plan actual: Pro</p>
            <p className="text-xs text-muted-foreground">Acceso completo a todas las funcionalidades</p>
          </div>
          <Button variant="secondary">Gestionar plan</Button>
        </div>
      </Card>
    </div>
  )
}
