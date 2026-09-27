# Support and release preparation

Prepared September 26, 2026. All testing remains deferred at the user's request.
This package is source preparation; it is separate from the published history
release in PR #147 and installed TestFlight 1.0.0 (52).

`support.html` supplies public camera and interruption guidance, phone/Watch
alert help, local/cloud history boundaries, fleet-access help and contact
details. Home, Privacy and Pilot Quick Start link to it, and the sitemap lists
its canonical URL. It reuses existing immutable styles without changing their
bytes. It has no JavaScript, login, contact form, uploads, analytics or backend
request. Email opens the user's email application and does not send automatically.

The native Settings screen adds Help and support under Pilot Support. It opens
`https://www.occulert.com/support.html` without account details or diagnostics.
Browser-launch failures show a manual Safari/email fallback. Installed build
52 does not contain this link; native distribution requires a future binary.
Publish the page before distributing a binary that includes the link.

The App Store draft can use this dedicated support URL after publication.
Actual selected-binary screenshots, reviewer details and final submission
remain separate tasks. No screenshots, credentials or acceptance results are
invented, and no App Store upload or outreach has been performed.

Source review is distinct from runtime checks. No tests, type checks, browser
or device checks, native builds or database changes were performed for this
package. Per-commit skip markers can preserve the user's testing instruction
when publishing the branch, without changing ordinary workflow settings.
