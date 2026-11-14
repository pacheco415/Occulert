import { strings, formatString } from '../../lib/strings';
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
          accessibilityLabel={historyLoadBusy ? strings.history.load.refreshing : strings.history.load.refresh}
          accessibilityHint={strings.history.load.refreshHint}
          accessibilityState={{ disabled: historyLoadBusy || sessionOperationsBusy, busy: historyLoadBusy }}
          disabled={historyLoadBusy || sessionOperationsBusy}
          style={[s.refreshButton, (historyLoadBusy || sessionOperationsBusy) && s.operationDisabled]}
          onPress={() => { void load(true); }}
        >
          {historyLoadBusy ? <ActivityIndicator size="small" color="#93c5fd" /> : <Ionicons name="refresh-outline" size={17} color="#93c5fd" />}
          <Text style={s.refreshText}>{historyLoadBusy ? strings.history.load.reading : strings.history.load.refresh}</Text>
        </TouchableOpacity>

        {pendingCloud.count > 0 && pendingCloudSummaryStateIsCurrent(pendingCloud) && (
          <TouchableOpacity accessibilityRole="button"
            accessibilityLabel={formatString(strings.history.load.retryCloud, { count: pendingCloud.count })}
            accessibilityHint={strings.history.load.retryCloudHint}
            accessibilityState={{disabled:retryCloudBusy||historyLoadBusy,busy:retryCloudBusy}}
            disabled={retryCloudBusy||historyLoadBusy}
            style={[s.refreshButton,(retryCloudBusy||historyLoadBusy)&&s.operationDisabled]}
            onPress={()=>{void retrySavedCloudSummaries();}}>
            <Text style={s.refreshText}>{retryCloudBusy?strings.history.load.checkingCloud:formatString(strings.history.load.retryCloud, { count: pendingCloud.count })}</Text>
          </TouchableOpacity>
        )}

        {!loaded && historyLoadBusy && (
          <View
            accessibilityLabel={strings.history.load.checkingAccessibilityLabel}
            accessibilityLiveRegion="polite"
            style={s.loadingBox}
          >
            <ActivityIndicator size="small" color={colors.cyan} />
            <View style={s.loadErrorCopy}>
              <Text style={s.loadingTitle}>{strings.history.load.checkingTitle}</Text>
              <Text style={s.loadErrorDetail}>{strings.history.load.checkingDetail}</Text>
            </View>
          </View>
        )}

        {loaded && historyLoadError && (
          <View accessibilityRole="alert" style={s.loadError}>
            <Ionicons name="warning-outline" size={21} color="#fbbf24" />
            <View style={s.loadErrorCopy}>
              <Text style={s.loadErrorTitle}>{strings.history.load.errorTitle}</Text>
              <Text style={s.loadErrorDetail}>
                {sessionCount > 0
                  ? strings.history.load.errorWithSessions
                  : strings.history.load.errorWithoutSessions}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={historyLoadBusy ? strings.history.load.retryingAccessibilityLabel : strings.history.load.retryAccessibilityLabel}
                accessibilityState={{ disabled: historyLoadBusy || sessionOperationsBusy, busy: historyLoadBusy }}
                disabled={historyLoadBusy || sessionOperationsBusy}
                onPress={() => { void load(true); }}
                style={s.loadRetry}
              >
                <Text style={s.loadRetryText}>{historyLoadBusy ? strings.history.load.retrying : strings.history.load.retry}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}


  </>;
}
