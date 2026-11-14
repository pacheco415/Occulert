import { strings, formatString } from './strings.ts';
import type { HistoryAssessmentFilter, HistoryFilter, HistoryPeriod, HistoryViewPreferences } from './historyPreferences';
import { sessionHistoryDate } from './historyPresentation.ts';
import type { SessionRecord } from './historyRecord';
import { CHECKPOINT_TARGET, historyReviewInput, historyScopeLabel } from './historyReviewModel.ts';
import { buildPilotProgressExport } from './pilotProgressExport.ts';
import { buildSessionHistoryExport } from './sessionHistoryExport.ts';

export function buildHistoryShareMessage(items: SessionRecord[], historyPeriod: HistoryPeriod, historyFilter: HistoryFilter, historyAssessment: HistoryAssessmentFilter, historyView: HistoryViewPreferences): string {
    const selectedScope = historyScopeLabel(historyPeriod, historyFilter, historyAssessment, historyView);
    const dateScope = historyPeriod === 'all'
      ? strings.history.share.allDates
      : historyPeriod === 'custom'
        ? strings.history.share.customDates
        : strings.history.share.recentDates;
  return formatString(strings.history.share.message, { scope: selectedScope, dateScope, summary: buildSessionHistoryExport(items.map(item => ({ ...historyReviewInput(item), savedAt: sessionHistoryDate(item) }))) });
}

export function buildHistoryPilotProgressMessage(sessions: SessionRecord[]): string {
  return buildPilotProgressExport(sessions.map(historyReviewInput), CHECKPOINT_TARGET);
}
