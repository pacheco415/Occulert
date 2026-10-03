# Native saved history format

New writes use a JSON document with `schemaVersion: 1` and a `sessions` array. Partial record objects and unknown record or document fields are preserved. Stable session IDs still identify local records only; they confer no cloud authority.

An existing array is a legacy document. The ordered history queue validates it, assigns any missing IDs, and commits its versioned replacement before exposing the migrated records. A failed write leaves the original bytes intact and reports failure. Later reads of an already migrated document do not rewrite it. A missing storage key is empty history; unreadable data, malformed members, and unsupported future document versions refuse both reads and updates.

Older app versions that only understand arrays cannot display the new envelope. Their fail-closed history parser preserves it rather than overwriting it. Avoid downgrading a device after migration. User-requested Clear History remains an explicit deletion.

The browser uses separate localStorage and is not migrated by this native change. This format change does not claim a complete cross-platform history migration.

Completed sessions with no scored camera samples now store an unknown average and send unknown average, maximum and safety score to the cloud. A recorded zero remains zero. Native candidate head-nod observations are not a validated cloud head-nod count; that field is unknown rather than a fabricated zero. Existing saved records are preserved, not retrospectively reclassified. These changes affect reporting, not detector thresholds or alert behavior.
