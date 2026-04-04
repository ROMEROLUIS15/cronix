# 🛰️ Cronix System Pulse - Observability Dashboard

El **System Pulse** es el centro neurálgico de observabilidad en tiempo real de la plataforma Cronix. Está diseñado exclusivamente para la supervisión técnica de la infraestructura por parte del fundador.

## 🔐 Seguridad e Identidad (100% Inviolable)

Este módulo implementa el modelo de seguridad más estricto de toda la plataforma, basado en **Identidad Física (UID-Lock)** en lugar de solo roles efímeros.

### 🛡️ Blindaje por UID
El acceso a los datos de infraestructura está bloqueado en el motor de base de datos (PostgreSQL RLS) estrictamente al ID único del fundador:
*   **UID Oficial:** `4ff958ce-4422-4d1a-a126-3ca4649fbab5` (Luis Romero).
*   **Comportamiento:** Si cualquier otro usuario intenta acceder a estas tablas, recibirá 0 resultados (aislamiento total).

### ⚔️ Protección contra Escalada de Roles
Se ha implementado un `DATABASE TRIGGER` (`tr_protect_roles`) que impide:
1. Que un usuario se asigne a sí mismo el rol de `platform_admin`.
2. Que se asigne dicho rol administrativo a través de la API web a cualquier persona que no sea el fundador.

---

## ⚡ Arquitectura de Alto Rendimiento

El Dashboard ha sido optimizado para tener un impacto de "Cero Latencia" en el servidor.

### 🚀 Optimización de Identidad (RLS-Cache)
Todas las consultas utilizan el patrón de **Caché de Identidad**:
```sql
USING ((SELECT auth.uid()) = '4ff958ce...')
```
*   **Beneficio:** Evita que la base de datos re-valide el JWT en cada fila, reduciendo el consumo de CPU y la lentitud en la carga de datos masivos como notificaciones.

### 📊 Capas de Observabilidad
1.  **Service Health (`service_health`):** Estado en tiempo real del motor AI, WhatsApp Business y la salud de la Base de Datos.
2.  **Dead Letter Queue (`wa_dead_letter_queue`):** Registro crítico de fallos en el procesamiento de mensajes de IA. Incluye visualización de payloads JSON para depuración técnica rápida.

---

## 📂 Estructura de Archivos

*   **Ruta:** `/dashboard/admin/pulse`
*   **Página Principal:** `app/dashboard/admin/pulse/page.tsx`
*   **Componentes:**
    *   `_components/health-stat-card.tsx` (Telemetría visual)
    *   `_components/dead-letter-log.tsx` (Log de fallos críticos)

---

## 🚀 Mantenimiento y Extensión

Para añadir nuevos servicios al radar de salud, se debe insertar el registro en `public.service_health`. El Pulse lo detectará y renderizará la nueva "tarjeta vital" automáticamente en el próximo ciclo de refresco (60 segundos).

> [!CAUTION]
> **No modificar las políticas de RLS** de este módulo sin entender el impacto en la latencia. El uso de `(SELECT auth.uid())` es obligatorio para mantener la fluidez de la plataforma.

---
**Arquitecto:** Luis Romero (Founding Member)
**Documentado:** Abril 2026
