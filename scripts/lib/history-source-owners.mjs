import assert from 'node:assert/strict';

export const HISTORY_SOURCE_PATHS = Object.freeze({
  screen: 'native-app/app/history.tsx',
  load: 'native-app/components/history/HistoryLoadState.tsx',
  filters: 'native-app/components/history/HistoryFilters.tsx',
  fusion: 'native-app/components/history/FusionValidationPanel.tsx',
  pilot: 'native-app/components/history/PilotProgressPanel.tsx',
  card: 'native-app/components/history/HistorySessionCard.tsx',
  review: 'native-app/components/history/HistorySessionReview.tsx',
  diagnostics: 'native-app/components/history/HistorySessionDiagnostics.tsx',
  reviewModel: 'native-app/lib/historyReviewModel.ts',
  viewModel: 'native-app/lib/historyViewModel.ts',
  share: 'native-app/lib/historyShareMessage.ts',
  presentation: 'native-app/lib/historyPresentation.ts',
  styles: 'native-app/components/history/historyStyles.ts',
});

/** Read the real owners only after proving their production import/render chain. */
export function readHistorySourceOwners(read) {
  const sources = Object.fromEntries(Object.entries(HISTORY_SOURCE_PATHS).map(([name, path]) => [name, read(path)]));
  function rendered(parent, name, path) {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(sources[parent], new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]${escaped}['"]`), `${name} must be imported by its actual parent`);
    assert.match(sources[parent], new RegExp(`<${name}\\b`), `${name} must be rendered by its actual parent`);
  }
  for (const name of ['HistoryLoadState', 'HistoryFilters', 'FusionValidationPanel', 'PilotProgressPanel', 'HistorySessionCard']) {
    rendered('screen', name, `../components/history/${name}`);
  }
  rendered('card', 'HistorySessionReview', './HistorySessionReview');
  rendered('card', 'HistorySessionDiagnostics', './HistorySessionDiagnostics');
  const cardProps = sources.screen.match(/<HistorySessionCard\b([\s\S]*?)\/>/)?.[1];
  assert.ok(cardProps, 'the actual screen must render the History card');
  for (const [prop, binding] of Object.entries({ item: 'item', index: 'i', sessionOperations: 'sessionOperations', expandedSessions: 'expandedSessions', pendingCloud: 'pendingCloud', pendingCloudSummaryStateIsCurrent: 'pendingCloudSummaryStateIsCurrent', scrollToPendingReview: 'scrollToPendingReview', saveAssessment: 'saveAssessment', removeAssessment: 'removeAssessment', saveTestCondition: 'saveTestCondition', saveDeviceImpact: 'saveDeviceImpact', sendSessionFeedback: 'sendSessionFeedback', confirmDeleteSession: 'confirmDeleteSession' })) {
    assert.ok(cardProps.includes(`${prop}={${binding}}`), `History card must receive actual ${prop}`);
  }
  const reviewProps = sources.card.match(/<HistorySessionReview\b([\s\S]*?)\/>/)?.[1];
  assert.ok(reviewProps, 'the actual card must render session review controls');
  for (const [prop, binding] of Object.entries({ item: 'item', index: 'i', isExpanded: 'isExpanded', sessionBusy: 'sessionBusy', saveAssessment: 'saveAssessment', removeAssessment: 'removeAssessment', saveTestCondition: 'saveTestCondition', saveDeviceImpact: 'saveDeviceImpact' })) {
    assert.ok(reviewProps.includes(`${prop}={${binding}}`), `History review must receive actual ${prop}`);
  }
  assert.match(sources.screen, /import\s*\{\s*deriveHistoryView\s*\}\s*from\s*['"]\.\.\/lib\/historyViewModel['"]/);
  assert.match(sources.screen, /const model = deriveHistoryView\(\{ sessions, historyFilter, historyPeriod, historyAssessment, historyView, sessionOperations \}\)/);
  assert.match(sources.viewModel, /from ['"]\.\/historyReviewModel\.ts['"]/);
  assert.match(sources.screen, /import\s*\{\s*buildHistoryShareMessage, buildHistoryPilotProgressMessage\s*\}\s*from\s*['"]\.\.\/lib\/historyShareMessage['"]/);
  assert.match(sources.screen, /message: buildHistoryShareMessage\(items, historyPeriod, historyFilter, historyAssessment, historyView\)/);
  assert.match(sources.screen, /message: buildHistoryPilotProgressMessage\(sessions\)/);
  assert.match(sources.screen, /import\s*\{\s*historyStyles as s\s*\}\s*from\s*['"]\.\.\/components\/history\/historyStyles['"]/);
  for (const name of ['load', 'filters', 'fusion', 'pilot', 'card', 'review', 'diagnostics']) {
    assert.match(sources[name], /import\s*\{\s*historyStyles as s\s*\}\s*from\s*['"]\.\/historyStyles['"]/);
  }
  return sources;
}
