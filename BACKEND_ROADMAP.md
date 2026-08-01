# Occulert Backend Roadmap

The current app-to-dashboard sync uses browser localStorage. That is good for a prototype, but real fleet operations need a backend.

## Current implementation

- Signed-in drivers can opt into protected session and event writes through the
  Supabase-backed API; localStorage remains the fallback.
- Verified fleet owners can read their server-scoped roster and recent sessions.
- Protected fleet history includes recent alert events without GPS coordinates,
  personal media, or raw motion.
- The dashboard keeps local demo and same-browser fallback data separate from
  authenticated fleet data.

## Next production upgrade

Verify the protected fleet history in the deployed environment, then add
manager reporting workflows without weakening driver consent or ownership
checks.

Recommended stack options:

1. Firebase
   - Fastest for MVP
   - Auth, database, hosting, realtime updates

2. Supabase
   - Good open-source style option
   - Postgres database, auth, realtime channels

3. Custom Node/Express API
   - More control
   - More maintenance

## Data tables needed

### fleets
- id
- company_name
- owner_user_id
- plan
- created_at

### drivers
- id
- fleet_id
- name
- email
- vehicle_id
- active
- created_at

### sessions
- id
- driver_id
- fleet_id
- started_at
- ended_at
- average_fatigue
- max_fatigue
- safety_score
- alert_count
- head_nod_count
- device
- browser

### events
- id
- session_id
- type
- fatigue_score
- confidence
- latitude
- longitude
- created_at

## Privacy requirements

- Do not upload live camera video unless a future policy explicitly supports it.
- Store fatigue scores and event metadata, not raw face video.
- Ask permission before collecting GPS.
- Make fleet use transparent to drivers.

## Immediate implementation order

1. Add backend account system.
2. Add driver login or driver code.
3. Save sessions to database.
4. Show realtime fleet dashboard updates.
5. Add exportable reports for fleet managers.
