'use client'

import { useState, useEffect } from 'react'
import { ArrowLeft, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

const TAG_OPTIONS = ['VIP', 'Frecuente', 'Nuevo']

export default function NewClientPage() {
  const router = useRouter()
  const supabase = createClient()
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '' })
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: dbUser } = await supabase
        .from('users').select('business_id').eq('id', user.id).single()
      if (dbUser?.business_id) setBusinessId(dbUser.business_id)
    }
    init()
  }, [])

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!businessId) { setError('No se pudo obtener la sesión. Recarga la página.'); return }
    setSaving(true)
    setError(null)

    const { error: insertError } = await supabase.from('clients').insert({
      business_id: businessId,
      name:        form.name.trim(),
      phone:       form.phone.trim() || null,
      email:       form.email.trim() || null,
      notes:       form.notes.trim() || null,
      tags:        selectedTags.length > 0 ? selectedTags : null,
    })

    setSaving(false)

    if (insertError) {
      setError('Error al crear el cliente: ' + insertError.message)
    } else {
      router.push('/dashboard/clients')
      router.refresh()
    }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <Link href="/dashboard/clients" className="btn-ghost inline-flex text-sm gap-2 text-muted-foreground">
        <ArrowLeft size={16} /> Volver a Clientes
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Nuevo Cliente</h1>
        <p className="text-muted-foreground text-sm">Registra un nuevo cliente en tu base de datos</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100">
            {error}
          </div>
        )}

        <Card>
          <div className="flex items-center gap-3 mb-5">
            <div className="h-9 w-9 rounded-xl bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
              <UserPlus size={18} className="text-brand-600" />
            </div>
            <h2 className="text-base font-semibold text-foreground">Información personal</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="client-name">
                Nombre completo *
              </label>
              <input
                id="client-name" required value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input-base" placeholder="Ej. Juan Pérez"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="client-phone">
                  Teléfono
                </label>
                <input
                  id="client-phone" type="tel" value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="input-base" placeholder="+57 300 123 4567"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="client-email">
                  Email
                </label>
                <input
                  id="client-email" type="email" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="input-base" placeholder="juan@ejemplo.com"
                />
              </div>
            </div>

            {/* Tags — multiselect buttons */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Etiquetas
              </label>
              <div className="flex gap-2 flex-wrap">
                {TAG_OPTIONS.map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all ${
                      selectedTags.includes(tag)
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'border-border text-muted-foreground hover:border-brand-400'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
              {selectedTags.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Seleccionadas: {selectedTags.join(', ')}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="client-notes">
                Notas internas
              </label>
              <textarea
                id="client-notes" rows={3} value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="input-base resize-none"
                placeholder="Preferencias, alergias, historial relevante..."
              />
            </div>
          </div>
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Link href="/dashboard/clients">
            <Button variant="secondary" type="button">Cancelar</Button>
          </Link>
          <Button type="submit" loading={saving} leftIcon={<UserPlus size={16} />}>
            Guardar Cliente
          </Button>
        </div>
      </form>
    </div>
  )
}