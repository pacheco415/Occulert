# Occulert Firebase security checklist

Occulert can run fully in local-only mode. Enable Firebase cloud sync only after these items are configured.

## Recommended production structure

Use fleet-scoped collections instead of global public collections:

```text
fleets/{fleetId}/liveSessions/{driverId}
fleets/{fleetId}/sessionHistory/{sessionId}
fleets/{fleetId}/pilotLeads/{leadId}
```

## Minimum rules direction

Do not leave Firestore open to public read/write. A safe production version should require Firebase Auth and verify that the signed-in user belongs to the fleet they are reading or writing.

Example direction only, not a full production ruleset:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    match /fleets/{fleetId}/liveSessions/{driverId} {
      allow read, write: if signedIn() && request.auth.token.fleetId == fleetId;
    }

    match /fleets/{fleetId}/sessionHistory/{sessionId} {
      allow read, write: if signedIn() && request.auth.token.fleetId == fleetId;
    }

    match /fleets/{fleetId}/pilotLeads/{leadId} {
      allow create: if true;
      allow read, update, delete: if signedIn() && request.auth.token.fleetId == fleetId;
    }
  }
}
```

## Current app behavior

- Camera processing is intended to stay on-device.
- GPS is opt-in per driver session.
- Cloud sync is opt-in per driver session.
- If cloud sync is off or Firebase is unavailable, the app uses browser localStorage.

## Before using with real drivers

- Add Firebase Auth.
- Scope every driver/session to a fleet or account.
- Publish a driver consent policy.
- Add a delete/export data flow.
- Confirm insurance, employment, labor, and privacy compliance for your location and use case.
