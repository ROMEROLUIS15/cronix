'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, UserPen, ChevronDown, Mail,
  Tag, FileText, Save, AlertCircle, CheckCircle2, Trash2,
} from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import { getRepos } from '@/lib/repositories'
import { PhoneInputFlags, parsePhone, buildPhone, isE164Phone, COUNTRIES, Country } from '@/components/ui/phone-input-flags'
import { useContactPicker } from '@/lib/hooks/use-contact-picker'
import { useTranslations } from 'next-intl'

const TAG_OPTIONS = ['VIP', 'Frecuente', 'Nuevo'] as const
// ── Component ─────────────────────────────────────────────────────────────────
export default function ClientEditPage() {
  const router          = useRouter()
  const { id: clientId } = useParams<{ id: string }>()
  const t               = useTranslations('clients.form')
  const { supabase, businessId, loading: contextLoading } = useBusinessContext()

  const [loading,        setLoading]        = useState(true)
  const [saving,         setSaving]         = useState(false)
  const [deleting,       setDeleting]       = useState(false)
  const [confirmDelete,  setConfirmDelete]  = useState(false)
  const [legacyPhone,    setLegacyPhone]    = useState(false)
  const [msg,            setMsg]            = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [form, setForm] = useState({
    name:       '',
    phoneLocal: '',
    email:      '',
    notes:      '',
    tags:       [] as string[],
  })

  const [selectedCountry, setSelectedCountry] = useState<Country>(COUNTRIES[0] as Country)

  const { supported: cpSupported, loading: cpLoading, pick: pickContact } = useContactPicker(
    ({ name, phoneLocal, country }) => {
      setForm(prev => ({ ...prev, name: prev.name || name, phoneLocal }));
      setSelectedCountry(country);
    }
  );

  useEffect(() => {
    if (!businessId) {
      if (!contextLoading) router.push('/dashboard/setup')
      return
    }
    async function load() {
      const repos = getRepos(supabase)
      const clientResult = await repos.clients.getById(clientId, businessId!)
      const client = clientResult.data
      if (!client) return router.push('/dashboard/clients')

      setLegacyPhone(!isE164Phone(client.phone))
      const { country, local } = parsePhone(client.phone ?? '')
      setSelectedCountry(country)
      setForm({
        name:       client.name      ?? '',
        phoneLocal: local,
        email:      client.email     ?? '',
        notes:      client.notes     ?? '',
        tags:       client.tags      ?? [],
      })
      setLoading(false)
    }
    load()
  }, [supabase, businessId, contextLoading, clientId, router])

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

    const fullPhone = buildPhone(selectedCountry, form.phoneLocal)

    // Verificar teléfono duplicado (excluir el cliente actual)
    if (fullPhone) {
      const { data: existing } = await supabase
        .from('clients')
        .select('id, name')
        .eq('business_id', businessId)
        .eq('phone', fullPhone)
        .is('deleted_at', null)
        .neq('id', clientId)
        .maybeSingle()

      if (existing) {
        setSaving(false)
        return showMsg('error', `El número ya está registrado para el cliente "${existing.name}".`)
      }
    }

    const { error } = await supabase
      .from('clients')
      .update({
        name:       form.name.trim(),
        phone:      fullPhone,
        email:      form.email.trim()    || null,
        notes:      form.notes.trim()    || null,
        tags:       form.tags.length > 0 ? form.tags : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', clientId)
      .eq('business_id', businessId)

    setSaving(false)
    if (error) return showMsg('error', 'Error al guardar: ' + error.message)
    setLegacyPhone(false)
    showMsg('success', 'Cliente actualizado correctamente')
    setTimeout(() => router.push(`/dashboard/clients/${clientId}`), 1200)
  }

  const handleDelete = async () => {
    if (!businessId) return
    setDeleting(true)
    const { error } = await supabase
      .from('clients')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', clientId)
      .eq('business_id', businessId)

    setDeleting(false)
    if (error) return showMsg('error', 'Error al eliminar: ' + error.message)
    router.push('/dashboard/clients')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 rounded-full"
          style={{ border: '3px solid #272729', borderTopColor: '#0062FF' }} />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      {/* Back */}
      <Link
        href={`/dashboard/clients/${clientId}`}
        className="btn-ghost inline-flex text-sm gap-2"
        style={{ color: '#909098' }}
      >
        <ArrowLeft size={16} /> {t('backToProfile')}
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-black" style={{ color: '#F2F2F2', letterSpacing: '-0.025em' }}>
          {t('editTitle')}
        </h1>
        <p className="text-sm" style={{ color: '#909098' }}>{t('editSubtitle')}</p>
      </div>

      {/* Feedback */}
      {msg && (
        <div
          className="p-4 rounded-xl flex items-center gap-3 text-sm"
          style={msg.type === 'success'
            ? { background: 'rgba(48,209,88,0.08)',  border: '1px solid rgba(48,209,88,0.2)',  color: '#30D158' }
            : { background: 'rgba(255,59,48,0.08)',  border: '1px solid rgba(255,59,48,0.2)',  color: '#FF3B30' }
          }
        >
          {msg.type === 'success'
            ? <CheckCircle2 size={18} />
            : <AlertCircle  size={18} />
          }
          {msg.text}
        </div>
      )}

      {/* ── Aviso número legado ──────────────────────────────────────────── */}
      {legacyPhone && (
        <div
          className="p-4 rounded-xl flex items-start gap-3 text-sm"
          style={{
            background: 'rgba(255,214,10,0.06)',
            border:     '1px solid rgba(255,214,10,0.25)',
            color:      '#FFD60A',
          }}
        >
          <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">{t('legacyPhoneTitle')}</p>
            <p className="mt-0.5 text-xs" style={{ color: 'rgba(255,214,10,0.75)' }}>
              {t('legacyPhoneDesc')}
            </p>
          </div>
        </div>
      )}

      {/* ── Información personal ─────────────────────────────────────────── */}
      <Card>
        <div className="flex items-center gap-3 mb-5">
          <div className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(0,98,255,0.1)' }}>
            <UserPen size={18} style={{ color: '#0062FF' }} />
          </div>
          <h2 className="text-base font-semibold" style={{ color: '#F2F2F2' }}>
            {t('personalInfo')}
          </h2>
        </div>

        <div className="space-y-4">
          {/* Nombre */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
              {t('fullname')} <span style={{ color: '#FF3B30' }}>*</span>
            </label>
            <input
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="input-base"
              placeholder={t('namePlaceholder')}
            />
          </div>

          {/* Teléfono con selector de país */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
              {t('phone')}
            </label>
            <PhoneInputFlags
              country={selectedCountry}
              onCountryChange={c => setSelectedCountry(c)}
              localPhone={form.phoneLocal}
              onLocalPhoneChange={v => setForm({ ...form, phoneLocal: v })}
              onPickContact={cpSupported ? pickContact : undefined}
              pickContactLoading={cpLoading}
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
              {t('email')}
            </label>
            <div className="relative">
              <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#606068' }} />
              <input
                type="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                className="input-base pl-9"
                placeholder="correo@ejemplo.com"
              />
            </div>
          </div>
        </div>
      </Card>

      {/* ── Etiquetas ────────────────────────────────────────────────────── */}
      <Card>
        <div className="flex items-center gap-3 mb-4">
          <div className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(0,98,255,0.1)' }}>
            <Tag size={18} style={{ color: '#0062FF' }} />
          </div>
          <h2 className="text-base font-semibold" style={{ color: '#F2F2F2' }}>{t('tags')}</h2>
        </div>
        <div className="flex gap-2 flex-wrap">
          {TAG_OPTIONS.map(tag => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className="px-4 py-1.5 rounded-full text-sm font-semibold transition-all"
              style={form.tags.includes(tag)
                ? { background: '#0062FF', color: '#fff',    border: '1px solid #0062FF' }
                : { background: 'transparent', color: '#909098', border: '1px solid #2E2E33' }
              }
            >
              {t(`tag.${tag.toLowerCase()}`)}
            </button>
          ))}
        </div>
        {form.tags.length > 0 && (
          <p className="text-xs mt-2" style={{ color: '#6A6A72' }}>
            {t('selectedTags')} {form.tags.join(', ')}
          </p>
        )}
      </Card>

      {/* ── Notas ────────────────────────────────────────────────────────── */}
      <Card>
        <div className="flex items-center gap-3 mb-4">
          <div className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(0,98,255,0.1)' }}>
            <FileText size={18} style={{ color: '#0062FF' }} />
          </div>
          <h2 className="text-base font-semibold" style={{ color: '#F2F2F2' }}>{t('internalNotes')}</h2>
        </div>
        <textarea
          value={form.notes}
          onChange={e => setForm({ ...form, notes: e.target.value })}
          className="input-base resize-none"
          placeholder={t('notesPlaceholder')}
          rows={4}
        />
      </Card>

      {/* ── Acciones ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-2 pb-10">
        {/* Eliminar */}
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-2 text-sm transition-colors"
            style={{ color: '#FF3B30' }}
          >
            <Trash2 size={14} /> {t('deleteClient')}
          </button>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium" style={{ color: '#FF3B30' }}>
              {t('confirmDelete')}
            </span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-1.5 text-xs font-bold text-white rounded-lg disabled:opacity-50"
              style={{ background: '#FF3B30' }}
            >
              {deleting ? t('deleting') : t('yesDelete')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg"
              style={{ border: '1px solid #2E2E33', color: '#909098' }}
            >
              {t('cancelDelete')}
            </button>
          </div>
        )}

        {/* Guardar */}
        <Button onClick={handleSave} loading={saving} leftIcon={<Save size={16} />}>
          {t('saveChanges')}
        </Button>
      </div>
    </div>
  )
}
