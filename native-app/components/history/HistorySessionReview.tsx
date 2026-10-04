import { Ionicons } from '@expo/vector-icons';
import { Text, TouchableOpacity, View } from 'react-native';
import type { AlertAssessment } from '../../lib/feedback';
import { hasHistoryAlertAssessment } from '../../lib/historyPreferences';
import type { DeviceImpactKey, DeviceImpactValue, SessionRecord, TestConditionKey, TestConditionValue } from '../../lib/historyRecord';
import { ASSESSMENT_OPTIONS, DEVICE_IMPACT_GROUPS, TEST_CONDITION_GROUPS } from '../../lib/historyReviewModel';
import { historyStyles as s } from './historyStyles';

export interface HistoryReviewActions {
  saveAssessment: (index: number, value: AlertAssessment) => Promise<void>;
  removeAssessment: (index: number) => Promise<void>;
  saveTestCondition: (index: number, key: TestConditionKey, value: TestConditionValue) => Promise<void>;
  saveDeviceImpact: (index: number, key: DeviceImpactKey, value: DeviceImpactValue) => Promise<void>;
}

interface HistorySessionReviewProps extends HistoryReviewActions {
  item: SessionRecord;
  index: number;
  isExpanded: boolean;
  sessionBusy: boolean;
}

export function HistorySessionReview({ item, index: i, isExpanded, sessionBusy, saveAssessment, removeAssessment, saveTestCondition, saveDeviceImpact }: HistorySessionReviewProps) {
  return <>
            <View style={s.review}>
              <Text style={s.reviewTitle}>How did the alerts feel?</Text>
              {hasHistoryAlertAssessment(item.alertAssessment) && (
                <Text accessibilityLiveRegion="polite" style={s.reviewPrivacy}>
                  Saved: {ASSESSMENT_OPTIONS.find(option => option.value === item.alertAssessment)?.label}
                </Text>
              )}
              <View style={s.reviewOptions}>
                {ASSESSMENT_OPTIONS.map((option) => {
                  const selected = item.alertAssessment === option.value;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityLabel={option.label}
                      accessibilityState={{ selected, disabled: sessionBusy, busy: sessionBusy }}
                      disabled={sessionBusy}
                      style={[s.reviewOption, selected && s.reviewOptionSelected, sessionBusy && s.operationDisabled]}
                      onPress={() => saveAssessment(i, option.value)}
                    >
                      <Ionicons name={option.icon} size={15} color={selected ? '#dbeafe' : '#4a7a8a'} />
                      <Text style={[s.reviewOptionText, selected && s.reviewOptionTextSelected]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {hasHistoryAlertAssessment(item.alertAssessment) && (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Remove this session's alert assessment"
                  accessibilityHint="Returns the rating to Not assessed while keeping the session summary, test conditions, and device observations"
                  accessibilityState={{ disabled: sessionBusy, busy: sessionBusy }}
                  disabled={sessionBusy}
                  style={[s.removeAssessmentButton, sessionBusy && s.operationDisabled]}
                  onPress={() => { void removeAssessment(i); }}
                >
                  <Ionicons name="remove-circle-outline" size={16} color="#93c5fd" />
                  <Text style={s.removeAssessmentText}>Remove assessment · keep session</Text>
                </TouchableOpacity>
              )}
              <Text style={s.reviewPrivacy}>
                This alert rating stays only on this iPhone. Choose the best match after parking. It is included only if you choose to send feedback.
              </Text>
            </View>
            {isExpanded && (
              <>
            <View style={s.conditions}>
              <Text style={s.conditionsTitle}>Test conditions</Text>
              <Text style={s.conditionsSafety}>Record only after you are safely parked.</Text>
              {TEST_CONDITION_GROUPS.map(group => (
                <View key={group.key} style={s.conditionGroup}>
                  <Text style={s.conditionLabel}>{group.label}</Text>
                  <Text style={s.reviewPrivacy}>Saved: {group.options.find(option => option.value === item.testConditions?.[group.key])?.label || 'Not recorded'}</Text>
                  <View style={s.conditionOptions}>
                    {group.options.map(option => {
                      const selected = item.testConditions?.[group.key] === option.value;
                      return (
                        <TouchableOpacity
                          key={option.value}
                          accessibilityRole="button"
                          accessibilityLabel={`${group.label}: ${option.label}`}
                          accessibilityState={{ selected, disabled: sessionBusy, busy: sessionBusy }}
                          disabled={sessionBusy}
                          style={[s.conditionOption, selected && s.conditionOptionSelected, sessionBusy && s.operationDisabled]}
                          onPress={() => saveTestCondition(i, group.key, option.value)}
                        >
                          <Text style={[s.conditionOptionText, selected && s.conditionOptionTextSelected]}>
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
              <Text style={s.conditionsPrivacy}>
                Conditions stay on this iPhone and are included only if you choose Send session feedback. No location or media is attached.
              </Text>
            </View>
            <View style={s.deviceImpact}>
              <Text style={s.conditionsTitle}>Device impact</Text>
              <Text style={s.deviceImpactNote}>
                Record after safely parking. These are tester observations, not device measurements.
              </Text>
              {DEVICE_IMPACT_GROUPS.map(group => (
                <View key={group.key} style={s.conditionGroup}>
                  <Text style={s.conditionLabel}>{group.label}</Text>
                  <Text style={s.reviewPrivacy}>Saved: {group.options.find(option => option.value === item.deviceImpact?.[group.key])?.label || 'Not recorded'}</Text>
                  <View style={s.conditionOptions}>
                    {group.options.map(option => {
                      const selected = item.deviceImpact?.[group.key] === option.value;
                      return (
                        <TouchableOpacity
                          key={option.value}
                          accessibilityRole="button"
                          accessibilityLabel={`${group.label}: ${option.label}, tester-reported`}
                          accessibilityState={{ selected, disabled: sessionBusy, busy: sessionBusy }}
                          disabled={sessionBusy}
                          style={[s.conditionOption, selected && s.conditionOptionSelected, sessionBusy && s.operationDisabled]}
                          onPress={() => saveDeviceImpact(i, group.key, option.value)}
                        >
                          <Text style={[s.conditionOptionText, selected && s.conditionOptionTextSelected]}>
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
              <Text style={s.deviceWarning}>
                If iPhone shows a temperature warning, stop using Occulert and let the phone cool before another session.
              </Text>
              <Text style={s.conditionsPrivacy}>
                Device-impact observations stay on this iPhone unless you choose Send session feedback.
              </Text>
            </View>
              </>
            )}

  </>;
}
