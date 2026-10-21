# Compact browser driver view

Implemented source, October 20, 2026. This adapts the existing browser driver
screen to narrow and short viewports; release and production evidence belong in
[Status](STATUS.md).

## Behavior

At widths up to 820 CSS pixels or heights up to 500 CSS pixels, parked setup
uses normal document flow: the camera and control panel do not overlap, and
navigation and setup remain reachable by scrolling. The parked header retains
its 74-pixel minimum height.

During preparation and monitoring, Stop/Start occupies a fixed row above the
scrollable monitoring state and guidance. The camera keeps its own visible
area; landscape viewports at least 560 pixels wide and at most 500 pixels high
use camera and control columns. Session time, safety notice and other secondary
details have a separate scroll region. Oversized state and warning text wraps
and scrolls rather than being replaced with an ellipsis. The alert overlay stays
within the camera area and leaves Stop available.

Parked setup, navigation and brightness changes stay unavailable during
preparation and monitoring. The preparation state explicitly says monitoring
has not started. Phase changes reset panel scroll positions; focus moves to the
status card when its previous setup control becomes hidden. Startup recovery
and Reload remain outside the disabled monitoring fieldset.

Keyboard users can Tab from Stop into the named “Monitoring status and guidance”
and “Session details and safety notice” regions, then scroll with keyboard
navigation. Camera guidance and alert overlays also expose named keyboard
scroll targets. Stopped-reason recovery focuses and brings the status card into view.
Foreground loss or camera disconnection stops monitoring; restarting remains a
deliberate action taken while safely parked.

## Browser evidence

[The compact layout tests](../tests/driver-compact-layout.spec.mjs) passed all
24 focused cases across Chromium and WebKit. Repository verification passed
all 88 checks. The full browser suite and required hosted checks remain separate
release gates.

| Case | Viewports in CSS pixels | Assertions |
|---|---|---|
| Portrait | 313 × 890, 320 × 568, 390 × 844, 445 × 626 | No horizontal overflow or camera/panel overlap; visible state; usable Stop after internal scrolling; parked setup restored after stop. |
| Short landscape | 568 × 320, 844 × 390 | Visible camera and state; unobstructed Stop; recovery remains reachable. |
| Large text | 320 × 568, 568 × 320 at 200% root text size | Full status/guidance can scroll; Stop remains usable; the production alert visual path stays within the camera area. |
| Lifecycle and keyboard | 313 × 626, 320 × 568, 568 × 320 | Focus transfer during preparation; foreground cancellation before capture; visible disconnect guidance; no automatic camera restart; keyboard scrolling in both named regions. |

The tests run the real browser lifecycle with software camera/model adapters.
They establish layout and recovery behavior, not physical-camera operation,
detection accuracy, audio delivery, or acceptance on a particular phone or
tablet. Native builds, dual-camera support and multitasking camera access require
their own implementation and device evidence.

## Size and release boundaries

The new driver stylesheet is 22,188 raw bytes, versus 15,776 for the previous
version; gzip measures 5,427 bytes (about 5.4 KB). Its raw size budget deliberately
increases to 23,000 bytes. The static install-cache cap increases from 330,000 to
338,000 bytes to cover the measured 336,848-byte asset set (about 336.7 KB). These
limits retain bounded headroom; the driver JavaScript budget stays at 90,000
bytes. The separately loaded detector runtime is outside this static asset sum.

Published asset bytes remain immutable. Follow [the release guide](../RELEASING.md)
for versioned outputs, integrity pins, cache identity and required pull-request
and resulting-main checks.
