'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AlertCircle, CheckCircle, Lock, Unlock } from 'lucide-react'

interface LockedUser {
  email: string
  attempt_count: number
  locked_until: string | null
  last_attempt_at: string
  created_at: string
}

interface SecurityAlert {
  id: string
  email: string
  alert_type: string
  severity: string
  lockout_count_24h: number
  status: string
}

export default function LockedUsersPage() {
  const supabase = createClient()
  const [lockedUsers, setLockedUsers] = useState<LockedUser[]>([])
  const [alerts, setAlerts] = useState<SecurityAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [unblockingEmail, setUnblockingEmail] = useState<string | null>(null)

  useEffect(() => {
    loadLockedUsers()
    loadAlerts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadLockedUsers() {
    setLoading(true)
    const { data, error } = await (supabase as any)
      .from('failed_password_attempts')
      .select('*')
      .not('locked_until', 'is', null)
      .gte('locked_until', new Date().toISOString())
      .order('locked_until', { ascending: false })

    if (!error && data) {
      setLockedUsers(data)
    }
    setLoading(false)
  }

  async function loadAlerts() {
    const { data, error } = await (supabase as any)
      .from('security_alerts')
      .select('*')
      .eq('status', 'pending_review')
      .order('created_at', { ascending: false })
      .limit(10)

    if (!error && data) {
      setAlerts(data)
    }
  }

  async function unlockUser(email: string) {
    setUnblockingEmail(email)
    try {
      const { error } = await (supabase as any).rpc('fn_reset_password_attempts', {
        p_email: email,
      })

      if (!error) {
        // Reload users
        await loadLockedUsers()
        alert(`✓ ${email} ha sido desbloqueado`)
      } else {
        alert(`Error al desbloquear: ${error.message}`)
      }
    } catch (err) {
      console.error('Error unlocking user:', err)
      alert('Error al desbloquear el usuario')
    } finally {
      setUnblockingEmail(null)
    }
  }

  const getMinutesUntilUnlock = (lockedUntil: string | null) => {
    if (!lockedUntil) return 0
    const now = new Date().getTime()
    const unlockTime = new Date(lockedUntil).getTime()
    return Math.ceil((unlockTime - now) / (1000 * 60))
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'warning':
        return 'bg-yellow-50 border-yellow-300'
      case 'critical':
        return 'bg-red-50 border-red-300'
      case 'immediate_review':
        return 'bg-red-100 border-red-500'
      default:
        return 'bg-gray-50 border-gray-300'
    }
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Usuarios Bloqueados</h1>
        <p className="text-gray-600">
          Gestiona intentos fallidos de login y desbloquea usuarios
        </p>
      </div>

      {/* Security Alerts */}
      {alerts.length > 0 && (
        <Card className="mb-8 p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="w-6 h-6 text-red-500" />
            <h2 className="text-2xl font-bold">Alertas de Seguridad</h2>
          </div>
          <div className="space-y-4">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`p-4 border rounded-lg ${getSeverityColor(alert.severity)}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-semibold text-lg">{alert.email}</p>
                    <p className="text-sm text-gray-600">
                      {alert.alert_type}: {alert.lockout_count_24h} bloqueos en 24h
                    </p>
                  </div>
                  <span className={`px-3 py-1 rounded text-sm font-medium ${
                    alert.severity === 'immediate_review'
                      ? 'bg-red-500 text-white'
                      : alert.severity === 'critical'
                        ? 'bg-red-300 text-red-900'
                        : 'bg-yellow-300 text-yellow-900'
                  }`}>
                    {alert.severity.toUpperCase()}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    // Navigate to alert detail
                    window.location.href = `/admin/security/alerts/${alert.id}`
                  }}
                >
                  Ver Detalles
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Locked Users Table */}
      <Card className="p-6">
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <Lock className="w-6 h-6" />
          Usuarios Actualmente Bloqueados ({lockedUsers.length})
        </h2>

        {loading ? (
          <div className="text-center py-8">Cargando...</div>
        ) : lockedUsers.length === 0 ? (
          <div className="text-center py-12">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <p className="text-lg text-gray-600">No hay usuarios bloqueados</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-semibold">Email</th>
                  <th className="text-left py-3 px-4 font-semibold">Intentos</th>
                  <th className="text-left py-3 px-4 font-semibold">Bloqueado hasta</th>
                  <th className="text-left py-3 px-4 font-semibold">Minutos</th>
                  <th className="text-left py-3 px-4 font-semibold">Acción</th>
                </tr>
              </thead>
              <tbody>
                {lockedUsers.map((user) => {
                  const minutesLeft = getMinutesUntilUnlock(user.locked_until)
                  return (
                    <tr key={user.email} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4 font-mono text-sm">{user.email}</td>
                      <td className="py-3 px-4">
                        <span className="bg-red-100 text-red-800 px-3 py-1 rounded">
                          {user.attempt_count}/3
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm">
                        {user.locked_until
                          ? new Date(user.locked_until).toLocaleString('es-ES')
                          : 'N/A'}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`font-semibold ${
                          minutesLeft <= 5 ? 'text-green-600' : 'text-orange-600'
                        }`}>
                          {minutesLeft}m
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={unblockingEmail === user.email}
                          onClick={() => unlockUser(user.email)}
                        >
                          {unblockingEmail === user.email ? (
                            'Desbloqueando...'
                          ) : (
                            <>
                              <Unlock className="w-4 h-4 mr-1" />
                              Desbloquear
                            </>
                          )}
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Instructions */}
      <Card className="mt-8 p-6 bg-blue-50 border-blue-200">
        <h3 className="font-semibold mb-2">Instrucciones</h3>
        <ul className="text-sm text-gray-700 space-y-1">
          <li>• Los usuarios se desbloquean automáticamente después de 15 minutos</li>
          <li>• Puedes desbloquear manualmente un usuario si es necesario</li>
          <li>• Las alertas de seguridad con 5+ bloqueos en 24h requieren revisión</li>
          <li>• Revisa las alertas para detectar intentos de acceso no autorizado</li>
        </ul>
      </Card>
    </div>
  )
}
