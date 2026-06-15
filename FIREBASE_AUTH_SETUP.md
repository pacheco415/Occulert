# Occulert Firebase Authentication Setup

The current login.html page is a prototype access gate. It is useful for demos, but it is not final enterprise security.

## Production login plan

Use Firebase Authentication for:

- Occulert admin login
- Fleet manager login
- Driver login or driver access codes
- Company/fleet role separation

## Recommended first auth method

Enable Email/Password authentication first.

Firebase Console steps:

1. Open Firebase Console
2. Select Occulert
3. Go to Build > Authentication
4. Click Get started
5. Open Sign-in method
6. Enable Email/Password
7. Add your own admin user

## Firestore security rules after auth

Future rules should change from public prototype writes to authenticated role-based access.

Suggested collections:

- users
- fleets
- drivers
- liveSessions
- sessionHistory
- pilotLeads

## Role examples

admin:
- can view all fleets
- can manage all data

fleetManager:
- can view their own fleet only
- can view drivers assigned to their fleet

driver:
- can write their own live session
- can view their own history

## Why this matters

Before selling to fleets, the dashboard must be private. Companies will expect login, driver permissions, and separate company data.
