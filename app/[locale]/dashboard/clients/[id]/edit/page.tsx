'use client'

import { useParams } from 'next/navigation'
import {
  ArrowLeft, UserPen, Mail,
  Tag, FileText, Save, AlertCircle, CheckCircle2, Trash2,
} from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PhoneInputFlags, COUNTRIES, Country } from '@/components/ui/phone-input-flags'
import { useTranslations } from 'next-intl'
import { useClientEditForm } from './hooks/use-client-edit-form'

const TAG_OPTIONS = ['VIP', 'Frecuente', 'Nuevo'] as const

// ── Component ─────────────────────────────────────────────────────────────────
export default function ClientEditPage() {
  const { id: clientId } = useParams<{ id: string }>()
  const t = useTranslations('clients.form')

  const {
    loading, saving, deleting, confirmDelete, setConfirmDelete,
    legacyPhone, form, setForm, selectedCountry, setSelectedCountry,
    msg, handleSave, handleDelete, toggleTag,
    pickContact, cpSupported, cpLoading,
  } = useClientEditForm(clientId)

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
