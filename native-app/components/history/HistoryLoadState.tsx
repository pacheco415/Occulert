import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../../constants/theme';
import type { PendingCloudSummaryState } from '../../lib/cloudSync';
import { historyStyles as s } from './historyStyles';

interface HistoryLoadStateProps {
  sessionCount: number;
  loaded: boolean;
  historyLoadError: boolean;
  historyLoadBusy: boolean;
  sessionOperationsBusy: boolean;
  retryCloudBusy: boolean;
  pendingCloud: PendingCloudSummaryState;
  pendingCloudSummaryStateIsCurrent: (state: PendingCloudSummaryState) => boolean;
  load: (preserveView?: boolean) => Promise<void>;
  retrySavedCloudSummaries: () => Promise<void>;
}

export function HistoryLoadState({ sessionCount, loaded, historyLoadError, historyLoadBusy, sessionOperationsBusy, retryCloudBusy, pendingCloud, pendingCloudSummaryStateIsCurrent, load, retrySavedCloudSummaries }: HistoryLoadStateProps) {
  return <>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={historyLoadBusy ? 'Refreshing local history' : 'Refresh local history'}
          accessibilityHint="Rereads summaries and saved sync badges on this iPhone while preserving current filters, sorting, and date drafts"
          accessibilityState={{ disabled: historyLoadBusy || sessionOperationsBusy, busy: historyLoadBusy }}
          disabled={historyLoadBusy || sessionOperationsBusy}
          style={[s.refreshButton, (historyLoadBusy || sessionOperationsBusy) && s.operationDisabled]}
          onPress={() => { void load(true); }}
        >
          {historyLoadBusy ? <ActivityIndicator size="small" color="#93c5fd" /> : <Ionicons name="refresh-outline" size={17} color="#93c5fd" />}
          <Text style={s.refreshText}>{historyLoadBusy ? 'Reading local history…' : 'Refresh local history'}</Text>
        </TouchableOpacity>

        {pendingCloud.count > 0 && pendingCloudSummaryStateIsCurrent(pendingCloud) && (
          <TouchableOpacity accessibilityRole="button"
            accessibilityLabel={`Retry ${pendingCloud.count} pending cloud summaries`}
            accessibilityHint="Retries only saved session endings for the current signed-in owner with cloud sharing enabled"
            accessibilityState={{disabled:retryCloudBusy||historyLoadBusy,busy:retryCloudBusy}}
            disabled={retryCloudBusy||historyLoadBusy}
            style={[s.refreshButton,(retryCloudBusy||historyLoadBusy)&&s.operationDisabled]}
            onPress={()=>{void retrySavedCloudSummaries();}}>
            <Text style={s.refreshText}>{retryCloudBusy?'Checking saved cloud summaries…':`Retry ${pendingCloud.count} pending cloud summaries`}</Text>
          </TouchableOpacity>
        )}

        {!loaded && historyLoadBusy && (
          <View
            accessibilityLabel="Checking local session history"
            accessibilityLiveRegion="polite"
            style={s.loadingBox}
          >
            <ActivityIndicator size="small" color={colors.cyan} />
            <View style={s.loadErrorCopy}>
              <Text style={s.loadingTitle}>Checking local history</Text>
              <Text style={s.loadErrorDetail}>Reading session summaries saved on this iPhone.</Text>
            </View>
          </View>
        )}

        {loaded && historyLoadError && (
          <View accessibilityRole="alert" style={s.loadError}>
            <Ionicons name="warning-outline" size={21} color="#fbbf24" />
            <View style={s.loadErrorCopy}>
              <Text style={s.loadErrorTitle}>Couldn’t load local history</Text>
              <Text style={s.loadErrorDetail}>
                {sessionCount > 0
                  ? 'The last loaded sessions remain visible below. Retry to confirm they are current.'
                  : 'Your saved sessions were not deleted. Try reading them from this iPhone again.'}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={historyLoadBusy ? 'Retrying local session history' : 'Retry local session history'}
                accessibilityState={{ disabled: historyLoadBusy || sessionOperationsBusy, busy: historyLoadBusy }}
                disabled={historyLoadBusy || sessionOperationsBusy}
                onPress={() => { void load(true); }}
                style={s.loadRetry}
              >
                <Text style={s.loadRetryText}>{historyLoadBusy ? 'Retrying…' : 'Try again'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}


  </>;
}
