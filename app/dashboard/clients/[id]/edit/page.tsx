'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, User, Phone, Mail, Calendar, Tag, FileText, Save, AlertCircle, CheckCircle2, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

interface Props { params: { id: string } }

const TAGS = ['VIP', 'Frecuente', 'Nuevo']

export default function ClientEditPage({ params }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    birthday: '',
    notes: '',
    tags: [] as string[],
  })

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return router.push('/login')

      const { data: dbUser } = await supabase
        .from('users').select('business_id').eq('id', user.id).single()
      if (!dbUser?.business_id) return router.push('/dashboard/setup')

      setBusinessId(dbUser.business_id)

      const { data: client, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', params.id)
        .eq('business_id', dbUser.business_id)
        .single()

      if (error || !client) return router.push('/dashboard/clients')

      setForm({
        name:     client.name ?? '',
        phone:    client.phone ?? '',
        email:    client.email ?? '',
        birthday: client.birthday ?? '',
        notes:    client.notes ?? '',
        tags:     client.tags ?? [],
      })
      setLoading(false)
    }
    load()
  }, [])

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 4000)
  }

  const toggleTag = (tag: string) =>
    setForm(prev => ({
      ...prev,
      tags: prev.tags.includes(tag)
        ? prev.tags.filter(t => t !== tag)
        : [...prev.tags, tag],
    }))

  const handleSave = async () => {
    if (!form.name.trim()) return showMsg('error', 'El nombre es obligatorio.')
    if (!businessId) return
    setSaving(true)

    const { error } = await supabase
      .from('clients')
      .update({
        name:     form.name.trim(),
        phone:    form.phone.trim() || null,
        email:    form.email.trim() || null,
        birthday: form.birthday || null,
        notes:    form.notes.trim() || null,
        tags:     form.tags.length > 0 ? form.tags : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .eq('business_id', businessId)

    setSaving(false)
    if (error) return showMsg('error', 'Error al guardar: ' + error.message)
    showMsg('success', 'Cliente actualizado correctamente')
    setTimeout(() => router.push(`/dashboard/clients/${params.id}`), 1200)
  }

  const handleDelete = async () => {
    if (!businessId) return
    setDeleting(true)

    // Soft delete
    const { error } = await supabase
      .from('clients')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', params.id)
      .eq('business_id', businessId)

    setDeleting(false)
    if (error) return showMsg('error', 'Error al eliminar: ' + error.message)
    router.push('/dashboard/clients')
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
      <div className="flex items-center justify-between">
        <Link href={`/dashboard/clients/${params.id}`}
          className="btn-ghost inline-flex text-sm gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft size={16} /> Volver al perfil
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Editar Cliente</h1>
        <p className="text-muted-foreground text-sm">Actualiza la información del cliente</p>
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

      <Card>
        <h2 className="text-base font-semibold text-foreground mb-4">Información personal</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Nombre completo <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="input-base pl-10"
                placeholder="Nombre del cliente"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Teléfono</label>
              <div className="relative">
                <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                  className="input-base pl-10"
                  placeholder="+57 300 000 0000"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Correo electrónico</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className="input-base pl-10"
                  placeholder="correo@ejemplo.com"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Fecha de nacimiento</label>
            <div className="relative">
              <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="date"
                value={form.birthday}
                onChange={e => setForm({ ...form, birthday: e.target.value })}
                className="input-base pl-10"
              />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Tag size={16} className="text-brand-600" />
          <h2 className="text-base font-semibold text-foreground">Etiquetas</h2>
        </div>
        <div className="flex gap-2 flex-wrap">
          {TAGS.map(tag => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                form.tags.includes(tag)
                  ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                  : 'bg-surface text-muted-foreground border-border hover:border-brand-300'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-3">
          <FileText size={16} className="text-brand-600" />
          <h2 className="text-base font-semibold text-foreground">Notas internas</h2>
        </div>
        <textarea
          value={form.notes}
          onChange={e => setForm({ ...form, notes: e.target.value })}
          className="input-base min-h-[100px] resize-none"
          placeholder="Preferencias, alergias, observaciones..."
          rows={4}
        />
      </Card>

      <div className="flex items-center justify-between pt-2">
        {/* Delete */}
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 hover:underline"
          >
            <Trash2 size={14} /> Eliminar cliente
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-red-600 font-medium">¿Confirmar eliminación?</span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-1.5 text-xs font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg disabled:opacity-50"
            >
              {deleting ? 'Eliminando...' : 'Sí, eliminar'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="px-3 py-1.5 text-xs font-medium border border-border rounded-lg hover:bg-surface"
            >
              Cancelar
            </button>
          </div>
        )}

        {/* Save */}
        <Button onClick={handleSave} loading={saving} leftIcon={<Save size={16} />}>
          Guardar cambios
        </Button>
      </div>
    </div>
  )
}