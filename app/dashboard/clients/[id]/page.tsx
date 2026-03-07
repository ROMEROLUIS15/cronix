import { notFound } from 'next/navigation'
import { ArrowLeft, Phone, Mail, Star, Calendar, DollarSign, Tag } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge, AppointmentStatusBadge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { mockClients, mockAppointments } from '@/lib/mock/data'
import { formatCurrency, formatDate, formatRelative } from '@/lib/utils'

interface Props { params: { id: string } }

export default function ClientDetailPage({ params }: Props) {
  const client = mockClients.find((c) => c.id === params.id)
  if (!client) return notFound()

  const clientAppointments = mockAppointments.filter((a) => a.clientId === client.id)
  const isVIP = client.tags.includes('VIP')

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      {/* Back */}
      <Link href="/dashboard/clients" className="btn-ghost inline-flex text-sm gap-2 text-muted-foreground hover:text-foreground">
        <ArrowLeft size={16} /> Volver a Clientes
      </Link>

      {/* Profile header */}
      <Card>
        <div className="flex items-start gap-4">
          <Avatar name={client.name} size="xl" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-foreground">{client.name}</h1>
              {isVIP && (
                <span className="text-brand-600" title="Cliente VIP">
                  <Star size={18} fill="currentColor" />
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
              {client.phone && (
                <a href={`tel:${client.phone}`} className="flex items-center gap-1.5 hover:text-brand-600">
                  <Phone size={14} /> {client.phone}
                </a>
              )}
              {client.email && (
                <a href={`mailto:${client.email}`} className="flex items-center gap-1.5 hover:text-brand-600">
                  <Mail size={14} /> {client.email}
                </a>
              )}
            </div>
            {client.tags.length > 0 && (
              <div className="flex items-center gap-1.5 mt-3">
                <Tag size={12} className="text-muted-foreground" />
                {client.tags.map((tag) => (
                  <Badge key={tag} variant="brand">{tag}</Badge>
                ))}
              </div>
            )}
          </div>
          <Button variant="secondary" size="sm">Editar</Button>
        </div>
      </Card>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="text-center p-4">
          <Calendar size={20} className="text-brand-600 mx-auto mb-2" />
          <p className="text-2xl font-bold text-foreground">{client.total_appointments}</p>
          <p className="text-xs text-muted-foreground">Visitas totales</p>
        </Card>
        <Card className="text-center p-4">
          <DollarSign size={20} className="text-brand-600 mx-auto mb-2" />
          <p className="text-2xl font-bold text-foreground">{formatCurrency(client.total_spent || 0)}</p>
          <p className="text-xs text-muted-foreground">Gasto total</p>
        </Card>
        <Card className="text-center p-4">
          <DollarSign size={20} className="text-brand-600 mx-auto mb-2" />
          <p className="text-2xl font-bold text-foreground">
            {formatCurrency((client.total_appointments || 0) > 0 ? (client.total_spent || 0) / (client.total_appointments || 1) : 0)}
          </p>
          <p className="text-xs text-muted-foreground">Ticket promedio</p>
        </Card>
      </div>

      {/* Appointment history */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-foreground">Historial de Citas</h2>
          {client.last_visit_at && (
            <span className="text-xs text-muted-foreground">Última: {formatRelative(client.last_visit_at)}</span>
          )}
        </div>
        {clientAppointments.length === 0 ? (
          <div className="text-center py-8">
            <Calendar size={36} className="text-muted-foreground mx-auto mb-2 opacity-40" />
            <p className="text-sm text-muted-foreground">Sin historial de citas</p>
          </div>
        ) : (
          <div className="space-y-3">
            {clientAppointments.map((apt) => (
              <div key={apt.id} className="flex items-center gap-4 p-3 rounded-xl bg-surface">
                <div className="w-1 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: apt.service.color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{apt.service.name}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(apt.startAt, 'd MMM yyyy, HH:mm')}</p>
                </div>
                <AppointmentStatusBadge status={apt.status} />
                <p className="text-sm font-semibold text-foreground">{formatCurrency(apt.service.price)}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Notes */}
      {client.notes && (
        <Card>
          <h2 className="text-base font-semibold text-foreground mb-3">Notas internas</h2>
          <p className="text-sm text-muted-foreground bg-surface rounded-xl p-4">{client.notes}</p>
        </Card>
      )}
    </div>
  )
}
