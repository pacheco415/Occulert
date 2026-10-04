# Automated accessibility checks

Run `npm run test:accessibility` after installing the locked development dependencies and Playwright browsers. The ordinary browser suite includes these cases as well.

The check visits 24 public pages signed out, at a 390 × 844 viewport, in Chromium and WebKit with both dark and light preferences. Some pages intentionally use their own fixed theme; reports record both the requested preference and the actual document theme. Each page must finish loading its styles and fonts, and finite theme animations must settle before inspection. A visible heading alone does not establish that styles have loaded, particularly in WebKit.

Focused control cases also measure contrast from actual opaque computed colors on the dashboard select and safety legal panel, check selected target sizes and keyboard focus, operate the real reporting control, toggle the account theme by keyboard and activate footer navigation and hub disclosures. Gradient-backed text and actual touch behavior still need manual inspection.

Pinned axe-core checks WCAG 2 A/AA, 2.1 AA and 2.2 AA rules without exclusions or disabled rules. Each case writes an accessibility-report.json attachment with violations and checks requiring manual review. Report attachments are available with the browser test artifacts.

These checks do not establish complete WCAG conformance. Keyboard navigation, screen readers, actual touch devices, signed-in fleet and driver states, zoom, and live camera or alert behavior require separate review. WebKit automation is not physical Safari device validation.

The accompanying stylesheet releases improve low-contrast secondary text, badges and links, and enlarge selected navigation and form targets. Account and legal text remain unchanged. Published stylesheet versions remain available under the release retention policy.
