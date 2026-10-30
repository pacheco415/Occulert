# Browser saved history

Browser history remains an array under `occulert-session-history`, compatible with existing read-only dashboard views and retained app assets. Each migrated record carries `historyVersion: 1` and a stable `localRecordId`. Existing IDs, cloud references, partial measurements and unknown fields are retained. Local record IDs never confer cloud authority.

The shared local-history helper validates the entire document before replacing it. Malformed JSON, non-object members, unsupported record versions and invalid explicit local identities refuse reads and writes; they are not filtered into an apparently clean replacement. A legacy migration commits before returning its new IDs. Storage failure leaves the original bytes in place. Repeated reads do not rewrite a migrated document. Existing duplicate aliases remain intact, and an edit matching more than one record fails rather than changing both.

The driver uses the helper for identity migration, saving completed sessions, local feedback and confirmed cloud badges. The History page discloses unavailable storage and preserves it. A normal new-session save still retains the existing 50-record limit. Explicit Clear History remains a user-requested deletion.

Older retained app scripts do not enforce this new validation policy. The new array format avoids breaking their readers; this change does not retroactively make old writers fail closed. Cross-tab read/write sequences are not database transactions. Native AsyncStorage uses its separate versioned envelope.
