'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import Image from 'next/image'
import { User, Mail, Phone, Camera, Save, AlertCircle, CheckCircle2, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { updateProfile } from './actions'
import { PasswordInput } from '@/components/ui/password-input'

export default function ProfilePage() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  useEffect(() => {
    async function loadUser() {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (authUser) {
        const { data: dbUser } = await supabase
          .from('users').select('*').eq('id', authUser.id).single()
        const merged = { ...authUser, ...dbUser }
        setUser(merged)
        setAvatarUrl(dbUser?.avatar_url ?? null)
      }
      setLoading(false)
    }
    loadUser()
  }, [])

  const showMsg = (type: 'error' | 'success', text: string) => {
    if (type === 'error') { setError(text); setSuccess(null) }
    else { setSuccess(text); setError(null) }
    setTimeout(() => { setError(null); setSuccess(null) }, 4000)
  }

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user?.id) return

    // Validate
    if (!file.type.startsWith('image/')) return showMsg('error', 'Solo se permiten imágenes.')
    if (file.size > 2 * 1024 * 1024) return showMsg('error', 'La imagen no puede superar 2MB.')

    setUploadingPhoto(true)
    const ext = file.name.split('.').pop()
    const path = `avatars/${user.id}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true })

    if (uploadError) {
      setUploadingPhoto(false)
      return showMsg('error', 'Error al subir imagen: ' + uploadError.message)
    }

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)

    const { error: updateError } = await supabase
      .from('users').update({ avatar_url: publicUrl }).eq('id', user.id)

    setUploadingPhoto(false)
    if (updateError) return showMsg('error', 'Error al guardar foto: ' + updateError.message)

    setAvatarUrl(publicUrl + '?t=' + Date.now())
    showMsg('success', 'Foto actualizada correctamente')
  }

  const handleDeletePhoto = async () => {
    if (!user?.id || !avatarUrl) return
    setUploadingPhoto(true)

    // Try to remove from storage (best effort)
    const pathMatch = avatarUrl.match(/avatars\/([^?]+)/)
    if (pathMatch?.[1]) {
      await supabase.storage.from('avatars').remove([`avatars/${pathMatch[1]}`])
    }

    const { error: updateError } = await supabase
      .from('users').update({ avatar_url: null }).eq('id', user.id)

    setUploadingPhoto(false)
    if (updateError) return showMsg('error', 'Error al eliminar foto.')

    setAvatarUrl(null)
    showMsg('success', 'Foto eliminada correctamente')
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await updateProfile(formData)
      if (res?.error) showMsg('error', res.error)
      else if (res?.success) showMsg('success', res.success)
    })
  }

  const initials = user?.name?.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() || 'U'

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Mi Perfil</h1>
        <p className="text-muted-foreground text-sm">Gestiona tu información personal y seguridad</p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-xl flex items-center gap-3 border border-red-100">
          <AlertCircle size={18} />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}
      {success && (
        <div className="p-4 bg-green-50 text-green-700 rounded-xl flex items-center gap-3 border border-green-100">
          <CheckCircle2 size={18} />
          <p className="text-sm font-medium">{success}</p>
        </div>
      )}

      {/* Avatar section — outside form so it saves independently */}
      <Card>
        <div className="flex flex-col items-center sm:flex-row sm:items-center gap-6">
          <div className="relative">
            <div className="h-24 w-24 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 text-3xl font-bold border-4 border-background shadow-sm overflow-hidden">
              {avatarUrl ? (
                <Image src={avatarUrl} alt={user?.name ?? 'Avatar'} width={96} height={96}
                  className="h-full w-full object-cover" unoptimized />
              ) : (
                <span>{initials}</span>
              )}
            </div>
            {uploadingPhoto && (
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                <div className="animate-spin h-6 w-6 border-3 border-white border-t-transparent rounded-full" />
              </div>
            )}
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handlePhotoChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
              className="absolute bottom-0 right-0 p-1.5 bg-brand-600 text-white rounded-full border-2 border-background shadow-sm hover:bg-brand-700 transition-colors disabled:opacity-50"
              title="Cambiar foto"
            >
              <Camera size={14} />
            </button>
          </div>

          <div className="flex flex-col gap-2 items-start">
            <p className="text-sm font-semibold text-foreground">{user?.name}</p>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
            <div className="flex gap-2 mt-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingPhoto}
                className="text-xs text-brand-600 hover:underline disabled:opacity-50"
              >
                {avatarUrl ? 'Cambiar foto' : 'Subir foto'}
              </button>
              {avatarUrl && (
                <>
                  <span className="text-muted-foreground text-xs">·</span>
                  <button
                    type="button"
                    onClick={handleDeletePhoto}
                    disabled={uploadingPhoto}
                    className="text-xs text-red-500 hover:underline flex items-center gap-1 disabled:opacity-50"
                  >
                    <Trash2 size={11} /> Eliminar foto
                  </button>
                </>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">JPG, PNG o WebP · Máx 2MB</p>
          </div>
        </div>
      </Card>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <h2 className="text-base font-semibold text-foreground mb-4">Información personal</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider ml-1">
                  Nombre completo
                </label>
                <div className="relative">
                  <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input name="name" defaultValue={user?.name} className="input-base pl-10"
                    placeholder="Tu nombre" required />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider ml-1">
                  Teléfono
                </label>
                <div className="relative">
                  <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input name="phone" defaultValue={user?.phone} className="input-base pl-10"
                    placeholder="+57 300 000 0000" />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider ml-1">
                Correo electrónico
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input name="email" defaultValue={user?.email} className="input-base pl-10"
                  placeholder="tu@email.com" required />
              </div>
              <p className="text-[10px] text-muted-foreground ml-1 italic">
                Si cambias el email, deberás confirmarlo por correo.
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="text-base font-semibold text-foreground mb-1">Seguridad</h2>
          <p className="text-sm text-muted-foreground mb-4">Deja en blanco si no deseas cambiar tu contraseña.</p>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider ml-1">
              Nueva Contraseña
            </label>
            <PasswordInput name="password" placeholder="••••••••" />
          </div>
        </Card>

        <div className="flex justify-end pt-2">
          <Button disabled={isPending} type="submit" leftIcon={<Save size={16} />}>
            {isPending ? 'Guardando...' : 'Guardar cambios'}
          </Button>
        </div>
      </form>
    </div>
  )
}