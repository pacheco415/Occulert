import type { HistoryAssessmentFilter, HistoryFilter, HistoryPeriod, HistoryViewPreferences } from './historyPreferences';
import { sessionHistoryDate } from './historyPresentation.ts';
import type { SessionRecord } from './historyRecord';
import { CHECKPOINT_TARGET, historyReviewInput, historyScopeLabel } from './historyReviewModel.ts';
import { buildPilotProgressExport } from './pilotProgressExport.ts';
import { buildSessionHistoryExport } from './sessionHistoryExport.ts';

export function buildHistoryShareMessage(items: SessionRecord[], historyPeriod: HistoryPeriod, historyFilter: HistoryFilter, historyAssessment: HistoryAssessmentFilter, historyView: HistoryViewPreferences): string {
    const selectedScope = historyScopeLabel(historyPeriod, historyFilter, historyAssessment, historyView);
    const dateScope = historyPeriod === 'all'
      ? 'All saved dates are included.'
      : historyPeriod === 'custom'
        ? 'The applied From and To dates are inclusive local calendar dates on this iPhone; unrecorded and future dates are excluded.'
        : 'This period includes today and the preceding local calendar days; unrecorded and future dates are excluded.';
  return `Shown view: ${selectedScope}\n${dateScope}\nAlert feedback is a saved user observation, not a detection accuracy measure. Recovered sessions are partial summaries.\n\n${buildSessionHistoryExport(items.map(item => ({ ...historyReviewInput(item), savedAt: sessionHistoryDate(item) })))}`;
}

export function buildHistoryPilotProgressMessage(sessions: SessionRecord[]): string {
  return buildPilotProgressExport(sessions.map(historyReviewInput), CHECKPOINT_TARGET);
}
