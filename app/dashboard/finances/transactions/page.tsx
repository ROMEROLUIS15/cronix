'use client'

import { useState } from 'react'
import { ArrowLeft, DollarSign, Search, Plus } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { mockTransactions } from '@/lib/mock/data'
import { formatCurrency, formatDate, paymentMethodLabels } from '@/lib/utils'

export default function TransactionsPage() {
  const [query, setQuery] = useState('')

  const filtered = mockTransactions.filter((t) => 
    t.description?.toLowerCase().includes(query.toLowerCase()) ||
    t.method.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/finances" className="btn-ghost p-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Historial de Cobros</h1>
            <p className="text-muted-foreground text-sm">{mockTransactions.length} ingresos registrados</p>
          </div>
        </div>
        <Link href="/dashboard/finances/new">
          <Button leftIcon={<Plus size={16} />}>Registrar Cobro</Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Buscar transacción..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="input-base pl-10"
        />
      </div>

      {/* List */}
      <Card className="p-0 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <DollarSign size={40} className="text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-muted-foreground">No se encontraron cobros para &quot;{query}&quot;</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((txn) => (
              <div key={txn.id} className="flex items-center gap-4 px-5 py-4 hover:bg-surface transition-colors">
                <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                  <DollarSign size={18} className="text-green-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground">
                    {paymentMethodLabels[txn.method]}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(txn.paidAt, 'd MMM yyyy, HH:mm')} 
                    {txn.description && ` · ${txn.description}`}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-base font-bold text-green-600">+{formatCurrency(txn.netAmount)}</p>
                  {txn.discount > 0 && (
                    <p className="text-xs text-muted-foreground">Desc. {txn.discount}%</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
