import React, { useEffect, useRef, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface MonitorLayoutProps {
  camera: ReactNode;
  header: ReactNode;
  primaryAction: ReactNode;
  children: ReactNode;
  attentionKey: string;
  reduceMotion: boolean;
}

/** Keep the camera mounted and the primary action outside the scrolling details. */
export function MonitorLayout({
  camera, header, primaryAction, children, attentionKey, reduceMotion,
}: MonitorLayoutProps) {
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const availableWidth = width - insets.left - insets.right;
  const availableHeight = height - insets.top - insets.bottom;
  const columns = availableWidth >= 480 && availableWidth > availableHeight && fontScale < 1.6;
  const compact = availableHeight < 650 || availableWidth < 360 || fontScale >= 1.3;
  const details = useRef<ScrollView>(null);

  useEffect(() => {
    details.current?.scrollTo({ y: 0, animated: !reduceMotion });
    // Ordinary metric updates must not move a parked user's reading position.
  }, [attentionKey]);

  return (
    <View
      testID="monitor-layout"
      style={[styles.container, {
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }]}
    >
      <View style={styles.header}>{header}</View>
      <View testID="monitor-body" style={[styles.body, columns && styles.columns]}>
        <View testID="monitor-camera-pane" style={[
          styles.camera, compact && !columns && styles.compactCamera,
          columns && styles.columnCamera,
        ]}>
          {camera}
        </View>
        <View style={styles.console}>
          <View testID="monitor-primary-action" style={styles.primary}>{primaryAction}</View>
          <ScrollView
            ref={details}
            testID="monitor-details"
            style={styles.details}
            contentContainerStyle={styles.detailsContent}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0, minWidth: 0, backgroundColor: '#050a0f' },
  header: { flexShrink: 0 },
  body: { flex: 1, minHeight: 0, minWidth: 0 },
  columns: { flexDirection: 'row' },
  camera: { flex: 0.7, minHeight: 0, minWidth: 0, overflow: 'hidden', margin: 10, borderRadius: 18 },
  compactCamera: { flex: 0.3 },
  columnCamera: { flex: 1 },
  console: { flex: 1, minHeight: 0, minWidth: 0 },
  primary: { flexShrink: 0, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 },
  details: { flex: 1, minHeight: 0 },
  detailsContent: { paddingHorizontal: 12, paddingBottom: 16, gap: 10 },
});
