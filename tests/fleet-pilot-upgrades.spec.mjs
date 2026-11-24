import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const day = 86_400_000;
const ago = days => new Date(Date.now() - days * day).toISOString();
async function ownerSession(page) {
  await page.addInitScript(() => localStorage.setItem('occulert-auth', JSON.stringify({
    access_token: 'manager-token', refresh_token: 'manager-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'manager-1', email: 'manager@example.com' },
  })));
}
function protectedSummary(sessions) {
  return {
    ok: true, fleet: { id: 'fleet-1', company_name: 'Pilot Transit', plan: 'trial' },
    drivers: [{ id: 'driver-1', name: 'Private Driver', vehicle_id: 'Private Vehicle', active: true }],
    sessions, events: [], telemetry_trust: 'unverified_client_report',
    privacy: { includes_location: false, includes_personal_media: false, includes_raw_motion: false },
  };
}
function session(id, days, score = 80) {
  return { id, driver_id: 'driver-1', started_at: ago(days), ended_at: ago(days), safety_score: score, alert_count: 0 };
}
function completePeriodReport(days) {
  const count = days === 7 ? 2 : 3;
  return {
    version: 1, days, window_start: ago(days), window_end: new Date().toISOString(), complete_period: true,
    roster_total: 1, active_drivers: 1, reporting_active_drivers: 1,
    sessions: count, completed: count, no_recorded_end: 0, invalid_recorded_end: 0,
    scored: count - 1, unscored: 1, average_safety_score: 80,
    valid_alert_records: count, missing_alert_records: 0, alerts: 0,
    reviewed: 1, without_reviewed_followup: count - 1,
    detector_pipelines: { web_mediapipe_ear: 0, ios_mlkit_eye_probability: 0,
      android_mlkit_eye_probability: 0, unknown: count },
    interruption_reasons_available: false, unrecorded_sessions_detectable: false,
  };
}

