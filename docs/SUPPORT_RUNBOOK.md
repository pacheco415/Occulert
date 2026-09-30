# Occulert support runbook

Prepared September 27, 2026 for a one-person prototype operation. Public
instructions live at [Help and Support](../support.html). This runbook is an
internal procedure; it does not promise a response time or emergency service.

## Intake

Use hello@occulert.com for product support and fleet@occulert.com for
pilot/commercial coordination. Keep the support log restricted to the owner.
Record: date, case ID, reply address, platform/build, device/OS, issue category,
symptoms, safe reproduction steps, whether monitoring was stopped, next action,
owner, status, and closure date. Collect only what is needed to solve the case.

Ask people **not** to send passwords, codes, face images, camera video, audio,
precise location, Health records, or raw private fleet exports. Redact names
and account details from screenshots before storing them. Never paste
invitation links or access tokens into a ticket.

## Triage

| Priority | Example | First action |
|---|---|---|
| Urgent product safety issue | Monitoring appears active when camera analysis stopped; alert routing repeatedly fails under tested conditions | Tell the user to stop relying on this monitoring path, park safely, and follow normal rest/safety policy. Reproduce on a parked device; mark affected release/build. |
| Access or privacy issue | Wrong-fleet record appears, deletion fails, invitation is exposed | Limit access if a safe containment action exists; preserve a minimal technical record; verify server authorization and data scope before replying. |
| Blocking setup issue | Account, camera permission, invitation or sync prevents intended pilot use | Give the specific parked recovery steps; record whether local history is at risk before suggesting resets. |
| General feedback | Confusing report, copy, feature request | Record expected behavior and link to the product backlog. |

Support is not an emergency line. For an immediate road hazard, the driver
must use their normal emergency and safe-stop process.

## Diagnostic questions by category

- **Camera or lifecycle:** exact platform/build, permission state, phone
  orientation and mount, foreground/screen state, lighting, visible status,
  approximate time, and whether the app recovered while parked.
- **Alert delivery:** whether sound, vibration or Watch notification was
  actually perceived; audio route, Focus/mute, phone and Watch state. A
  delivery acknowledgment alone is not perception.
- **Fleet:** owner or driver role, invitation state, voluntary sync setting,
  report generation time/window, and whether the report says full coverage.
  Do not assume a missing record means no drive or no fatigue.
- **Billing (when activated):** plan, invoice ID, effective date and
  customer-visible state. Never ask for full card data.
- **Data requests:** distinguish local deletion from cloud/account deletion,
  verify requester authority, record what was deleted and when, and follow
  the published privacy process.

## Work the case

1. Confirm receipt manually and provide a case ID; do not claim an SLA that
   has not been staffed and funded.
2. Reproduce with synthetic data or a parked test device. Keep production
   contact data out of development fixtures and logs.
3. Identify whether the issue affects one device, a build, or all fleets.
   For safety/privacy issues, consider pausing the affected feature or
   enrollment until a fix is checked.
4. Write down the fix, release identifier, and checks performed. Test the
   actual distributed build or deployed site before calling it resolved.
5. Reply with concrete recovery steps, known limits, and whether a driver or
   manager needs to act. Mark the case closed only after confirmation or a
   documented follow-up attempt.
6. Review case counts and support minutes weekly. Feed recurring issues and
   true support cost into [unit economics](UNIT_ECONOMICS.md).

Before taking paid customers, set a realistic response target, coverage
hours, and escalation owner in the written service terms. Automate only
receipt, status and safe diagnostics once those workflows are reliable.
