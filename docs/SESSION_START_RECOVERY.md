# Repeat-safe cloud start contract

POST /api/sessions accepts an optional client UUID and returns only a row owned by the verified driver. Repeated or concurrent requests preserve the original row; UUID conflicts with another owner are rejected. No new migration is needed.

GET /api/sessions?session_id=<UUID> is an authenticated, uncached, read-only lookup. It returns the existing owned session or null, never creates a replacement and never reveals a foreign driver row. The response identifies client_uuid_lookup_v1. Use this lookup to resolve a lost POST response without blindly retrying creation.

Public configuration advertises client_uuid_v1 and client_uuid_lookup_v1 only when public authentication and server session storage are configured and SESSION_START_RECOVERY_ENABLED=true. The gate defaults off. Enable it only after the deployed create and lookup contracts pass the live owner-isolation preview. Existing clients remain supported.

Client recovery must persist the UUID and local record identity before the first POST, bind them to account and consent revision, refuse unknown capability or mismatched acknowledgement, and clear pending work on sign-out/revocation. A deliberate lookup may associate an owned existing start; a missing row does not authorize creating a second drive. Finalize only from a recorded original completion time and validated saved metrics, using immutable session completion. Preserve uncertain or unreadable local data instead of inventing a timestamp or dropping an attempt on queue overflow.

Client UI and durable attempt storage remain separate integration work. No automatic start retries or production capability activation are introduced by this server change.