test('TV separates in-progress and unfinished records across windows while retaining aggregate privacy in large text', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await ownerSession(page);
  let requests = 0;
  await page.route('**/api/fleet-summary*', route => {
    requests += 1;
    expect(new URL(route.request().url()).searchParams.get('include_events')).toBe('0');
    return route.fulfill({ json: protectedSummary([
      session('recent', 2), session('older', 10),
      { ...session('fresh-open', 1 / 24), ended_at: null },
      { ...session('older-open', 13 / 24), ended_at: null },
      { ...session('outside-window-open', 40), ended_at: null },
      { ...session('future', -1), ended_at: null },
      { ...session('invalid', 2), started_at: 'not-a-date', ended_at: null },
    ]) });
  });
  await page.goto('/fleet-display.html');
  await expect(page.locator('#displayContent')).toBeVisible();
  await expect(page.locator('#fleetInsightCard')).toHaveCount(0);
  await expect(page.locator('#fleetTimeOfDay')).toHaveCount(0);
  await expect(page.locator('#fleetAskCard')).toHaveCount(0);
  await expect(page.locator('#recentSessions')).toHaveText('4');
  await expect(page.locator('#activeSessions')).toHaveText('1');
  await expect(page.locator('#unfinishedSessions')).toHaveText('2');
  await expect(page.locator('#pulseNow')).toHaveText('1');
  await expect(page.locator('.live-card')).toContainText('Sessions in progress');
  await expect(page.locator('.live-card')).toContainText('started within 12 hours');
  await expect(page.locator('#unfinishedSessions').locator('..')).toContainText('started over 12 hours ago');
  await expect(page.locator('#summaryScope')).toContainText('live device monitoring is not verified');
  await expect(page.locator('.metric-card')).toHaveCount(5);
  await page.locator('#windowDays').selectOption('7');
  await expect(page.locator('#recentSessions')).toHaveText('3');
  await expect(page.locator('#sessionWindowLabel')).toContainText('7');
  await expect(page.locator('#activeSessions')).toHaveText('1');
  await expect(page.locator('#unfinishedSessions')).toHaveText('2');
  await expect(page.locator('#pulseNow')).toHaveText('1');
  await page.locator('#windowDays').selectOption('30');
  await expect(page.locator('#recentSessions')).toHaveText('4');
  await expect(page.locator('#activeSessions')).toHaveText('1');
  await expect(page.locator('#unfinishedSessions')).toHaveText('2');
  expect(requests).toBe(1);
  await page.locator('#largeTextButton').click();
  await expect(page.locator('#largeTextButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-display-size', 'large');
  for (const [width, columns] of [[1920, 5], [960, 2], [390, 1]]) {
    await page.setViewportSize({ width, height: 1080 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await page.locator('.metric-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(columns);
  }
  const content = await page.locator('#displayContent').innerText();
  expect(content).not.toContain('Private Driver');
  expect(content).not.toContain('Private Vehicle');
  await page.evaluate(() => {
    localStorage.removeItem('occulert-auth');
    window.dispatchEvent(new StorageEvent('storage', { key: 'occulert-auth', newValue: null }));
  });
  await expect(page.locator('#displayContent')).toBeHidden();
  await expect(page.locator('#emptyTitle')).toHaveText('Fleet owner sign-in required');
  await expect(page.locator('#activeSessions')).toHaveText('0');
  await expect(page.locator('#unfinishedSessions')).toHaveText('0');
  await expect(page.locator('#pulseNow')).toHaveText('0');
});

test('TV labels a full latest-50 response as limited history', async ({ page }) => {
  await ownerSession(page);
  await page.route('**/api/fleet-summary*', route => route.fulfill({
    json: protectedSummary(Array.from({ length: 50 }, (_, i) => session(`session-${i}`, 1))),
  }));
  await page.goto('/fleet-display.html');
  await expect(page.locator('#recentSessions')).toHaveText('50');
  await expect(page.locator('#summaryScope')).toHaveAttribute('data-limited', 'true');
  await expect(page.locator('#summaryScope')).toContainText('50');
});

test('manager print uses protected aggregates and clears on sign-out', async ({ page }) => {
  await ownerSession(page);
  const sessions = [session('recent', 2), session('unscored', 3, null), session('older', 10), session('future', -1)];
  await page.route('**/api/fleet-summary*', route => route.fulfill({ json: protectedSummary(sessions) }));
  const reportRequests = [];
  await page.route('**/api/fleet-period-report*', route => {
    const days = Number(new URL(route.request().url()).searchParams.get('days'));
    reportRequests.push(days);
    return route.fulfill({ json: {
      ok: true, fleet: { id: 'fleet-1', company_name: 'Pilot Transit' }, report: completePeriodReport(days),
      telemetry_trust: 'unverified_client_report',
      privacy: { includes_location: false, includes_personal_media: false, includes_raw_motion: false },
    } });
  });
  await page.goto('/fleet-dashboard.html');
  await expect(page.locator('#cloudStatus')).toContainText('Protected connection active');
  await expect(page.locator('#qualityCompleted')).toHaveText('3');
  await expect(page.locator('#valueSessions')).toHaveText('3');
  await expect(page.locator('#qualityUnscored')).toHaveText('1');
  await expect(page.locator('#qualityMissingReview')).toHaveText('2');
  await expect(page.locator('#qualityInterrupted')).not.toHaveText('0');
  await expect(page.locator('#pilotReportPrint')).toBeEnabled();
  expect(reportRequests).toContain(30);
  await page.locator('#pilotRange').selectOption('7');
  await expect(page.locator('#qualityCompleted')).toHaveText('2');
  await expect(page.locator('#valueSessions')).toHaveText('2');
  await expect(page.locator('#qualityUnscored')).toHaveText('1');
  await expect(page.locator('#qualityMissingReview')).toHaveText('1');
  expect(reportRequests).toContain(7);
  await page.evaluate(() => { window.print = () => { window.pilotPrintCalls = (window.pilotPrintCalls || 0) + 1; }; });
  await page.locator('#pilotReportPrint').click();
  expect(await page.evaluate(() => window.pilotPrintCalls)).toBe(1);
  await page.locator('#pilotReportPreview > summary').click();
  const report = await page.locator('#pilotPrintableReport').innerText();
  expect(report).toContain('Pilot Transit');
  expect(report).not.toContain('Private Driver');
  expect(report).not.toContain('Private Vehicle');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#pilotPrintableReport')).toBeVisible();
  await expect(page.locator('#drivers')).toHaveCount(1);
  await expect(page.locator('#drivers')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => {
    localStorage.removeItem('occulert-auth');
    window.dispatchEvent(new StorageEvent('storage', { key: 'occulert-auth', newValue: null }));
  });
  await expect(page.locator('#pilotReportPrint')).toBeDisabled();
  await expect(page.locator('#pilotPrintableReport')).not.toContainText('Pilot Transit');
});

test('signed-out demo data cannot produce a protected manager report', async ({ page }) => {
  const chartRequests = [];
  page.on('request', request => { if (request.url().includes('/api/fleet-time-of-day')) chartRequests.push(request.url()); });
  await page.goto('/fleet-dashboard.html');
  await page.getByRole('button', { name: 'Load Demo Data' }).click();
  await expect(page.locator('#fleetInsightCard')).toBeHidden();
  await expect(page.locator('#fleetTimeOfDay')).toBeHidden();
  await expect(page.locator('#fleetAskCard')).toBeHidden();
  expect(chartRequests).toEqual([]);
  await expect(page.locator('#pilotReportPrint')).toBeDisabled();
  await expect(page.locator('#qualityCompleted')).not.toHaveText('0');
});

async function summaryDashboard(page, respond) {
  await ownerSession(page);
  await page.route('**/api/fleet-summary*', route => route.fulfill({ json: protectedSummary([]) }));
  await page.route('**/api/fleet-period-report*', route => {
    const days = Number(new URL(route.request().url()).searchParams.get('days'));
    return route.fulfill({ json: { ...protectedSummary([]), report: completePeriodReport(days) } });
  });
  const requests = [];
  await page.route('**/api/fleet-insights*', route => {
    const days = Number(new URL(route.request().url()).searchParams.get('days'));
    expect(route.request().headers().authorization).toBe('Bearer manager-token');
    requests.push(days);
    return respond(route, days, requests.length);
  });
  await page.goto('/fleet-dashboard.html');
  await expect(page.getByRole('button', { name: 'Write summary' })).toBeVisible();
  expect(requests).toEqual([]);
  return requests;
}

function timeReport(days) {
  return { ok: true, telemetry_trust: 'unverified_client_report', report: {
    version: 1, days, window_start: ago(days), window_end: ago(0), timezone: 'Europe/London',
    blocks: [0, 1, 2, 3, 4, null].map((rate, index) => ({
      start_hour: index * 4, monitored_minutes: rate === null ? 90 : 120, drowsy_alerts: (rate || 0) * 2,
      distracted_alerts: 7, rate_available: rate !== null, drowsy_alerts_per_hour: rate,
    })),
  } };
}

test('owner chart and accessible table show the selected period, timezone, zero and thin blocks', async ({ page }) => {
  const daysRequested = [];
  await page.route('**/api/fleet-time-of-day?*', route => {
    expect(route.request().headers().authorization).toBe('Bearer manager-token');
    const days = Number(new URL(route.request().url()).searchParams.get('days'));
    daysRequested.push(days);
    return route.fulfill({ json: timeReport(days) });
  });
  await summaryDashboard(page, () => { throw Error('Unexpected summary request'); });
  const chart = page.getByRole('region', { name: 'When alerts happen' });
  await expect(chart).toContainText('Last 30 days · Europe/London');
  const labels = ['00:00–04:00', '04:00–08:00', '08:00–12:00', '12:00–16:00', '16:00–20:00', '20:00–24:00'];
  const values = ['0', '1', '2', '3', '4', 'Not enough driving'];
  const bars = chart.locator('.fleet-time-bars > div');
  await expect(bars).toHaveCount(6);
  await expect(bars.locator('span:first-child')).toHaveText(labels);
  await expect(bars.locator('span:last-child')).toHaveText(values);
  await expect(bars.locator('meter')).toHaveCount(5);
  expect(await bars.locator('meter').evaluateAll(items => items.map(item => [item.value, item.max])))
    .toEqual([[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]]);
  const table = chart.getByRole('table', { name: 'Drowsy alerts per monitored hour in Europe/London' });
  await expect(table.getByRole('rowheader')).toHaveText(labels);
  await expect(table.getByRole('cell')).toHaveText(values);
  const accessibility = await new AxeBuilder({ page }).include('#fleetTimeOfDay')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(accessibility.violations.map(violation => violation.id)).toEqual([]);
  await page.locator('#pilotRange').selectOption('7');
  await expect(chart).toContainText('Last 7 days · Europe/London');
  expect(daysRequested).toEqual([30, 7]);
  await page.evaluate(() => {
    localStorage.removeItem('occulert-auth');
    window.dispatchEvent(new StorageEvent('storage', { key: 'occulert-auth', newValue: null }));
  });
  await expect(chart).toHaveCount(0);
  await expect(page.locator('#fleetTimeContent')).toBeEmpty();
});

test('unavailable chart responses leave the rest of each period report usable', async ({ page }) => {
  const completed = [];
  await page.route('**/api/fleet-time-of-day?*', route => route.fulfill({
    status: route.request().url().endsWith('days=30') ? 501 : 503, json: { ok: false },
  }));
  page.on('response', response => {
    if (response.url().includes('/api/fleet-time-of-day?')) completed.push(response.status());
  });
  await summaryDashboard(page, () => { throw Error('Unexpected summary request'); });
  for (const [days, status] of [[30, 501], [7, 503]]) {
    await page.locator('#pilotRange').selectOption(String(days));
    await expect.poll(() => completed.includes(status)).toBe(true);
    await expect(page.locator('#fleetTimeOfDay')).toBeHidden();
    await expect(page.locator('#pilotReportPrint')).toBeEnabled();
  }
});

test('summary is owner-requested, renders model output as text, and clears when the period changes', async ({ page }) => {
  const text = '<img src=x alt="example"> Two sessions lacked an end time.';
  const requests = await summaryDashboard(page, (route, days) => route.fulfill({ json: {
    ok: true, ai_generated: true, days, model: 'example-model', summary: text,
    generated_at: ago(0), window_start: ago(days), window_end: ago(0),
  } }));
  await page.getByRole('button', { name: 'Write summary' }).click();
  await expect(page.locator('#fleetInsightText')).toHaveText(text);
  await expect(page.locator('#fleetInsightText img')).toHaveCount(0);
  await expect(page.locator('#fleetInsightDetails')).toContainText('example-model · Written');
  await expect(page.locator('#fleetInsightDetails')).toContainText('Report ending');
  const accessibility = await new AxeBuilder({ page }).include('#fleetInsightCard')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(accessibility.violations.map(violation => violation.id)).toEqual([]);
  await page.locator('#pilotRange').selectOption('7');
  await expect(page.locator('#fleetInsightText')).toBeEmpty();
  await page.getByRole('button', { name: 'Write summary' }).click();
  await expect(page.locator('#fleetInsightText')).toHaveText(text);
  expect(requests).toEqual([30, 7]);
});

test('unconfigured summaries hide the card and leave the report usable', async ({ page }) => {
  const requests = await summaryDashboard(page, route => route.fulfill({ status: 501, json: { ok: false } }));
  await page.getByRole('button', { name: 'Write summary' }).click();
  await expect(page.locator('#fleetInsightCard')).toBeHidden();
  await expect(page.locator('#pilotReportPrint')).toBeEnabled();
  await page.locator('#pilotRange').selectOption('7');
  await expect(page.locator('#qualityCompleted')).toHaveText('2');
  await expect(page.locator('#fleetInsightCard')).toBeHidden();
  expect(requests).toEqual([30]);
});

async function pauseSummaryClock(page) {
  const now = Date.now();
  await page.clock.install({ time: new Date(now) });
  const pausedAt = new Date(now + 1000);
  await page.clock.pauseAt(pausedAt);
  return pausedAt.getTime();
}

test('one click checks a pending summary again and displays the finished answer', async ({ page }) => {
  const requests = await summaryDashboard(page, (route, days, count) => route.fulfill({
    status: count === 1 ? 202 : 200, headers: { 'Retry-After': '0' },
    json: count === 1 ? { ok: false } : { ok: true, ai_generated: true, days, model: 'fixture',
      summary: 'Two records need review.', generated_at: ago(0), window_end: ago(0) },
  }));
  await pauseSummaryClock(page);
  await page.getByRole('button', { name: 'Write summary' }).click();
  await expect(page.locator('#fleetInsightText')).toContainText('Checking again automatically');
  await expect(page.locator('#writeFleetInsight')).toBeDisabled();
  await page.clock.runFor(999);
  expect(requests).toEqual([30]);
  await page.clock.runFor(1);
  await expect(page.locator('#fleetInsightText')).toHaveText('Two records need review.');
  expect(requests).toEqual([30, 30]);
});

test('three pending replies restore manual checking and respect the default and maximum delay', async ({ page }) => {
  const requests = await summaryDashboard(page, (route, days, count) => route.fulfill({
    status: count <= 3 ? 202 : 502, headers: count === 2 ? { 'Retry-After': '99' } : {}, json: { ok: false },
  }));
  await pauseSummaryClock(page);
  await page.getByRole('button', { name: 'Write summary' }).click();
  for (const [index, delay] of [2000, 10000].entries()) {
    await expect.poll(() => requests.length).toBe(index + 1);
    await expect(page.locator('#fleetInsightText')).toContainText('Checking again automatically');
    await page.clock.runFor(delay - 1);
    expect(requests.length).toBe(index + 1);
    await page.clock.runFor(1);
  }
  await expect(page.getByRole('button', { name: 'Check summary' })).toBeEnabled();
  await page.clock.runFor(12000);
  expect(requests).toEqual([30, 30, 30]);
  await page.getByRole('button', { name: 'Check summary' }).click();
  await expect(page.locator('#fleetInsightText')).toContainText('Summary unavailable');
  await expect(page.getByRole('button', { name: 'Write summary' })).toBeEnabled();
  expect(requests).toEqual([30, 30, 30, 30]);
});

for (const change of ['period', 'sign-out']) test('a pending check is canceled on ' + change, async ({ page }) => {
  const requests = await summaryDashboard(page, route => route.fulfill({ status: 202, json: { ok: false } }));
  await pauseSummaryClock(page);
  await page.getByRole('button', { name: 'Write summary' }).click();
  await expect(page.locator('#fleetInsightText')).toContainText('Checking again automatically');
  if (change === 'period') {
    await page.locator('#pilotRange').selectOption('7');
    await expect(page.getByRole('button', { name: 'Write summary' })).toBeEnabled();
  } else {
    await page.evaluate(() => {
      localStorage.removeItem('occulert-auth');
      window.dispatchEvent(new StorageEvent('storage', { key: 'occulert-auth', newValue: null }));
    });
    await expect(page.locator('#fleetInsightCard')).toBeHidden();
  }
  await page.clock.runFor(10001);
  await expect(page.locator('#fleetInsightText')).toBeEmpty();
  expect(requests).toEqual([30]);
});

test('a spent attempt shows the local retry time and locks only that period until it expires', async ({ page }) => {
  let retryAt;
  const requests = await summaryDashboard(page, route => route.fulfill({
    status: 502, json: { ok: false, error: 'insights_unavailable', retry_after: retryAt },
  }));
  const now = await pauseSummaryClock(page);
  retryAt = new Date(now + 20000).toISOString();
  const localTime = await page.evaluate(value => new Date(value).toLocaleString(), retryAt);
  const button = page.getByRole('button', { name: 'Write summary' });
  const message = "Today's summary couldn't be written. You can try again after " + localTime + '.';
  await button.click();
  await expect(page.locator('#fleetInsightText')).toHaveText(message);
  await expect(button).toBeDisabled();
  await page.locator('#pilotRange').selectOption('7');
  await expect(button).toBeEnabled();
  await page.locator('#pilotRange').selectOption('30');
  await expect(page.locator('#fleetInsightText')).toHaveText(message);
  await page.clock.runFor(19999);
  await expect(button).toBeDisabled();
  await page.clock.runFor(1);
  await expect(button).toBeEnabled();
  await expect(page.locator('#fleetInsightText')).toBeEmpty();
  expect(requests).toEqual([30]);
});

test('sign-out while a summary is loading clears the card and discards the late result', async ({ page }) => {
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  await summaryDashboard(page, async (route, days) => {
    started.resolve();
    await release.promise;
    await route.fulfill({ json: { ok: true, ai_generated: true, days, model: 'fixture', summary: 'Previous fleet.',
      generated_at: ago(0), window_start: ago(days), window_end: ago(0) } });
  });
  try {
    await page.getByRole('button', { name: 'Write summary' }).click();
    await started.promise;
    await expect(page.locator('#fleetInsightText')).toHaveText('Loading summary…');
    await expect(page.locator('#writeFleetInsight')).toBeDisabled();
    await page.evaluate(() => {
      localStorage.removeItem('occulert-auth');
      window.dispatchEvent(new StorageEvent('storage', { key: 'occulert-auth', newValue: null }));
    });
    await expect(page.locator('#fleetInsightCard')).toBeHidden();
  } finally { release.resolve(); }
  await expect(page.locator('#fleetInsightText')).toBeEmpty();
});

async function askDashboard(page, respond) {
  const requests = [];
  await page.route('**/api/fleet-ask', route => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(request.headers().authorization).toBe('Bearer manager-token');
    expect(request.headers()['content-type']).toBe('application/json');
    requests.push(request.postDataJSON());
    return respond(route, requests.length);
  });
  await summaryDashboard(page, () => { throw Error('Unexpected summary request'); });
  const card = page.getByRole('region', { name: 'Ask about your fleet' });
  await expect(card).toBeVisible();
  expect(requests).toEqual([]);
  return { card, field: card.getByRole('textbox', { name: 'Your question' }),
    ask: card.getByRole('button', { name: 'Ask', exact: true }), requests };
}

test('suggestions fill the question without sending, and answers use only text and the selected period', async ({ page }) => {
  const answer = '<img src=x onerror=alert(1)> Two sessions need review.';
  const generated = new Date().toISOString();
  const { card, field, ask, requests } = await askDashboard(page, route => route.fulfill({ json: {
    ok: true, ai_generated: true, answer, model: 'fixture-model', days: 7, generated_at: generated,
    window_start: ago(7), window_end: ago(0), monthly_remaining: 49,
  } }));
  await page.locator('#pilotRange').selectOption('7');
  await expect(page.locator('#qualityCompleted')).toHaveText('2');
  await expect(field).toHaveAttribute('maxlength', '300');
  const storageBefore = await page.evaluate(() => JSON.stringify(localStorage));
  for (const suggestion of ['When do alerts happen most?', 'Are alerts up or down this week?',
    'How many sessions still need review?', 'How much of our data is incomplete?']) {
    await card.getByRole('button', { name: suggestion, exact: true }).click();
    await expect(field).toHaveValue(suggestion);
  }
  await field.fill('How many sessions need review?');
  expect(requests).toEqual([]);
  await field.press('Enter');
  await expect(card.locator('#fleetAskAnswer')).toHaveText(answer);
  await expect(card.locator('#fleetAskAnswer img')).toHaveCount(0);
  await expect(card.getByText("AI-written from your fleet's totals. Check the numbers above before acting.")).toBeVisible();
  const localTime = await page.evaluate(value => new Date(value).toLocaleString(), generated);
  await expect(card.locator('#fleetAskDetails')).toHaveText('fixture-model · Written ' + localTime + ' · 49 questions left this month');
  await expect(ask).toBeEnabled();
  expect(requests).toEqual([{ days: 7, question: 'How many sessions need review?' }]);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(storageBefore);
  const accessibility = await new AxeBuilder({ page }).include('#fleetAskCard')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(accessibility.violations.map(violation => violation.id)).toEqual([]);
  await page.locator('#pilotRange').selectOption('30');
  await expect(field).toHaveValue('');
  await expect(card.locator('#fleetAskAnswer')).toBeEmpty();
});

test('the question box explains private detail, quota, timeout and unavailable responses and hides on 501', async ({ page }) => {
  const replies = [
    { status: 400, json: { error: 'question_has_personal_details' } },
    { status: 403, json: { error: 'paid_plan_required' } },
    { status: 429, headers: { 'Retry-After': '32' }, json: { error: 'account_write_rate_limited' } },
    { status: 429, headers: { 'Retry-After': '86400' }, json: { error: 'fleet_question_monthly_limit' } },
    { status: 504, json: { error: 'ask_unavailable' } },
    { status: 502, json: { error: 'untrusted upstream detail' } },
    { status: 501, json: { error: 'ask_not_configured' } },
  ];
  const { card, field, ask, requests } = await askDashboard(page, (route, count) => route.fulfill(replies[count - 1]));
  await field.fill('How many sessions need review?');
  for (const message of ['Your question includes personal details. Remove them and ask again.',
    'Fleet questions require an active paid Occulert fleet plan.',
    'You reached the hourly question limit. Try again in 32 seconds.',
    'Your fleet has used its 50 questions this month. The allowance resets on the first of the month at 00:00 UTC.',
    'The question timed out. Try again.',
    'Fleet questions are unavailable. Try again later.']) {
    await ask.click();
    await expect(card.getByRole('status')).toContainText(message);
    await expect(card.locator('#fleetAskAnswer')).toBeEmpty();
  }
  await ask.click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('#pilotReviewRefresh')).toBeFocused();
  await page.locator('#pilotRange').selectOption('7');
  await expect(page.locator('#qualityCompleted')).toHaveText('2');
  await expect(page.locator('#fleetAskCard')).toBeHidden();
  expect(requests).toHaveLength(7);
});

for (const change of ['period', 'sign-out']) test('a late fleet answer is discarded after ' + change, async ({ page }) => {
  const started = Promise.withResolvers(), done = Promise.withResolvers();
  const { card, field, ask, requests } = await askDashboard(page, async route => {
    started.resolve(); await done.promise;
    await route.fulfill({ json: { ok: true, ai_generated: true, days: 30, model: 'fixture',
      generated_at: ago(0), window_start: ago(30), window_end: ago(0), answer: 'Obsolete fleet answer.' } });
  });
  try {
    await field.fill('How are we doing?');
    await ask.click();
    await started.promise;
    await expect(ask).toBeDisabled();
    if (change === 'period') {
      await page.locator('#pilotRange').selectOption('7');
      await expect(ask).toBeEnabled();
      await expect(field).toHaveValue('');
    } else {
      await page.evaluate(() => {
        localStorage.removeItem('occulert-auth');
        window.dispatchEvent(new StorageEvent('storage', { key: 'occulert-auth', newValue: null }));
      });
      await expect(card).toHaveCount(0);
    }
  } finally { done.resolve(); }
  await expect(page.locator('#fleetAskAnswer')).toBeEmpty();
  expect(requests).toHaveLength(1);
});
