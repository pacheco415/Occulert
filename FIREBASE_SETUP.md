# Firebase Setup for Occulert

This is the recommended next step for making Occulert work across multiple devices.

## Why Firebase

The current prototype stores app, dashboard, driver, and history data in browser localStorage. That works only on the same device/browser. Firebase can make the fleet dashboard update from real driver phones.

## What Firebase would power

- Fleet manager login
- Driver login or driver code
- Realtime dashboard updates
- Session history across devices
- Pilot signup storage
- Driver profiles
- Alert events
- GPS location with permission

## Data collections

### fleets
```json
{
  "companyName": "Example Fleet",
  "ownerUserId": "user_123",
  "createdAt": "timestamp"
}
```

### drivers
```json
{
  "fleetId": "fleet_123",
  "name": "Richard P.",
  "vehicleId": "Truck 12",
  "active": true
}
```

### liveSessions
```json
{
  "driverId": "driver_123",
  "fleetId": "fleet_123",
  "status": "WATCH",
  "fatigue": 42,
  "confidence": 91,
  "alerts": 0,
  "headNods": 1,
  "safetyScore": 88,
  "lat": null,
  "lng": null,
  "updatedAt": "timestamp"
}
```

### sessionHistory
```json
{
  "driverId": "driver_123",
  "fleetId": "fleet_123",
  "startedAt": "timestamp",
  "endedAt": "timestamp",
  "averageFatigue": 18,
  "maxFatigue": 71,
  "safetyScore": 82,
  "alertCount": 1,
  "headNodCount": 2
}
```

### pilotLeads
```json
{
  "name": "Fleet Owner",
  "company": "Example Delivery Co.",
  "email": "owner@example.com",
  "fleetSize": "6-25 vehicles",
  "message": "Interested in pilot",
  "createdAt": "timestamp"
}
```

## Setup steps

1. Create a Firebase project.
2. Enable Firestore Database.
3. Enable Authentication with email/password or Google sign-in.
4. Create a web app inside Firebase.
5. Copy the Firebase config object.
6. Add the config to an Occulert config file.
7. Replace localStorage writes with Firestore writes.
8. Replace fleet dashboard localStorage reads with Firestore realtime listeners.

## Security rules concept

- Fleet owners can read/write their own fleet.
- Drivers can write their own live session.
- Drivers cannot read other drivers unless permitted.
- Pilot leads can be created publicly but only read by admin.

## Privacy direction

Occulert should store safety metadata, not raw camera video. GPS should require permission and be optional.
