'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { 
  Database, 
  Clock, 
  Phone, 
  AlertCircle, 
  ChevronRight, 
  Bug, 
  ExternalLink,
  ChevronDown
} from 'lucide-react'
import { Card } from '@/components/ui/card'

interface DLQEntry {
  id: string
  payload: any
  error: string | null
  service_type: string
  retry_count: number
  created_at: string
}

export function DeadLetterFeed() {
  const [entries, setEntries] = useState<DLQEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const supabase = createClient()

  const fetchDLQ = useCallback(async () => {
    const { data, error } = await supabase
      .from('wa_dead_letter_queue')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)

    if (!error && data) {
      setEntries(data as DLQEntry[])
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    fetchDLQ()

    const channel = supabase
      .channel('dlq-admin-feed')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wa_dead_letter_queue' },
        () => fetchDLQ()
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [supabase, fetchDLQ])

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-2xl bg-white/5 animate-pulse" />
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="py-16 flex flex-col items-center justify-center text-center px-6 rounded-[2rem] border border-dashed border-[#2E2E33] bg-[#0F0F12]/50">
        <div className="h-14 w-14 rounded-full bg-[#1A1A1F] flex items-center justify-center mb-4">
          <Bug size={24} className="text-[#30D158] opacity-20" />
        </div>
        <p className="text-sm font-bold text-[#F2F2F2]">Sin fallos en cola</p>
        <p className="text-xs text-[#909098] mt-1 italic max-w-xs text-pretty">
          Excelente. No hay mensajes en el Dead Letter Queue. 
          El motor de Luis IA está procesando todo correctamente.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => {
        const isExpanded = expandedId === entry.id
        const phone = entry.payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from || 'Desconocido'
        const messageText = entry.payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body || 'Sin texto'
        
        return (
          <div 
            key={entry.id}
            className="group overflow-hidden rounded-[1.5rem] border border-[#2E2E33] bg-[#1A1A1F]/50 transition-all duration-300"
            style={{ 
              borderColor: isExpanded ? 'rgba(255, 59, 48, 0.3)' : '#2E2E33',
              backgroundColor: isExpanded ? 'rgba(255, 59, 48, 0.02)' : 'rgba(26, 26, 31, 0.5)'
            }}
          >
            {/* Header / Summary */}
            <div 
              className="px-6 py-4 flex items-center justify-between cursor-pointer"
              onClick={() => setExpandedId(isExpanded ? null : entry.id)}
            >
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="flex-shrink-0 p-2 rounded-xl bg-[#FF3B30]/10 border border-[#FF3B30]/20">
                  <AlertCircle size={18} className="text-[#FF3B30]" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-xs font-black text-[#FF3B30] uppercase tracking-widest truncate">
                      {entry.error?.substring(0, 40) || 'Unknown Error'}
                    </span>
                    <span className="h-1 w-1 rounded-full bg-[#2E2E33]" />
                    <span className="text-[10px] font-bold text-[#909098] flex items-center gap-1 flex-shrink-0">
                      <Clock size={10} />
                      {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true, locale: es })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone size={12} className="text-[#505058]" />
                    <span className="text-xs font-bold text-[#F2F2F2]">+{phone}</span>
                    <span className="text-[#505058] sm:inline hidden text-[10px]">|</span>
                    <span className="text-[10px] text-[#909098] truncate italic sm:inline hidden">
                      &quot;{messageText.substring(0, 50)}...&quot;
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 ml-4">
                <span className="text-[10px] font-black uppercase px-2 py-1 bg-[#2E2E33] text-[#F2F2F2] rounded-lg">
                  Retries: {entry.retry_count}
                </span>
                {isExpanded ? <ChevronDown size={18} className="text-[#909098]" /> : <ChevronRight size={18} className="text-[#909098]" />}
              </div>
            </div>

            {/* Expanded Content (Payload + Stack) */}
            {isExpanded && (
              <div className="px-6 pb-6 pt-2 animate-in slide-in-from-top-2 duration-300">
                <div className="h-px bg-[#2E2E33] w-full mb-4" />
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <span className="text-[10px] font-black uppercase text-[#505058] tracking-widest block mb-2">
                      Error Original
                    </span>
                    <pre className="p-4 rounded-xl bg-black/40 border border-[#2E2E33] text-xs text-[#FF3B30] font-mono whitespace-pre-wrap">
                      {entry.error}
                    </pre>
                  </div>
                  
                  <div>
                    <span className="text-[10px] font-black uppercase text-[#505058] tracking-widest block mb-2">
                      Payload Técnico
                    </span>
                    <div className="relative group/json">
                      <pre className="p-4 rounded-xl bg-black/40 border border-[#2E2E33] text-[10px] text-[#909098] font-mono max-h-[200px] overflow-y-auto custom-scrollbar">
                        {JSON.stringify(entry.payload, null, 2)}
                      </pre>
                      <button 
                        onClick={() => navigator.clipboard.writeText(JSON.stringify(entry.payload))}
                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-[#2E2E33]/50 text-white opacity-0 group-hover/json:opacity-100 transition-opacity"
                      >
                        <ExternalLink size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
