# Luis IA — Assistant Tools Reference

> Current tool catalog as of 2026-04-14. All tool definitions live in `lib/ai/orchestrator/decision-engine.ts` (`buildToolDefsForRole`). Execution logic lives in `lib/ai/orchestrator/tool-adapter/RealToolExecutor.ts`.

---

## Tool Parameter Conventions

- `date`: always `YYYY-MM-DD` (e.g. `2026-04-16`)
- `time`: always `HH:mm` in 24-hour format (e.g. `14:30`, `09:00`)
- `appointment_id`, `service_id`, `client_id`: UUIDs — only use values from tool responses or the system prompt context. Never hallucinate UUIDs.

---

## `confirm_booking`

Creates a new appointment.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `service_id` | `string` (UUID) | yes | Exact UUID from the services list in the system prompt |
| `client_name` | `string` | yes* | Client name for fuzzy match resolution |
| `client_id` | `string` (UUID) | no | Client UUID (takes priority over `client_name` when provided) |
| `date` | `string` | yes | `YYYY-MM-DD` |
| `time` | `string` | yes | `HH:mm` 24h |
| `staff_id` | `string` (UUID) | no | Assigned staff member |

*`client_name` is required in the tool definition; `client_id` can replace it functionally if known from a prior `create_client` call.

**Flow**: resolves client (by ID or fuzzy match) → resolves service duration → checks conflict → inserts appointment.

**Error cases**: client not found, service not found, slot already occupied.

---

## `cancel_booking`

Cancels an existing appointment by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appointment_id` | `string` (UUID) | yes | UUID of the appointment to cancel |

**Prerequisite**: If the appointment ID is not known, call `get_appointments_by_date` first to list appointments with their IDs.

---

## `reschedule_booking`

Moves an existing appointment to a new date and time.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appointment_id` | `string` (UUID) | yes | UUID of the appointment |
| `new_date` | `string` | yes | `YYYY-MM-DD` |
| `new_time` | `string` | yes | `HH:mm` 24h |

**Flow**: fetches existing appointment to determine service duration → calculates new end time → checks conflicts → updates.

---

## `get_appointments_by_date`

Returns all active appointments for a given day.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `date` | `string` | yes | `YYYY-MM-DD` |

**Returns**: list of appointments with `time`, `clientName`, `serviceName`, `status`, and `id`. Use the `id` values for subsequent `cancel_booking` or `reschedule_booking` calls.

**Filters**: excludes `cancelled` and `no_show` statuses.

---

## `get_services`

Lists all active services for the business.

No parameters.

**Returns**: service name, duration in minutes, and price per service.

**Note**: The system prompt already includes services with UUIDs. Use this tool when the user explicitly asks for the services list during a conversation.

---

## `get_available_slots`

Returns free time slots for a specific day and service duration.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `date` | `string` | yes | `YYYY-MM-DD` |
| `duration_min` | `number` | yes | Service duration in minutes (from services list) |

**Logic**: generates 30-minute interval slots within working hours, subtracts booked intervals, returns slots with enough consecutive free time for `duration_min`.

**Returns**: list of available slots as `{ time: 'HH:mm', label: '9:00 am' }`.

**Usage**: call before `confirm_booking` when the user asks "what times are available?" or when a specific time slot needs validation.

---

## `create_client`

Registers a new client in the system.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | yes | Full client name (1–120 characters) |
| `phone` | `string` | no | Phone number (up to 30 characters) |

**Returns**: response string includes the new `client_id` UUID explicitly, e.g.:
```
Cliente "María García" registrado (client_id: <uuid>). Usa client_id: <uuid> al llamar confirm_booking.
```

**Chaining**: after `create_client`, pass the returned `client_id` to `confirm_booking` instead of `client_name` to avoid fuzzy matching and ensure the correct client is linked.

**Access**: internal users only (`owner` / `staff`). Not available to external callers.

---

## Tool Chaining Patterns

### New client booking
```
1. create_client { name, phone? }
   → returns client_id

2. confirm_booking { service_id, client_id, date, time }
```

### Cancel without knowing the ID
```
1. get_appointments_by_date { date }
   → returns list with appointment IDs

2. cancel_booking { appointment_id }
```

### Check availability before booking
```
1. get_available_slots { date, duration_min }
   → returns available time labels

2. confirm_booking { service_id, client_name, date, time }
```
