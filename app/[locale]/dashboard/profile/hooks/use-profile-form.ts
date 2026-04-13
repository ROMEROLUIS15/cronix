/**
 * use-profile-form — Extracts all data loading, avatar management, and form state
 * from the profile page into a reusable hook.
 *
 * Uses getContainer() from @/lib/container instead of getRepos(supabase).
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getBrowserContainer } from '@/lib/browser-container';
import { useBusinessContext } from '@/lib/hooks/use-business-context';

export interface ProfileUser {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
}

export interface ProfileFormReturn {
  user: ProfileUser | null;
  loading: boolean;
  uploadingPhoto: boolean;
  avatarUrl: string | null;
  setAvatarUrl: React.Dispatch<React.SetStateAction<string | null>>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handlePhotoChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleDeletePhoto: () => Promise<void>;
  showMsg: (type: 'error' | 'success', text: string) => void;
}

export function useProfileForm(): ProfileFormReturn {
  const { supabase } = useBusinessContext();
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Data loading — uses container pattern
  useEffect(() => {
    async function loadUser() {
      const container = getBrowserContainer();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const result = await container.users.getUserProfile(authUser.id);
        if (result.data) {
          const dbUser = result.data;
          setUser({
            id: dbUser.id,
            name: dbUser.name,
            email: authUser.email ?? dbUser.email,
            phone: dbUser.phone,
            avatar_url: dbUser.avatar_url,
          });
          setAvatarUrl(dbUser.avatar_url ?? null);
        }
      }
      setLoading(false);
    }
    loadUser();
  }, [supabase]);

  const showMsg = useCallback((type: 'error' | 'success', text: string) => {
    if (type === 'error') { setError(text); setSuccess(null); }
    else { setSuccess(text); setError(null); }
    setTimeout(() => { setError(null); setSuccess(null); }, 5000);
  }, []);

  const handlePhotoChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;
    if (!file.type.startsWith('image/')) return showMsg('error', 'Formato de imagen no válido');
    if (file.size > 2 * 1024 * 1024) return showMsg('error', 'La imagen debe ser menor a 2MB');

    setUploadingPhoto(true);
    const ext = file.name.split('.').pop();
    const path = `avatars/${user.id}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true });

    if (uploadError) {
      setUploadingPhoto(false);
      return showMsg('error', 'Error al subir: ' + uploadError.message);
    }

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
    const container = getBrowserContainer();
    await container.users.updateAvatar(user.id, publicUrl);
    setUploadingPhoto(false);
    setAvatarUrl(publicUrl + '?t=' + Date.now());
    showMsg('success', 'Imagen subida correctamente');
  }, [user, supabase, showMsg]);

  const handleDeletePhoto = useCallback(async () => {
    if (!user?.id || !avatarUrl) return;
    setUploadingPhoto(true);
    const pathMatch = avatarUrl.match(/avatars\/([^?]+)/);
    if (pathMatch?.[1]) {
      await supabase.storage.from('avatars').remove([pathMatch[1]]);
    }
    const container = getBrowserContainer();
    await container.users.updateAvatar(user.id, null);
    setUploadingPhoto(false);
    setAvatarUrl(null);
    showMsg('success', 'Imagen eliminada');
  }, [user, avatarUrl, supabase, showMsg]);

  return {
    user,
    loading,
    uploadingPhoto,
    avatarUrl,
    setAvatarUrl,
    fileInputRef,
    handlePhotoChange,
    handleDeletePhoto,
    showMsg,
  };
}
