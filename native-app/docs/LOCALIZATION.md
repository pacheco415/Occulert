# Native localization

## Released behavior

`lib/strings.ts` selects the complete, reviewed catalog for the device language when the app starts. English is the fallback and the only approved language today.
Home, Monitor, History, Settings and Pre-drive, their supporting presentation
components, camera messages, cloud-account messages and navigation use that
catalog. The extraction preserves released English, alert wording, consent
boundaries, recovery guidance and rendered/accessibility text. Existing date
and number formatting stays at its original call site. History share output
remains unchanged in English.

Persisted identifiers, API payload fields, error codes, hardware values, user
names, Maps queries and saved record values are not translation keys. The
formatter substitutes named values once; text inside a supplied value is never
interpreted as another template. Four English fragments intentionally retain a
leading space because they join an existing sentence. Their exact values are
covered by the string tests.

## Catalog structure

| Domain | English leaves | Source |
| --- | ---: | --- |
| Home | 34 | `lib/strings.ts` |
| Navigation and simulator banner | 6 | `lib/strings.ts` |
| Monitor | 136 | `lib/strings/monitor.ts` |
| History | 349 | `lib/strings/history.ts` |
| Settings | 293 | `lib/strings/settings.ts` |
| Pre-drive | 145 | `lib/strings/settings.ts` |
| Total | 963 | Typed `StringCatalog` shape |

`lib/strings/format.ts` provides typed named placeholders. Missing, extra or
unsupported values throw rather than rendering a partially formatted message.
When moving a JavaScript template literal, preserve its original `String()`
coercion at the call site. When moving JSX, preserve its original handling of
missing values. Do not use the string layer to normalize stored data or change
existing fallback behavior.

`lib/strings/locales.ts` combines explicit draft entries for the same language
codes as `src/driver-i18n.js`: English, Spanish, French, Portuguese, German,
Arabic, Chinese and Japanese (`en`, `es`, `fr`, `pt`, `de`, `ar`, `zh`, `ja`).
Every non-English draft explicitly covers all 963 paths, for 6,741 entries in
total. Draft assembly has no English fallback for missing keys. Brand names,
technical tokens, some units and natural cognates can intentionally match
English; `nativeCatalogCoverage()` lists these identical entries for review.

These are generated translation drafts, not evidence of fluent human review.
The native drafts are separate from the web catalog: matching locale codes
does not imply the web wording has reviewed or approved native-only copy.

## Hidden language gate

All seven non-English languages have `reviewed: false` with no reviewer or
review date. Only English appears in `availableNativeLocales`.
`resolveNativeCatalog()` returns English for an unknown, malformed or
unreviewed language request. Completeness and placeholder checks cannot approve
a language; availability also requires an explicit reviewed flag, reviewer
and date.

The app reads the first preferred iOS language or the Android app configuration
locale at startup. If native settings are unavailable, it uses the system
formatting locale. Regional tags such as `es-MX` select a primary language. An
unreviewed preference uses English and left-to-right layout. The English path
does not initialize the draft dictionaries. For a reviewed language the
loader validates the selected catalog against English. Invalid catalogs fall
back to English and its layout direction together. A reviewed Arabic catalog
uses right-to-left layout on the root view and stack content. Settings states
that spoken cues are in English. The app does not persist a language override.

## Review before enabling a language

A fluent speaker must review the complete native catalog, with particular care
for safety and fatigue warnings, camera failures, foreground loss, interrupted
drive recovery, all four pre-drive acknowledgments, deletion, cloud consent,
sign-out persistence, Health limitations and emergency-feature limitations.
Preserve the distinction between a software result and whether a person heard
or felt an alert. Do not strengthen safety claims or weaken a required stop,
rest, parking or consent instruction.

Record the reviewer, date and reviewed source revision. Check language-specific
grammar around counts, dates, technical values and named placeholders, including
intentional English-identical entries. Human review must also cover rendered
screens, large text, VoiceOver labels, wrapping and long translated messages on
supported devices. Arabic needs explicit RTL and mixed-direction assessment
before any future activation change. None of those acceptance checks is claimed
by this source extraction or by passing automated tests.

After fluent and device review, update that language in `lib/strings/language.ts`
with `reviewed: true`, the reviewer and the review date. On the next app launch
the corresponding device language can select it. Spanish is the first draft
planned for review.

## Verification

Run `npm run test:strings` and `npm run verify` from `native-app`. The string
suite checks every registered screen/component/helper, exact language coverage,
all catalog keys, placeholder parity, invalid catalog trees, one-pass
substitution, the device-language review gate and exact released safety contracts. Large-text
monitor fixtures also exercise Arabic draft controls in right-to-left layout.
Existing History interaction/export, Monitor, setup, audio, cloud-account and
site-audit tests continue to exercise the real English catalog.

Automated checks establish source and runtime contracts. They do not establish
fluent review, physical-device acceptance or store-release readiness.

## Translation review packet

Start with Spanish. From `native-app` on Node 24, install the locked development
dependencies and export to a new directory whose parent exists.

```sh
npm ci --include=dev
node scripts/export-review-packet.mjs es ../spanish-review
```

Give the reviewer `review.csv` and `review.html`. The HTML page prints in
landscape with a space for handwritten corrections. The CSV contains the
locale, key, screen, English text and current draft. The priority column flags
alert, consent, recovery and pre-drive wording. Review every row, including
entries whose English and draft match.

Open the UTF-8 CSV with all columns set to text. Edit only **correction**. Enter
the entire replacement, including named placeholders, intentional spaces and
line breaks. Leave the cell empty to keep the draft. Save the complete CSV,
preserving its columns. Import the corrections in the same checkout.

```sh
node scripts/import-review-corrections.mjs es ../spanish-review/review.csv
npm run test:strings
```

The importer checks all rows against the current locale, English and draft
text and validates every placeholder before editing draft sources. If the
source has changed, export to a new directory and reconcile the affected
rows. Review the Git diff. The original reviewer and device checks above
still apply before enabling the language.
