'use client'

import { useState, useMemo } from 'react'
import { Search, Plus, TrendingUp, Phone, Mail, Tag, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { mockClients } from '@/lib/mock/data'
import { formatCurrency, formatRelative, cn } from '@/lib/utils'
import Link from 'next/link'
import type { Client } from '@/types'

export default function ClientsPage() {
  const [query, setQuery] = useState('')
  const [loading] = useState(false)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return mockClients
    return mockClients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone?.includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q))
    )
  }, [query])

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Clientes</h1>
          <p className="text-muted-foreground text-sm">{mockClients.length} clientes registrados</p>
        </div>
        <Link href="/dashboard/clients/new">
          <Button leftIcon={<Plus size={16} />}>Nuevo Cliente</Button>
        </Link>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Buscar por nombre, teléfono, email o etiqueta..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="input-base pl-10"
          id="client-search"
        />
      </div>

      {/* Stats summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total clientes',  value: mockClients.length,                             icon: '👥' },
          { label: 'VIP',            value: mockClients.filter(c => c.tags.includes('VIP')).length, icon: '⭐' },
          { label: 'Activos 30 días', value: 4,                                              icon: '📅' },
          { label: 'Gasto promedio', value: formatCurrency(mockClients.reduce((s,c) => s + (c.total_spent || 0), 0) / mockClients.length), icon: '💰' },
        ].map((s) => (
          <div key={s.label} className="card-base text-center p-4">
            <p className="text-2xl mb-1">{s.icon}</p>
            <p className="text-xl font-bold text-foreground">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Client list */}
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
          <p className="text-muted-foreground">No se encontraron clientes para &quot;{query}&quot;</p>
          {query && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setQuery('')}>
              Limpiar búsqueda
            </Button>
          )}
        </div>
      ) : (
        <div className="card-base p-0 overflow-hidden">
          <div className="divide-y divide-border">
            {filtered.map((client) => (
              <ClientRow key={client.id} client={client} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ClientRow({ client }: { client: Client }) {
  const isVIP = client.tags.includes('VIP')

  return (
    <Link
      href={`/dashboard/clients/${client.id}`}
      className="flex items-center gap-4 px-5 py-4 hover:bg-surface transition-colors duration-150 group"
    >
      <Avatar name={client.name} size="md" className="flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-foreground group-hover:text-brand-600 transition-colors">
            {client.name}
          </p>
          {isVIP && (
            <span className="text-brand-600 flex-shrink-0" title="Cliente VIP">
              <Star size={14} fill="currentColor" />
            </span>
          )}
          <div className="flex gap-1 flex-wrap">
            {client.tags.filter(t => t !== 'VIP').map((tag) => (
              <Badge key={tag} variant="brand" className="text-[10px] px-1.5 py-0">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          {client.phone && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Phone size={11} /> {client.phone}
            </span>
          )}
          {client.email && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Mail size={11} /> {client.email}
            </span>
          )}
        </div>
      </div>

      <div className="text-right flex-shrink-0 hidden sm:block">
        <p className="text-sm font-semibold text-foreground">{formatCurrency(client.total_spent || 0)}</p>
        <p className="text-xs text-muted-foreground">{client.total_appointments || 0} visitas</p>
        {client.last_visit_at && (
          <p className="text-xs text-muted-foreground">{formatRelative(client.last_visit_at)}</p>
        )}
      </div>
    </Link>
  )
}
