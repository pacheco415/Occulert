import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface MonitorLayoutProps {
  camera: ReactNode;
  header: ReactNode;
  primaryAction: ReactNode;
  children: ReactNode;
  attentionKey: string;
  reduceMotion: boolean;
}

interface MonitorOverlayOwner {
  present: (owner: object, content: ReactNode) => void;
  dismiss: (owner: object) => void;
}
const MonitorOverlay = createContext<MonitorOverlayOwner | null>(null);

export function useMonitorAlertDock() {
  return useContext(MonitorOverlay) !== null;
}

/** Keep a header-anchored warning outside scrolling details. */
export function MonitorAlertPortal({ children }: { children: ReactNode }) {
  const host = useContext(MonitorOverlay);
  const owner = useRef({});
  useLayoutEffect(() => {
    if (!host) return;
    const identity = owner.current;
    host.present(identity, children);
    return () => host.dismiss(identity);
  }, [children, host]);
  return host ? null : children;
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
  const details = useRef<ScrollViewInstance>(null);
  const [floatingAlert, setFloatingAlert] = useState<ReactNode>(null);
  const overlayOwner = useRef<object | null>(null);
  // Parent layout cleanup precedes child cleanup. Clear ownership first so a
  // child's disposal cannot write to an unmounted host; Strict Mode replay can
  // still register in child layout setup before the parent's setup runs again.
  useLayoutEffect(() => () => { overlayOwner.current = null; }, []);
  const present = useCallback((owner: object, content: ReactNode) => {
    overlayOwner.current = owner;
    setFloatingAlert(content);
  }, []);
  const dismiss = useCallback((owner: object) => {
    if (overlayOwner.current !== owner) return;
    overlayOwner.current = null;
    setFloatingAlert(null);
  }, []);
  const overlay = useMemo(() => ({ present, dismiss }), [present, dismiss]);

  useEffect(() => {
    details.current?.scrollTo({ y: 0, animated: !reduceMotion });
    // Ordinary metric updates must not move a parked user's reading position.
  }, [attentionKey]);

  return (
    <MonitorOverlay.Provider value={overlay}>
      <View
        testID="monitor-layout"
        style={[styles.container, {
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        }]}
      >
        <View
          testID="monitor-header"
          style={styles.header}
        >{header}</View>
        <View testID="monitor-alert-overlay" pointerEvents="box-none" style={styles.alertDock}>
          {floatingAlert}
        </View>
        <View testID="monitor-body" style={[styles.body, columns && styles.columns]}>
          <View testID="monitor-camera-pane" style={[
            styles.camera, compact && !columns && styles.compactCamera,
            fontScale >= 1.6 && styles.largeTextCamera,
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
    </MonitorOverlay.Provider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0, minWidth: 0, backgroundColor: '#050a0f' },
  alertDock: { flexShrink: 0, zIndex: 2 },
  header: { flexShrink: 0 },
  body: { flex: 1, minHeight: 0, minWidth: 0 },
  columns: { flexDirection: 'row' },
  camera: { flex: 0.7, minHeight: 0, minWidth: 0, overflow: 'hidden', margin: 10, borderRadius: 18 },
  compactCamera: { flex: 0.3 },
  largeTextCamera: { flex: 0.15 },
  columnCamera: { flex: 1 },
  console: { flex: 1, minHeight: 0, minWidth: 0 },
  primary: { flexShrink: 0, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 },
  details: { flex: 1, minHeight: 0 },
  detailsContent: { paddingHorizontal: 12, paddingBottom: 16, gap: 10 },
});
