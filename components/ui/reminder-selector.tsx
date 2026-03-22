'use client'

import { Bell, BellOff } from 'lucide-react'

export type ReminderMinutes = 0 | 30 | 60 | 120 | 1440

const OPTIONS: { value: ReminderMinutes; label: string }[] = [
  { value: 0,    label: 'Sin recordatorio' },
  { value: 30,   label: '30 minutos antes' },
  { value: 60,   label: '1 hora antes'     },
  { value: 120,  label: '2 horas antes'    },
  { value: 1440, label: '24 horas antes'   },
]

interface Props {
  value:    ReminderMinutes
  onChange: (minutes: ReminderMinutes) => void
}

export function ReminderSelector({ value, onChange }: Props) {
  const hint = value === 0
    ? null
    : value < 60
      ? `Se enviará un WhatsApp ${value} min antes de la cita`
      : `Se enviará un WhatsApp ${value / 60} hora${value >= 120 ? 's' : ''} antes de la cita`

  return (
    <div>
      <label
        className="flex items-center gap-1.5 text-sm font-medium mb-1.5"
        style={{ color: '#F2F2F2' }}
      >
        <Bell size={14} style={{ color: '#909098' }} />
        Recordatorio WhatsApp
      </label>

      <select
        value={value}
        onChange={e => onChange(Number(e.target.value) as ReminderMinutes)}
        className="input-base bg-card"
      >
        {OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <p className="mt-1.5 text-xs flex items-center gap-1" style={{ color: '#606068' }}>
        {value === 0
          ? <><BellOff size={12} /> No se enviará recordatorio al cliente</>
          : <><Bell size={12} /> {hint}</>
        }
      </p>
    </div>
  )
}
