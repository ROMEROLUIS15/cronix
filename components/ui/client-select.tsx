'use client'

import React, { useState, useMemo } from 'react'
import { Search, ChevronDown, User } from 'lucide-react'
import { Modal } from './modal'
import type { Client } from '@/types'

interface ClientSelectProps {
  clients: Client[]
  value: string
  onChange: (clientId: string) => void
  required?: boolean
}

export function ClientSelect({ clients, value, onChange, required }: ClientSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')

  // Selected client for rendering the button text
  const selectedClient = clients.find(c => c.id === value)

  // Filter clients based on search query (name or phone)
  const filteredClients = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return clients
    return clients.filter(c => 
      c.name.toLowerCase().includes(q) || 
      (c.phone && c.phone.includes(q))
    )
  }, [clients, search])

  const handleSelect = (id: string) => {
    onChange(id)
    setIsOpen(false)
    setSearch('')
  }

  return (
    <>
      {/* 
        This hidden input ensures HTML native form validation triggers correctly 
        if `required` is set and no value is selected.
      */}
      {required && (
        <input 
          type="text" 
          required 
          value={value} 
          onChange={() => {}} 
          className="sr-only" 
          tabIndex={-1} 
          aria-hidden="true" 
        />
      )}

      {/* Button acting as the select trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="input-base bg-card flex items-center justify-between text-left w-full h-11"
      >
        <span className="truncate" style={{ color: selectedClient ? '#F2F2F2' : '#909098' }}>
          {selectedClient ? selectedClient.name : 'Selecciona un cliente...'}
        </span>
        <ChevronDown size={16} className="text-muted-foreground flex-shrink-0 ml-2" />
      </button>

      {/* Search Modal */}
      <Modal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title="Selecciona un cliente"
      >
        <div className="flex flex-col h-[60vh] sm:h-[50vh]">
          {/* Search Box */}
          <div className="relative mb-4 flex-shrink-0">
            <Search 
              size={18} 
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" 
            />
            <input
              type="search"
              placeholder="Buscar por nombre o teléfono..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none transition-all placeholder:text-muted-foreground"
              style={{
                background: 'var(--surface, #212125)',
                border: '1px solid var(--border, #2E2E33)',
                color: '#F2F2F2',
              }}
              onFocus={(e) => {
                e.target.style.borderColor = '#0062FF'
                e.target.style.boxShadow = '0 0 0 1px #0062FF'
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'var(--border, #2E2E33)'
                e.target.style.boxShadow = 'none'
              }}
              autoFocus
            />
          </div>

          {/* List of Clients */}
          <div className="flex-1 overflow-y-auto pr-2 space-y-2 pb-4">
            {filteredClients.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground">No se encontraron clientes</p>
              </div>
            ) : (
              filteredClients.map(client => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => handleSelect(client.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors text-left ${
                    value === client.id 
                      ? 'bg-brand/10 border border-brand/20' 
                      : 'bg-surface hover:bg-[#2A2A2F] border border-transparent'
                  }`}
                >
                  <div className="h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: '#212125' }}>
                    <User size={16} style={{ color: '#909098' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{client.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {client.phone || 'Sin teléfono'}
                    </p>
                  </div>
                  {/* Radio button style indicator for the active one */}
                  <div className="h-5 w-5 rounded-full border flex items-center justify-center flex-shrink-0"
                    style={{ 
                      borderColor: value === client.id ? '#0062FF' : '#3A3A3F',
                      background: value === client.id ? 'transparent' : '#212125' 
                    }}>
                    {value === client.id && (
                      <div className="h-2.5 w-2.5 rounded-full bg-brand" />
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </Modal>
    </>
  )
}
