# Browser History cloud outcomes

Local history and cloud summaries remain separate. For the current signed-in account, History reads the validated pending-summary queue without contacting the backend. A matching queued local record says “Cloud summary pending”; a saved acknowledgement with both cloud session and owner identity says “Cloud summary confirmed”. Other records say that cloud completion is not confirmed. A missing acknowledgement does not prove the server did not save the summary.

Retry is deliberate. The page starts with retry permission off, and checking it does not send anything. The Retry button sends only that owner's previously queued summary totals and original finish times, using the existing immutable session finalization API. Requests remain single-flight and tied to the current credentials, owner and permission revision. A revoked permission, account change or page exit invalidates late acknowledgements. Turning permission off removes that owner's pending queue when storage permits; a deletion failure is visible and sending remains off.

The queue snapshot is copied; unreadable bytes are preserved. Confirmed cloud writes can remove their retry entry even if their local record was explicitly deleted or its local confirmation cannot be saved. No unreadable history is overwritten to create a badge. This does not start sessions, infer a successful cloud start, automatically upload on opening History or send GPS, personal media or raw motion.

This change includes the browser history migration and truthful value formatting originally prepared in #228 and #234. Local browser checks cover these composed sources; deployed preview validation remains a separate release check.

A matching session ID is not enough to acknowledge completion: the response must confirm ok=true and include a valid stored end timestamp. Empty or open-session responses retain the original pending summary. PostgREST UTC offsets and microsecond precision are supported. This is reporting validation; it does not retry session creation.

A request already initiated cannot be made unsent by revoking permission. Tests cover actual page navigation and account changes during a held request, plus storage failures; they do not claim cancellation during an internal token refresh or transactional storage across tabs. Repeat-safe session creation is a separate, default-off server capability. This History flow neither consumes that capability nor recovers a lost session-start response.

Retained credential-bearing backend scripts, including older History/outbox versions, remain network-only. Service-worker browser cases model an older page requesting a retained URL, seed a cached script marker, and stall the origin response; the retained page must finish detector startup without executing the cached marker.

The monitor and deliberate History retry handle local acknowledgment-write failure differently. The monitor keeps a confirmed summary queued if the strict local keyed update fails, including when another tab deleted its local copy; it may report a pending outcome even though the server already stored the totals. History retry can acknowledge the stored ended row and clear that queue entry without recreating the local copy. Retrying finalization is idempotent.
