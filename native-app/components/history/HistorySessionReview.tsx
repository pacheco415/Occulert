import { strings, formatString } from '../../lib/strings';
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
              <Text style={s.reviewTitle}>{strings.history.review.title}</Text>
              {hasHistoryAlertAssessment(item.alertAssessment) && (
                <Text accessibilityLiveRegion="polite" style={s.reviewPrivacy}>{formatString(strings.history.review.saved, { value: ASSESSMENT_OPTIONS.find(option => option.value === item.alertAssessment)?.label ?? '' })}</Text>
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
                  accessibilityLabel={strings.history.review.removeAccessibilityLabel}
                  accessibilityHint={strings.history.review.removeHint}
                  accessibilityState={{ disabled: sessionBusy, busy: sessionBusy }}
                  disabled={sessionBusy}
                  style={[s.removeAssessmentButton, sessionBusy && s.operationDisabled]}
                  onPress={() => { void removeAssessment(i); }}
                >
                  <Ionicons name="remove-circle-outline" size={16} color="#93c5fd" />
                  <Text style={s.removeAssessmentText}>{strings.history.review.remove}</Text>
                </TouchableOpacity>
              )}
              <Text style={s.reviewPrivacy}>{strings.history.review.ratingPrivacy}</Text>
            </View>
            {isExpanded && (
              <>
            <View style={s.conditions}>
              <Text style={s.conditionsTitle}>{strings.history.common.testConditions}</Text>
              <Text style={s.conditionsSafety}>{strings.history.review.conditionsSafety}</Text>
              {TEST_CONDITION_GROUPS.map(group => (
                <View key={group.key} style={s.conditionGroup}>
                  <Text style={s.conditionLabel}>{group.label}</Text>
                  <Text style={s.reviewPrivacy}>{formatString(strings.history.review.saved, { value: group.options.find(option => option.value === item.testConditions?.[group.key])?.label || strings.history.common.notRecorded })}</Text>
                  <View style={s.conditionOptions}>
                    {group.options.map(option => {
                      const selected = item.testConditions?.[group.key] === option.value;
                      return (
                        <TouchableOpacity
                          key={option.value}
                          accessibilityRole="button"
                          accessibilityLabel={formatString(strings.history.common.labelValue, { label: group.label, value: option.label })}
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
              <Text style={s.conditionsPrivacy}>{strings.history.review.conditionsPrivacy}</Text>
            </View>
            <View style={s.deviceImpact}>
              <Text style={s.conditionsTitle}>{strings.history.common.deviceImpact}</Text>
              <Text style={s.deviceImpactNote}>{strings.history.review.deviceNote}</Text>
              {DEVICE_IMPACT_GROUPS.map(group => (
                <View key={group.key} style={s.conditionGroup}>
                  <Text style={s.conditionLabel}>{group.label}</Text>
                  <Text style={s.reviewPrivacy}>{formatString(strings.history.review.saved, { value: group.options.find(option => option.value === item.deviceImpact?.[group.key])?.label || strings.history.common.notRecorded })}</Text>
                  <View style={s.conditionOptions}>
                    {group.options.map(option => {
                      const selected = item.deviceImpact?.[group.key] === option.value;
                      return (
                        <TouchableOpacity
                          key={option.value}
                          accessibilityRole="button"
                          accessibilityLabel={formatString(strings.history.review.deviceOptionAccessibilityLabel, { label: group.label, value: option.label })}
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
              <Text style={s.deviceWarning}>{strings.history.review.temperatureWarning}</Text>
              <Text style={s.conditionsPrivacy}>{strings.history.review.devicePrivacy}</Text>
            </View>
              </>
            )}

  </>;
}
