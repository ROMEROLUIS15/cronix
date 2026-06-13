# 📋 Manifiesto de Dominio: Módulo de Retención y Reenganche de Clientes

Este documento define el contrato de negocio y las especificaciones técnicas para identificar clientes inactivos y automatizar el envío de recordatorios de reenganche en Cronix.

---

## 1. Propósito

El módulo de retención tiene como objetivo mantener la agenda del negocio llena mediante la detección automática de clientes que han superado su frecuencia habitual de visita sin programar una nueva cita, disparando un mensaje de contacto a través de WhatsApp.

---

## 2. Invariantes de Negocio (Reglas de Oro)

Para garantizar la integridad de los datos, la privacidad de los clientes y una buena experiencia de usuario, este módulo está sujeto a las siguientes reglas inmutables:

*   **Aislamiento Multi-Tenant (Aislamiento por Negocio):** Toda operación de consulta o envío de mensajes debe estar estrictamente filtrada por `business_id`. Un tenant jamás debe tener acceso a la lista de clientes o agenda de otro tenant.
*   **Invariante de Inactividad Dinámica:** Un cliente es elegible para reenganche si y solo si:
    1. Su última cita completada (`MAX(start_at)` con estado `completed`) ocurrió hace más de $N$ días, donde $N$ se resuelve en orden de precedencia:
       - Frecuencia específica del cliente (`clients.attendance_frequency_days`).
       - Frecuencia recomendada del servicio de su última cita (`services.recommended_return_days`).
       - Frecuencia por defecto del negocio (`businesses.default_attendance_frequency_days`).
    2. No tiene ninguna cita futura agendada en estado activo (`pending`, `confirmed`, `rescheduled` con `start_at > NOW()`).
*   **Invariante Anti-Spam (Frecuencia de Contacto):** Para evitar que el cliente perciba los mensajes como molestos o invasivos, no se le enviará un mensaje de reenganche si ya ha recibido uno en los últimos $M$ días (ej. 30 días), controlado por el campo `last_reengaged_at` de la tabla `clients`.
*   **Canal Único de Envío:** Los mensajes se enviarán exclusivamente a través del canal oficial de WhatsApp del negocio usando plantillas autorizadas.

---

## 3. Cambios Necesarios en el Modelo de Datos (Esquema SQL)

Para soportar la variabilidad de verticales (médicos, barberías, estéticas) de forma dinámica, el esquema soporta los siguientes campos:

1.  **En la tabla `public.businesses`:**
    *   `default_attendance_frequency_days`: Entero (por defecto `30`) que define la frecuencia estándar de visita para el negocio, configurable mediante un modal al activar el switch del Agente de Retención en la UI.
2.  **En la tabla `public.services`:**
    *   `recommended_return_days`: Entero opcional (ej. `10` para barberos, `21` para pestañas, `30` para médicos) que define el ciclo recomendado para ese servicio en específico.
3.  **En la tabla `public.clients`:**
    *   `attendance_frequency_days`: Entero opcional para sobreescribir cualquier cálculo y fijar una frecuencia personalizada para un cliente VIP o especial.
    *   `last_reengaged_at`: Marca de tiempo (`timestamptz`) que registra cuándo se le envió el último WhatsApp de retención.

---

## 4. Catálogo de Casos de Uso (Use Cases)

### `GetInactiveClientsUseCase`
*   **Entrada:** `{ businessId }`
*   **Salida:** `Result<InactiveClient[]>` donde `InactiveClient = { id, name, phone, lastVisitAt, lastServiceId, targetFrequencyDays }`
*   **Flujo:**
    1. Obtener la configuración de frecuencia por defecto del negocio (`businesses.default_attendance_frequency_days`).
    2. Consultar todos los clientes activos del negocio.
    3. Para cada cliente:
       - Obtener su última cita completada, incluyendo el `service_id` asociado.
       - Calcular la frecuencia objetivo ($N$ días) resolviendo la precedencia: `client.attendance_frequency_days` ?? `service.recommended_return_days` ?? `business.default_attendance_frequency_days`.
       - Verificar si han transcurrido más de $N$ días desde esa última cita.
       - Validar que no existan citas futuras activas.
       - Validar que `last_reengaged_at` sea nulo o mayor a 30 días.
    4. Retornar la lista resultante.

### `SendReengagementMessagesUseCase`
*   **Entrada:** `{ businessId, clientIds[] }`
*   **Salida:** `Result<{ sentCount: number }>`
*   **Flujo:**
    1. Validar que los `clientIds` pertenezcan al `businessId`.
    2. Por cada cliente, invocar la API del proveedor de WhatsApp con el template del mensaje:
       *"Hola {{name}}, no te hemos visto en {{businessName}}. Si deseas agendar..."*
    3. Registrar la fecha actual en `last_reengaged_at` para cada cliente procesado exitosamente.
    4. Retornar el número de mensajes enviados con éxito.

---

## 5. Contrato de Persistencia (Interfaz de Repositorio)

La capa de dominio utilizará la siguiente extensión en `IClientRepository`:

```typescript
interface IClientRepository {
  // ... métodos existentes
  
  /**
   * Obtiene la lista de clientes inactivos según la frecuencia configurada.
   */
  findInactiveByFrequency(
    businessId: string,
    defaultFrequencyDays: number,
    antiSpamDays: number
  ): Promise<Result<InactiveClientRow[]>>

  /**
   * Actualiza la fecha del último reenganche para evitar spam.
   */
  updateLastReengaged(clientId: string, businessId: string): Promise<Result<void>>
}
```

---

## 6. Criterios de Aceptación (Acceptance Criteria)

*   **AC-1 — Identificación correcta de inactivo:**
    *   **DADO** un cliente cuya última cita fue hace 21 días, y el negocio tiene una frecuencia por defecto de 20 días,
    *   **CUANDO** se ejecuta `GetInactiveClientsUseCase`,
    *   **ENTONCES** el cliente debe aparecer en la lista de inactivos.
*   **AC-2 — Exclusión por cita futura:**
    *   **DADO** un cliente cuya última cita fue hace 25 días, pero tiene una cita en estado `confirmed` para dentro de 3 días,
    *   **CUANDO** se ejecuta `GetInactiveClientsUseCase`,
    *   **ENTONCES** el cliente debe ser excluido de la lista.
*   **AC-3 — Respeto al control de spam:**
    *   **DADO** un cliente inactivo con `last_reengaged_at` hace 10 días,
    *   **CUANDO** se ejecuta `GetInactiveClientsUseCase`,
    *   **ENTONCES** el cliente debe ser excluido para no enviarle mensajes repetitivos.
