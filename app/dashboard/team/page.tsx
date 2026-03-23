'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  UserCheck,
  UserX,
  CheckCircle2,
  AlertCircle,
  X,
  Save,
  UsersRound,
  Mail,
  Phone,
  Shield,
  ShieldCheck,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import * as usersRepo from '@/lib/repositories/users.repo'
import type { TeamMember } from '@/lib/repositories/users.repo'

// ── Form state ──────────────────────────────────────────────────────────────

interface EmployeeForm {
  name: string
  email: string
  phone: string
  color: string
}

const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
]

const emptyForm = (): EmployeeForm => ({
  name: '',
  email: '',
  phone: '',
  color: '#6366f1',
})

// ── Page ────────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const { supabase, businessId, userRole, loading: contextLoading } = useBusinessContext()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<EmployeeForm>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const isOwner = userRole === 'owner'

  const loadMembers = useCallback(async (bId: string) => {
    const data = await usersRepo.getTeamMembers(supabase, bId)
    setMembers(data)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    if (businessId) loadMembers(businessId)
    else if (!contextLoading) setLoading(false)
  }, [businessId, contextLoading, loadMembers])

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 4000)
  }

  const openNew = () => {
    setForm(emptyForm())
    setEditingId(null)
    setShowForm(true)
  }

  const openEdit = (m: TeamMember) => {
    setForm({
      name: m.name,
      email: m.email ?? '',
      phone: m.phone ?? '',
      color: m.color ?? '#6366f1',
    })
    setEditingId(m.id)
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !businessId) return showMsg('error', 'El nombre es obligatorio.')
    setSaving(true)

    const payload = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      color: form.color,
    }

    if (editingId) {
      await usersRepo.updateEmployee(supabase, editingId, businessId, payload)
        .then(() => {
          showMsg('success', 'Empleado actualizado')
          setShowForm(false)
          loadMembers(businessId)
        })
        .catch((err: Error) => showMsg('error', err.message))
    } else {
      await usersRepo.createEmployee(supabase, businessId, payload)
        .then(() => {
          showMsg('success', 'Empleado agregado al equipo')
          setShowForm(false)
          loadMembers(businessId)
        })
        .catch((err: Error) => showMsg('error', err.message))
    }

    setSaving(false)
  }

  const handleToggleActive = async (m: TeamMember) => {
    if (!businessId) return
    await usersRepo.toggleEmployeeActive(supabase, m.id, businessId, m.is_active ?? true)
      .then(() => loadMembers(businessId))
      .catch((err: Error) => showMsg('error', err.message))
  }

  const handleDelete = async (id: string) => {
    if (!businessId) return
    setDeletingId(id)
    await usersRepo.deleteEmployee(supabase, id, businessId)
      .then(() => {
        showMsg('success', 'Empleado eliminado')
        loadMembers(businessId)
      })
      .catch((err: Error) => showMsg('error', err.message))
    setDeletingId(null)
  }

  // ── Access guard ────────────────────────────────────────────────────────

  if (!contextLoading && !isOwner) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="text-center py-12 px-6 max-w-sm">
          <Shield size={40} className="mx-auto mb-3 opacity-30" style={{ color: '#909098' }} />
          <p className="text-base font-medium" style={{ color: '#F2F2F2' }}>
            Acceso restringido
          </p>
          <p className="text-sm mt-1" style={{ color: '#909098' }}>
            Solo el dueño del negocio puede gestionar el equipo.
          </p>
        </Card>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full" />
      </div>
    )
  }

  const employees = members.filter(m => m.role === 'employee')
  const owner = members.find(m => m.role === 'owner')

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#F2F2F2' }}>
            Equipo
          </h1>
          <p className="text-sm" style={{ color: '#909098' }}>
            {employees.length === 0
              ? 'Solo tú gestionas las citas'
              : `${employees.length} empleado${employees.length !== 1 ? 's' : ''} en tu equipo`}
          </p>
        </div>
        <Button onClick={openNew} leftIcon={<Plus size={16} />}>
          <span className="hidden sm:inline">Agregar empleado</span>
          <span className="sm:hidden">Agregar</span>
        </Button>
      </div>

      {/* Toast */}
      {msg && (
        <div
          className="p-4 rounded-xl flex items-center gap-3 text-sm"
          style={msg.type === 'success'
            ? { background: 'rgba(48,209,88,0.08)', border: '1px solid rgba(48,209,88,0.2)', color: '#30D158' }
            : { background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.2)', color: '#FF3B30' }
          }
        >
          {msg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          {msg.text}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <Card style={{ border: '1px solid rgba(0,98,255,0.25)' }}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold" style={{ color: '#F2F2F2' }}>
              {editingId ? 'Editar empleado' : 'Nuevo empleado'}
            </h2>
            <button
              onClick={() => setShowForm(false)}
              className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
              style={{ color: '#909098' }}
            >
              <X size={18} />
            </button>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                  Nombre *
                </label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="input-base"
                  placeholder="Ej. Carlos López"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                  Correo electrónico
                </label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#909098' }} />
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="input-base pl-9"
                    placeholder="empleado@correo.com"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#F2F2F2' }}>
                  Teléfono
                </label>
                <div className="relative">
                  <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#909098' }} />
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="input-base pl-9"
                    placeholder="+57 300 000 0000"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: '#F2F2F2' }}>
                  Color en agenda
                </label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, color: c }))}
                      className="w-8 h-8 rounded-full transition-transform hover:scale-110"
                      style={{
                        backgroundColor: c,
                        border: form.color === c ? '3px solid #F2F2F2' : '3px solid transparent',
                        transform: form.color === c ? 'scale(1.15)' : 'scale(1)',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSave} loading={saving} leftIcon={<Save size={16} />}>
                {editingId ? 'Guardar cambios' : 'Agregar empleado'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Owner card */}
      {owner && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2 px-1" style={{ color: '#909098' }}>
            Propietario
          </p>
          <div
            className="flex items-center gap-3 p-3 sm:p-4 rounded-2xl"
            style={{ background: '#1A1A1F', border: '1px solid #2E2E33' }}
          >
            <div
              className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold"
              style={{
                backgroundColor: owner.color ?? 'rgba(0,98,255,0.15)',
                color: '#fff',
              }}
            >
              {owner.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold" style={{ color: '#F2F2F2' }}>
                  {owner.name}
                </p>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                  style={{ background: 'rgba(48,209,88,0.1)', color: '#30D158', border: '1px solid rgba(48,209,88,0.2)' }}
                >
                  <ShieldCheck size={10} />
                  Dueño
                </span>
              </div>
              <p className="text-xs mt-0.5 flex items-center gap-3 flex-wrap" style={{ color: '#909098' }}>
                {owner.email && (
                  <span className="flex items-center gap-1 truncate">
                    <Mail size={11} /> {owner.email}
                  </span>
                )}
                {owner.phone && (
                  <span className="flex items-center gap-1">
                    <Phone size={11} /> {owner.phone}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Employee list */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2 px-1" style={{ color: '#909098' }}>
          Empleados
        </p>

        {employees.length === 0 ? (
          <Card className="text-center py-12 sm:py-16">
            <UsersRound size={40} className="mx-auto mb-3 opacity-30" style={{ color: '#909098' }} />
            <p className="text-base font-medium" style={{ color: '#F2F2F2' }}>
              No tienes empleados aún
            </p>
            <p className="text-sm mt-1 mb-4 px-4" style={{ color: '#909098' }}>
              Agrega empleados para distribuir citas entre tu equipo
            </p>
            <Button onClick={openNew} leftIcon={<Plus size={16} />}>
              Agregar primer empleado
            </Button>
          </Card>
        ) : (
          <div className="space-y-3">
            {employees.map(m => (
              <div
                key={m.id}
                className="flex items-center gap-3 p-3 sm:p-4 rounded-2xl transition-all"
                style={{
                  background: m.is_active ? '#1A1A1F' : '#161619',
                  border: '1px solid #2E2E33',
                  opacity: m.is_active ? 1 : 0.6,
                }}
              >
                {/* Avatar */}
                <div
                  className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold"
                  style={{
                    backgroundColor: m.color ?? 'rgba(0,98,255,0.15)',
                    color: '#fff',
                  }}
                >
                  {m.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold" style={{ color: '#F2F2F2' }}>
                      {m.name}
                    </p>
                    {!m.is_active && (
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: '#212125', color: '#909098', border: '1px solid #2E2E33' }}
                      >
                        Inactivo
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5 flex items-center gap-3 flex-wrap" style={{ color: '#909098' }}>
                    {m.email && (
                      <span className="flex items-center gap-1 truncate max-w-[180px] sm:max-w-none">
                        <Mail size={11} className="flex-shrink-0" /> {m.email}
                      </span>
                    )}
                    {m.phone && (
                      <span className="flex items-center gap-1">
                        <Phone size={11} className="flex-shrink-0" /> {m.phone}
                      </span>
                    )}
                    {!m.email && !m.phone && (
                      <span>Sin datos de contacto</span>
                    )}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleToggleActive(m)}
                    title={m.is_active ? 'Desactivar' : 'Activar'}
                    className="p-2 rounded-lg transition-colors hover:bg-white/5"
                    style={{ color: m.is_active ? '#30D158' : '#909098' }}
                  >
                    {m.is_active ? <UserCheck size={15} /> : <UserX size={15} />}
                  </button>
                  <button
                    onClick={() => openEdit(m)}
                    className="p-2 rounded-lg transition-colors hover:bg-white/5"
                    style={{ color: '#909098' }}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => handleDelete(m.id)}
                    disabled={deletingId === m.id}
                    className="p-2 rounded-lg transition-colors hover:bg-white/5 disabled:opacity-50"
                    style={{ color: '#909098' }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
