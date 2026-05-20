# 🔔 Web Push Standards & RFC 8291 Implementation

Cronix features a custom, zero-dependency **Web Push** notification engine implemented directly in Supabase Edge Functions (Deno). Unlike common implementations that rely on the `web-push` npm package, Cronix implements the **RFC 8291** and **RFC 8030** standards using the native **Web Crypto API**.

---

## 🏗️ Technical Architecture

The system is designed for maximum performance, minimal cold-start times (due to zero npm imports in the crypto path), and strict multi-tenant security.

### The Cryptographic Stack

| Protocol | Purpose | Implementation |
|---|---|---|
| **VAPID** | Server Identification | JWT signed via **ES256** (ECDSA P-256 + SHA-256) |
| **ECDH** | Key Agreement | Diffie-Hellman P-256 exchange |
| **HKDF** | Key Derivation | SHA-256 HMAC-based KDF |
| **AES-128-GCM** | Payload Encryption | Symmetric encryption of the push body |

---

## 🔒 The Encryption Ritual (RFC 8291)

To send an encrypted message that only the recipient's browser can decrypt, the following flow is executed in `supabase/functions/push-notify/index.ts`:

1.  **Ephemeral Key Generation:** The server generates a one-time ECDH P-256 key pair for the message.
2.  **Shared Secret:** We compute the shared secret using the server's private key and the client's `p256dh` public key.
3.  **Authentication Secret:** We mix the shared secret with the browser's provided `auth` secret using HKDF to generate a **PRK (Pseudorandom Key)**.
4.  **CEK & Nonce Derivation:** We derive the **CEK (Content Encryption Key)** and **Nonce** using context-specific info strings.
5.  **GCM Encryption:** The JSON payload is padded (2-byte padding) and encrypted using AES-128-GCM.

### Zero-Dependency VAPID Signing
Traditional JWT libraries are ignored in favor of manual base64url encoding and `crypto.subtle.sign`. To handle private keys, the project includes a custom **PKCS#8 DER envelope wrapper** that allows importing raw 32-byte P-256 keys into the Web Crypto engine.

```typescript
// Internal buffer wrapping for P-256 PKCS#8 compatibility
function wrapP256KeyInPKCS8(rawKey: Uint8Array): ArrayBuffer {
  const header = new Uint8Array([0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, ...]); 
  // ... (Full DER header implementation)
}
```

---

## 🚀 Efficient Notification Fan-out

When a new appointment is booked via WhatsApp, the following happens:

1.  **Database Webhook:** PostgreSQL triggers an asynchronous call to the `push-notify` Edge Function.
2.  **Tenant Resolution:** The function identifies the `business_id` and fetches all active subscriptions from `notification_subscriptions`.
3.  **Parallel Dispatch:** Messages are encrypted and sent in parallel to Google (FCM), Apple (APNs), or Mozilla push services via `Promise.allSettled`.
4.  **Automatic Cleanup:** Responses with HTTP **410 (Gone)** or **404 (Not Found)** automatically trigger an asynchronous database purge of the stale subscription.

---

## 🔐 Multi-Tenant Security & Hardening (2026-05-21)

### RLS Policy Tightening

The `notification_subscriptions` table uses Row-Level Security (RLS) to prevent cross-tenant writes. As of migration **20260521010000**, INSERT and UPDATE policies require strict business context validation:

```sql
-- INSERT policy: user can only create subscriptions for their own business
CREATE POLICY "notif_subs_insert_own"
  ON public.notification_subscriptions FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND business_id = (SELECT business_id FROM public.users WHERE id = auth.uid())
  );

-- UPDATE policy: user can only modify their own subscriptions
CREATE POLICY "notif_subs_update_own"
  ON public.notification_subscriptions FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND business_id = (SELECT business_id FROM public.users WHERE id = auth.uid())
  );
```

**Why stricter?** Previously, users could potentially update `business_id` to a different tenant's ID. The new policy fetches the authoritative business context from the `users` table at every write, closing the cross-tenant vulnerability.

### Imminent-Appointment Notifications (`cron-imminent-push`)

A new cron job runs **every 15 minutes** (migration **20260519010000**) to push a single notification to business owners about appointments scheduled within 45–75 minutes:

| Component | Details |
|---|---|
| **Schedule** | `*/15 * * * *` via `pg_cron` |
| **Endpoint** | `POST https://<supabase>.supabase.co/functions/v1/cron-imminent-push` |
| **Auth** | Bearer token from Supabase Vault (env: `cron_secret`) — never in source code |
| **Payload** | Empty `{}` (timestamp managed server-side) |
| **Idempotency** | Partial UNIQUE index `uq_reminder_imminent_owner` prevents duplicate sentinel rows |

### DB-Level Idempotency Protection

The `appointment_reminders` table now includes a partial unique constraint:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_reminder_imminent_owner
  ON public.appointment_reminders (appointment_id)
  WHERE channel = 'push_owner';
```

**Why this matters:** If two cron executions overlap (e.g., at 3:00 PM due to slow processing at 2:45 PM), the second INSERT on the sentinel row fails with a constraint violation, which the function handles gracefully. The database enforces idempotency at the constraint level, eliminating race conditions without application-level locks.

---

## 📖 Key Standards Reference
- **RFC 8030:** Generic Event Delivery Using HTTP Push.
- **RFC 8291:** Message Encryption for Web Push.
- **VAPID:** Voluntary Application Server Identification for Web Push.

---
*Documentation updated 2026-05-21 with push notification hardening details.*
