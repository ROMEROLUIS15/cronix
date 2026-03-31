# Architecture Decision Record (ADR): WhatsApp Opt-in Verification Flow

## Context and Problem
The Cronix platform (via its integrated AI assistant) proactively notifies business owners whenever a client successfully books an appointment through the centralized Bot.
The primary challenge is **how to securely capture, validate, and utilize the business owner's personal phone number** to send these notifications.

Implementing a manual entry form (from the Dashboard) without subsequent verification would expose the platform to three critical risks:

1. **Meta Block Risk:** Sending template messages (HSMs) or session messages to numbers that have not explicitly opted in to communicate with the bot violates the *Opt-in* WhatsApp Business Policy. This could trigger a permanent ban on the platform's WhatsApp Business Account (WABA).
2. **Data Breach (Privacy Risk):** A malicious or accidental typo by a business owner configuring their number could result in customers' personal data (name, appointment date, booked service) being automatically sent to an unknown third party on the WhatsApp network.
3. **Hidden Costs (Meta API Pricing):** Notifications that initiate a new "Message Window" (when the bot cold-messages a user) incur charges under the *Authentication* or *Utility* message category.

## Adopted Solution
The architecture team decided to implement a **User-Initiated Conversation (Opt-in by Inversion of Flow)** validation, colloquially known as `Zero-Latency Webhook Intercept`.

### Operation
Instead of capturing the number and sending an OTP code:
1. The platform displays a strategic "Deep-Link" button (`wa.me/...?text=VINCULAR-{slug}`) in the Admin Notifications section of the Dashboard.
2. The business owner clicks this button on their device, which directly opens WhatsApp with a **pre-written, exact, and unique code** targeted for their business (e.g., `VINCULAR-igm`).
3. By sending this message, the end user is "initiating" the conversation (`user-initiated`).
4. The main platform Webhook (`index.ts`) intercepts the reserved keyword `VINCULAR-` the millisecond it receives the request payload from Meta.
5. The Webhook securely and definitively links the actual sender's number (`sender_phone`) to the internal database (`businesses` table) as the authorized number to receive business notifications (`wa_verified = true`).
6. The system immediately returns the ACK to Meta along with a confirmation message to the owner, **without processing the string through LLMs like Groq/Llama**, preserving latency at the millisecond layer and reducing unnecessary third-party invocation costs.

## Satisfied Criteria
* **Prevents WABA Blocks:** Guarantees that the end user proactively initiates contact (achieving 100% compliance with WABA Terms of Service regarding Opt-ins).
* **Data Security:** The cryptographic association between the Meta ID and the Cronix DB eliminates the possibility of leaking booking data to secondary or hijacked numbers.
* **Separation of Concerns (UI/UX):** The interface diametrically separates the "Proactive Notifications from WABA to the Owner" card from the "Reminders from the Owner to their Clients" card.

## Consequences and Maintainability
* Using `business.slug` as the primary cryptographic key to associate the business is secure because the link is generated exclusively within the protected Next.js session.
* *Trade-off*: If a user does not have the WhatsApp app active on the device where they are browsing the Dashboard, they must scan the QR code to open WhatsApp Web beforehand or do it directly from their mobile device. We consider this a valid sacrifice prioritizing global platform security.
