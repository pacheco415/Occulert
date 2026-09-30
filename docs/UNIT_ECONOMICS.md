# Occulert fleet unit economics worksheet

Prepared September 27, 2026. This is a decision worksheet, not a revenue
forecast. No customer count, paid commitment, operating cost, or conversion
rate has been verified for this project. Enter actual monthly numbers before
deciding that a price can support the business.

## Current published proposal

| Plan | Proposed monthly price | Proposed roster size | Gross at 10 fleets | Gross at 40 fleets |
|---|---:|---:|---:|---:|
| Starter | $9 | Up to 10 active drivers | $90 | $360 |
| Growth | $25 | Up to 30 active drivers | $250 | $1,000 |
| Custom | Agreed separately | Agreed separately | — | — |

These figures are **gross revenue before any expense, refund, tax, or owner
pay**. At full roster size, Starter is $0.90 per driver per month and Growth
is about $0.83. Those ratios make support time and infrastructure usage
important pricing inputs. The website does not yet collect payment, enforce
paid limits, or activate subscriptions.

## Provisional price test before billing

The $9/$25 proposal is unlikely to fund hands-on support at small scale. As
of September 27, 2026, [Stripe's published US domestic-card rate](https://stripe.com/pricing)
is 2.9% + $0.30 per successful transaction. That leaves about $8.44 from a
$9 charge and $23.98 from a $25 charge, before other expenses. At an
**illustrative** $30/hour value for owner time, those amounts pay for only
about 17 and 48 minutes of support respectively. The public starting prices
for [Supabase Pro](https://supabase.com/pricing) and
[Vercel Pro](https://vercel.com/pricing) are $25 and $20 per month, with usage
charges possible. These are vendor list prices, not verified Occulert bills.

Test **$59/month for up to 10 drivers** and **$149/month for up to 30 drivers**
with the first qualified fleets, keeping the 30-day trial free. This is a
price-discovery hypothesis, not a validated market rate or a change to the
current public proposal. Before live billing, use actual pilot support minutes,
provider invoices and written paid commitments to set the final prices. If
fleets will not pay enough to cover contribution and an owner draw, improve
the offer or narrow support scope before activating subscriptions.

## Fill in the actual monthly inputs

| Input | Amount to enter | Where to verify it |
|---|---:|---|
| Hosting and CDN | $____ | Provider invoice, normalized to a month |
| Database, storage and bandwidth | $____ | Provider invoice and usage by fleet |
| Error monitoring and support tools | $____ | Provider invoice |
| Domain, email and other fixed tools | $____ | Provider invoices divided by 12 for annual charges |
| Payment processor percentage | ____% | Selected provider's actual agreement |
| Payment processor fixed fee per charge | $____ | Selected provider's actual agreement |
| Refunds and chargebacks | $____ | Actual transaction records |
| Support minutes per fleet per month | ____ | Time log, including onboarding and incident follow-up |
| Owner hourly compensation target | $____ | Owner decision |
| Paid fleets by plan | Starter ____ / Growth ____ | Billing system, after activation |
| Monthly churn | ____% | Paid cohort history after several months |

Record one-time build, legal, and research costs separately. Do not hide
recurring support work inside a one-time setup estimate.

## Calculate monthly viability

1. **Gross monthly revenue** = $9 × Starter fleets + $25 × Growth fleets +
   agreed Custom revenue.
2. **Payment cost** = sum of each successful charge × the actual processor
   percentage, plus fixed fees, refunds and chargebacks.
3. **Support labor** = total support minutes ÷ 60 × the owner hourly target.
4. **Operating surplus before owner pay** = gross revenue − payment cost −
   hosting − database/bandwidth − tools − support labor at its replacement
   cost.
5. **Self-sufficiency gap** = operating surplus − desired owner draw for work
   **other than support hours already counted** − a maintenance/recovery
   reserve. A positive month alone does not prove sustainability; track this
   for at least three consecutive paid months and check whether support time
   is rising.
6. **Fleet contribution** for a plan = plan price − payment cost for that
   charge − estimated per-fleet infrastructure − estimated support labor.
   If this is zero or negative, adding fleets at that price does not solve
   the economics.

For a single plan, the break-even fleet count is
`ceil((monthly fixed costs + desired owner draw + reserve) / positive
contribution per fleet)`. If contribution per fleet is not positive,
reprice or reduce service cost before using this formula.

## Measure the path to revenue

Keep a simple weekly log of counts with dates: requests received, qualified
conversations, approved pilots, fleets created, invited drivers, accepted
drivers, fleets with a first synced session, fleets opening a full-period
report, pilots reaching day 7 and day 30, written paid commitments, activated
subscriptions, renewals, cancellations, support hours, and refunds. Use
unique fleets as the denominator for fleet conversion. A form submission is
not an approved trial; a trial is not a paying customer.

At day 30, ask the fleet owner:

- Which manager task was worth keeping? What did it replace?
- What was missing or too much work for drivers and managers?
- Would you pay to continue under a written scope? At what monthly amount?
- Would you agree to that amount now, subject to the known prototype limits?
- If not, what specific change would alter the decision?

Record the answer and any actual commitment, rather than interpreting
positive feedback as willingness to pay.

## Decisions required before live billing

The phrase **active driver** needs a written contractual and technical
definition. A candidate for discussion is: a distinct accepted fleet member
who voluntarily synced at least one session during the billing month.
Before implementation, decide whether an invited but nonparticipating member
counts, how removal and reinstatement work, whether the plan limit is a
concurrent roster cap or monthly usage cap, and whether a driver can belong to
more than one fleet. Enforce the chosen rule in the server, with an owner-visible
count and a clear upgrade path.

Confirm tax treatment, payment terms, cancellation timing, plan changes,
invoice delivery, refund handling, failed payments, retention, and support
expectations in writing. Do not activate a charge or email a customer from
this worksheet. Prepare test-mode billing first, then review the exact live
commercial terms and checkout before activation.
