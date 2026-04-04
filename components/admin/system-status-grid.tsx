'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Zap, Activity, Clock, AlertCircle, CheckCircle2, CloudLightning } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'

interface ServiceHealth {
  service_name: string
  status: 'CLOSED' | 'OPEN' | 'HALF-OPEN'
  failure_count: number
  last_failure: string | null
}

export function SystemStatusGrid() {
  const [services, setServices] = useState<ServiceHealth[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchHealth = async () => {
    const { data, error } = await supabase
      .from('service_health')
      .select('*')
      .order('service_name', { ascending: true })

    if (!error && data) {
      setServices(data as ServiceHealth[])
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchHealth()

    const channel = supabase
      .channel('service-health-admin')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'service_health' },
        () => fetchHealth()
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [supabase, fetchHealth])

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-2xl bg-white/5 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {services.map((service) => {
        const isDown = service.status === 'OPEN'
        const isDegraded = service.status === 'HALF-OPEN'
        
        return (
          <div 
            key={service.service_name}
            className="p-6 rounded-[2rem] border border-[#2E2E33] transition-all hover:scale-[1.02] duration-200"
            style={{ 
              background: isDown ? 'rgba(255, 59, 48, 0.03)' : 'rgba(15, 15, 18, 0.6)',
              borderColor: isDown ? 'rgba(255, 59, 48, 0.2)' : '#2E2E33'
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-black uppercase text-[#909098] tracking-widest">
                {service.service_name}
              </span>
              <div className="flex items-center gap-2">
                {isDown ? (
                  <CloudLightning className="text-[#FF3B30] animate-pulse" size={16} />
                ) : isDegraded ? (
                  <Activity className="text-[#FFD60A]" size={16} />
                ) : (
                  <CheckCircle2 className="text-[#30D158]" size={16} />
                )}
                <span 
                  className="text-[10px] font-black uppercase px-2 py-1 rounded-lg"
                  style={{ 
                    backgroundColor: isDown ? '#FF3B30' : isDegraded ? '#FFD60A' : '#30D158',
                    color: isDown ? '#FFF' : '#000'
                  }}
                >
                  {service.status === 'CLOSED' ? 'Healthy' : service.status}
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <span className="text-2xl font-black text-[#F2F2F2]">
                    {service.failure_count}
                  </span>
                  <span className="text-[10px] font-bold uppercase text-[#505058]">
                    Fallos recientes
                  </span>
                </div>
                
                <div className="h-8 w-px bg-[#2E2E33]" />
                
                <div className="flex flex-col flex-1">
                  <div className="flex items-center gap-1.5 text-[#909098]">
                    <Clock size={12} />
                    <span className="text-xs font-medium">
                      {service.last_failure 
                        ? `Hace ${formatDistanceToNow(new Date(service.last_failure), { locale: es })}`
                        : 'Sin fallos registrados'}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold uppercase text-[#505058]">
                    Último incidente
                  </span>
                </div>
              </div>

              {isDown && (
                <div className="flex items-center gap-2 p-2 rounded-xl bg-[#FF3B30]/10 border border-[#FF3B30]/20">
                  <AlertCircle size={14} className="text-[#FF3B30]" />
                  <span className="text-[10px] font-bold text-[#FF3B30]">
                    CIRCUIT BREAKER ABIERTO: Tráfico detenido.
                  </span>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
