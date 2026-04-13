'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { User, Mail, Camera, Save, AlertCircle, CheckCircle2, Trash2, Lock } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useProfileForm } from './hooks/use-profile-form'
import { updateProfile } from './actions'
import { PasswordInput } from '@/components/ui/password-input'
import { PhoneInputFlags, type Country, COUNTRIES } from '@/components/ui/phone-input-flags'
import { PasskeyRegister } from '@/components/ui/passkey-register'
import { useTranslations } from 'next-intl'

export default function ProfilePage() {
  const t = useTranslations('profile')
  const {
    user, loading, uploadingPhoto, avatarUrl, setAvatarUrl,
    fileInputRef, handlePhotoChange, handleDeletePhoto, showMsg,
  } = useProfileForm()

  const [isPending, startTransition] = useTransition()
  const [changePassword, setChangePassword] = useState(false)
  const [phoneCountry, setPhoneCountry] = useState<Country>(COUNTRIES[1] as Country)
  const [localPhone, setLocalPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Override showMsg to also track local error/success state
  const handleMsg = (type: 'error' | 'success', text: string) => {
    if (type === 'error') { setError(text); setSuccess(null) }
    else { setSuccess(text); setError(null) }
    setTimeout(() => { setError(null); setSuccess(null) }, 5000)
    showMsg(type, text)
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    const formData = new FormData(e.currentTarget)
    if (!changePassword) {
      formData.set('password', '')
      formData.set('confirmPassword', '')
    }
    startTransition(async () => {
      const res = await updateProfile(formData)
      if (res?.error) handleMsg('error', res.error)
      else if (res?.success) {
        handleMsg('success', res.success)
        if (changePassword) setChangePassword(false)
      }
    })
  }

  const initials = user?.name
    ?.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() || 'U'

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 border-4 border-t-transparent rounded-full"
          style={{ borderColor: '#0062FF', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#F2F2F2' }}>{t('title')}</h1>
        <p className="text-sm" style={{ color: '#909098' }}>
          {t('subtitle')}
        </p>
      </div>

      {/* Error banner — dark theme */}
      {error && (
        <div className="p-4 rounded-xl flex items-center gap-3"
          style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.2)', color: '#FF6B6B' }}>
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Success banner — dark theme */}
      {success && (
        <div className="p-4 rounded-xl flex items-center gap-3"
          style={{ background: 'rgba(48,209,88,0.08)', border: '1px solid rgba(48,209,88,0.2)', color: '#30D158' }}>
          <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
          <p className="text-sm font-medium">{success}</p>
        </div>
      )}

      {/* Avatar — independent of form */}
      <Card>
        <div className="flex flex-col items-center sm:flex-row sm:items-center gap-6">
          <div className="relative">
            <div className="h-24 w-24 rounded-full flex items-center justify-center text-3xl font-bold border-4 shadow-sm overflow-hidden"
              style={{ background: 'rgba(0,98,255,0.15)', color: '#0062FF', borderColor: '#1A1A1F' }}>
              {avatarUrl ? (
                <Image src={avatarUrl} alt={user?.name ?? 'Avatar'} width={96} height={96}
                  className="h-full w-full object-cover" sizes="96px" />
              ) : (
                <span>{initials}</span>
              )}
            </div>
            {uploadingPhoto && (
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                <div className="animate-spin h-6 w-6 border-2 border-white border-t-transparent rounded-full" />
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp"
              className="hidden" onChange={handlePhotoChange} />
            <button type="button" onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
              className="absolute bottom-0 right-0 p-1.5 text-white rounded-full border-2 shadow-sm transition-colors disabled:opacity-50"
              style={{ background: '#0062FF', borderColor: '#1A1A1F' }}>
              <Camera size={14} />
            </button>
          </div>

          <div className="flex flex-col gap-2 items-start">
            <p className="text-sm font-semibold" style={{ color: '#F2F2F2' }}>{user?.name}</p>
            <p className="text-xs" style={{ color: '#909098' }}>{user?.email}</p>
            <div className="flex gap-2 mt-1">
              <button type="button" onClick={() => fileInputRef.current?.click()}
                disabled={uploadingPhoto}
                className="text-xs hover:underline disabled:opacity-50"
                style={{ color: '#3884FF' }}>
                {avatarUrl ? t('changePhoto') : t('uploadPhoto')}
              </button>
              {avatarUrl && (
                <>
                  <span className="text-xs" style={{ color: '#4A4A5A' }}>·</span>
                  <button type="button" onClick={handleDeletePhoto} disabled={uploadingPhoto}
                    className="text-xs hover:underline flex items-center gap-1 disabled:opacity-50"
                    style={{ color: '#FF3B30' }}>
                    <Trash2 size={11} /> {t('deletePhoto')}
                  </button>
                </>
              )}
            </div>
            <p className="text-[10px]" style={{ color: '#6A6A72' }}>{t('photoReqs')}</p>
          </div>
        </div>
      </Card>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Personal info */}
        <Card>
          <h2 className="text-base font-semibold mb-4" style={{ color: '#F2F2F2' }}>
            {t('personalInfo')}
          </h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider ml-1"
                  style={{ color: '#909098' }}>
                  {t('fullname')}
                </label>
                <div className="relative">
                  <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: '#909098' }} />
                  <input name="name" defaultValue={user?.name ?? ''} className="input-base pl-10"
                    placeholder={t('fullnameLabel')} required />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider ml-1"
                  style={{ color: '#909098' }}>
                  {t('phone')}
                </label>
                <div className="relative">
                  <input type="hidden" name="phone"
                    value={`${phoneCountry.dial} ${localPhone.trim()}`} />
                  <PhoneInputFlags
                    country={phoneCountry}
                    onCountryChange={setPhoneCountry}
                    localPhone={localPhone}
                    onLocalPhoneChange={setLocalPhone}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider ml-1"
                style={{ color: '#909098' }}>
                {t('email')}
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: '#909098' }} />
                <input name="email" defaultValue={user?.email ?? ''} className="input-base pl-10"
                  placeholder={t('emailLabel')} required />
              </div>
              <p className="text-[10px] ml-1 italic" style={{ color: '#6A6A72' }}>
                {t('emailWarning')}
              </p>
            </div>
          </div>
        </Card>

        {/* Security */}
        <Card>
          <div className="flex items-center justify-between mb-1">
            <div>
              <h2 className="text-base font-semibold" style={{ color: '#F2F2F2' }}>{t('securityTitle')}</h2>
              <p className="text-sm" style={{ color: '#909098' }}>
                {t('securitySubtitle')}
              </p>
            </div>
            <button type="button" onClick={() => setChangePassword(v => !v)}
              className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors"
              style={changePassword
                ? { background: 'rgba(255,59,48,0.08)', color: '#FF6B6B', borderColor: 'rgba(255,59,48,0.2)' }
                : { background: 'rgba(0,98,255,0.08)', color: '#3884FF', borderColor: 'rgba(0,98,255,0.2)' }
              }>
              <Lock size={13} />
              {changePassword ? t('cancel') : t('changePasswordBtn')}
            </button>
          </div>

          {changePassword && (
            <div className="mt-4 space-y-4 pt-4" style={{ borderTop: '1px solid #2E2E33' }}>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider ml-1"
                  style={{ color: '#909098' }}>
                  {t('newPassword')}
                </label>
                <PasswordInput name="password" placeholder={t('newPasswordLabel')}
                  required={changePassword} />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider ml-1"
                  style={{ color: '#909098' }}>
                  {t('confirmPassword')}
                </label>
                <PasswordInput name="confirmPassword" placeholder={t('confirmPasswordLabel')}
                  required={changePassword} />
              </div>
            </div>
          )}

          {!changePassword && (
            <p className="text-xs mt-3 flex items-center gap-1.5" style={{ color: '#6A6A72' }}>
              <Lock size={12} />
              {t('passwordSet')}
            </p>
          )}
        </Card>

        <div className="flex justify-end pt-2">
          <Button disabled={isPending} type="submit" leftIcon={<Save size={16} />}>
            {t('saveProfile')}
          </Button>
        </div>
      </form>

      {/* ── Passkeys ── */}
      <Card className="p-5 sm:p-6">
        <PasskeyRegister />
      </Card>
    </div>
  )
}