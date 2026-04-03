# 🛠️ Luis IA: Assistant Tools Reference (API)

## 📄 Documentación Técnica de Luis IA V4
- [Estrategia de Resiliencia (Shield)](/docs/architecture/RELIABILITY.md)
- [Ingeniería de UX (Premium interactions)](/docs/architecture/UX_ENGINEERING.md)
- [Orquestación de IA (The Brain)](/docs/architecture/AI_ORCHESTRATION.md)
- [Catálogo de Herramientas (V4 Powers)](/docs/api/ASSISTANT_TOOLS.md)

---

This is the technical catalog of capabilities (Tools) available to the Cronix AI Executive Assistant.

### `get_inactive_clients`
Identifica clientes que no han tenido citas en más de 60 días para reactivación.
- **Parámetros**: `ninguno`.
- **Lógica**: Filtra clientes por `last_appointment_at` comparando contra la fecha actual - 60 días.
- **Uso**: Luis sugiere contactar a estos clientes para recuperar ingresos.

### `get_revenue_stats`
Muestra un resumen de facturación de esta semana comparado con la anterior.
- **Parámetros**: `ninguno`.
- **Lógica**: Agrega montos de `transactions` de los últimos 7 días y los compara contra los 7 días previos, calculando el cambio porcentual.

### `send_reactivation_message` [V4]
Envía un mensaje de reactivación por WhatsApp a un cliente inactivo.
- **Parámetros**: `client_name`.
- **Lógica**: Obtiene el teléfono del cliente y el nombre del negocio, y dispara la Edge Function `whatsapp-service` con el template `reactivation_promo`.

## 📅 Appointments Management

### `book_appointment` [V4 UPDATED]
Agenda una nueva cita para un cliente, servicio y fecha específica.
- **Novedad V4**: Ahora soporta el parámetro opcional `staff_name`.
- **Lógica**: Si se proporciona un nombre de empleado, Luis realiza un fuzzy matching en la tabla de equipo y asigna el `staff_id` a la cita.
- **Parameters**: `client_name`, `service_name`, `date`, `time`.
- **Logic**: Uses fuzzy matching for client/service name. Calculates end time based on service duration.
- **Side-effects**: Inserts rows in `appointments` and `appointment_services` tables.

### `cancel_appointment`
Cancels the next upcoming appointment for a client.
- **Parameters**: `client_name`.
- **Logic**: Searches for the first active (pending/confirmed) appointment in the future. updates status to `cancelled`.

### `get_upcoming_gaps`
Consults occupied slots to determine availability.
- **Parameters**: `none`.
- **Logic**: Returns a list of occupied time blocks.

## 💰 Finance & Business

### `get_today_summary`
Strategic daily report for the business owner.
- **Parameters**: `none`.
- **Logic**: Aggregate net income and appointment status (completed, pending, cancelled).

### `register_payment`
Quickly records a transaction/payment.
- **Parameters**: `client_name`, `amount`, `method`.
- **Logic**: Normalizes payment method (cash, card, transfer, qr) and creates a transaction record.

### `get_client_debt`
Consults potential unpaid appointments.
- **Parameters**: `client_name`.
- **Logic**: Searches for completed appointments without associated transactions.

## 🛡️ Security Guardrails (Hardening V4)
Para garantizar la integridad del sistema, cada herramienta cuenta con validaciones de seguridad automáticas:

1. **Multi-tenant Isolation**: El `business_id` se inyecta desde el servidor; el LLM no puede acceder a datos de otros negocios.
2. **Input Validation**:
   - `register_payment`: Rechaza montos $\le 0$ o superiores a limites de seguridad.
   - `book_appointment`: Valida que la fecha no sea anterior a un año del presente.
   - `send_reactivation_message`: Verifica la propiedad del cliente antes de disparar el mensaje.
3. **Error Sanitization**: Los fallos técnicos (DB timeouts, etc.) se ocultan tras mensajes amigables para evitar la exposición de la arquitectura interna.

## 🚀 How to Add a Tool
1. Define the logic in `lib/ai/assistant-tools.ts`.
2. Register the tool schema and its handler in `lib/ai/tool-registry.ts`.
3. Luis IA will automatically "learn" the new skill on the next mount.

### 2. Memoria Conversacional (Short-term Context)
Luis utiliza un `MemoryStore` en memoria de servidor (expandible a Redis) que mantiene los últimos 6 mensajes de la sesión del usuario.
- **Propósito**: Permitir referencias anafóricas (ej: "Agenda a Juan... ¿Cuánto me debe **él**?").
- **Flujo**: Antes de cada petición al LLM, el servicio inyecta el historial relevante, dando a Luis "conciencia" de la conversación actual.

### 3. El Puente LLM Multi-Pass (Multi-Respuesta)
Luis IA realiza una lógica de **razonamiento de dos pasos**:
