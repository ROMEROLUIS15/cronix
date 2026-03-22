'use client'

import { useState, useEffect, useMemo } from 'react'
import { Search, Plus, Phone, Mail, Star, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import * as clientsRepo from '@/lib/repositories/clients.repo'
import { formatCurrency, formatRelative } from '@/lib/utils'
import Link from 'next/link'
import type { Client } from '@/types'

export default function ClientsPage() {
  const { supabase, businessId, loading: contextLoading } = useBusinessContext()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!businessId) {
      if (!contextLoading) setLoading(false)
      return
    }
    async function loadClients() {
      try {
        const data = await clientsRepo.getClients(supabase, businessId!)
        setClients(data)
        setFetchError(null)
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : 'No se pudieron cargar los clientes')
      } finally {
        setLoading(false)
      }
    }
    loadClients()
  }, [supabase, businessId, contextLoading])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return clients
    return clients.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.phone?.includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      (c.tags ?? []).some(t => t.toLowerCase().includes(q))
    )
  }, [query, clients])

  const vipCount = clients.filter(c => (c.tags ?? []).includes('VIP')).length
  const avgSpent = clients.length > 0
    ? clients.reduce((s, c) => s + (c.total_spent ?? 0), 0) / clients.length
    : 0

  if (fetchError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-2">
        <p className="text-sm font-medium" style={{ color: '#FF3B30' }}>No se pudieron cargar los clientes</p>
        <p className="text-xs" style={{ color: '#8A8A90' }}>{fetchError}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Clientes</h1>
          <p className="text-muted-foreground text-sm">
            {loading ? 'Cargando...' : `${clients.length} clientes registrados`}
          </p>
        </div>
        <Link href="/dashboard/clients/new">
          <Button leftIcon={<Plus size={16} />}>Nuevo Cliente</Button>
        </Link>
      </div>

      <div className="relative group max-w-2xl">
        {/* Subtle background glow on focus */}
        <div className="absolute -inset-0.5 bg-gradient-to-r from-brand-500/0 via-brand-500/20 to-brand-500/0 rounded-[1.3rem] opacity-0 group-focus-within:opacity-100 blur-sm transition-opacity duration-500" />
        
        <div className="relative flex items-center">
          <Search 
            size={18} 
            className="absolute left-4 text-[#8A8A90] group-focus-within:text-brand-500 transition-colors duration-300" 
          />
          <input
            type="text"
            placeholder="Buscar por nombre, teléfono, email o etiqueta..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-[#16161A]/80 backdrop-blur-xl border border-brand-500/50 hover:border-brand-500/70 focus:border-brand-500 rounded-2xl py-3.5 pl-12 pr-12 text-sm text-[#F2F2F2] placeholder-[#5A5A62] outline-none transition-all duration-300 focus:ring-4 focus:ring-brand-500/20 shadow-2xl"
          />
          
          {/* Action clues / Clear button */}
          <div className="absolute right-4 flex items-center gap-2">
            {query ? (
              <button 
                onClick={() => setQuery('')}
                className="p-1 rounded-md hover:bg-white/10 text-[#8A8A90] hover:text-white transition-colors"
                title="Limpiar búsqueda"
              >
                <X size={14} />
              </button>
            ) : (
              <div className="hidden sm:flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#2E2E33] bg-[#1C1C21] text-[10px] font-bold text-[#5A5A62] tracking-tighter">
                <span>/</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      {!loading && (
      <div className="grid grid-cols-1 xs:grid-cols-3 gap-3">
          {[
            { label: 'Total clientes', value: clients.length, icon: '👥' },
            { label: 'VIP', value: vipCount, icon: '⭐' },
            { label: 'Ticket promedio', value: formatCurrency(avgSpent), icon: '💰' },
          ].map(s => (
            <div key={s.label} className="card-base text-center p-3 sm:p-4">
              <p className="text-2xl mb-1">{s.icon}</p>
              <p className="text-xl font-bold text-foreground">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card-base flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-base text-center py-16">
          <Search size={40} className="text-muted-foreground mx-auto mb-3 opacity-40" />
          <p className="text-muted-foreground">
            {query ? `No se encontraron clientes para "${query}"` : 'Aún no tienes clientes registrados'}
          </p>
          {query && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setQuery('')}>
              Limpiar búsqueda
            </Button>
          )}
          {!query && (
            <Link href="/dashboard/clients/new">
              <Button size="sm" className="mt-3">Agregar primer cliente</Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="card-base p-0 overflow-hidden">
          <div className="divide-y divide-border">
            {filtered.map(client => <ClientRow key={client.id} client={client} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function ClientRow({ client }: { client: Client }) {
  const isVIP = (client.tags ?? []).includes('VIP')
  return (
    <Link
      href={`/dashboard/clients/${client.id}`}
      className="flex items-center gap-4 px-5 py-4 hover:bg-surface transition-colors duration-150 group"
    >
      <Avatar name={client.name} size="md" className="flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-foreground group-hover:text-brand-600 transition-colors">
            {client.name}
          </p>
          {isVIP && <span className="text-brand-600"><Star size={14} fill="currentColor" /></span>}
          {(client.tags ?? []).filter(t => t !== 'VIP').map(tag => (
            <Badge key={tag} variant="brand" className="text-[10px] px-1.5 py-0">{tag}</Badge>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          {client.phone && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Phone size={11} /> {client.phone}
            </span>
          )}
          {client.email && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground max-w-[160px] sm:max-w-none">
              <Mail size={11} /> <span className="truncate">{client.email}</span>
            </span>
          )}
        </div>
      </div>
      <div className="text-right flex-shrink-0 hidden sm:block">
        <p className="text-sm font-semibold text-foreground">{formatCurrency(client.total_spent ?? 0)}</p>
        <p className="text-xs text-muted-foreground">{client.total_appointments ?? 0} visitas</p>
        {client.last_visit_at && (
          <p className="text-xs text-muted-foreground">{formatRelative(client.last_visit_at)}</p>
        )}
      </div>
    </Link>
  )
}