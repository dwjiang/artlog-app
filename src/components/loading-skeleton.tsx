import type { ReactNode } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { Gallery } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

const pulse = { '0%': { opacity: 1 }, '50%': { opacity: 0.45 }, '100%': { opacity: 1 } };

export function Ghost({ width = '100%', height = 14, round = false, style }: {
  width?: DimensionValue; height?: number; round?: boolean; style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ width, height, borderRadius: round ? height / 2 : 2, backgroundColor: Gallery.fill }, style]} />;
}

export function LoadingSkeleton({ label, children, style, fill = false }: { label: string; children: ReactNode; style?: StyleProp<ViewStyle>; fill?: boolean }) {
  const reduced = useReducedMotion();
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityState={{ busy: true }} pointerEvents="none" style={style}>
    <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[fill && { height: '100%' }, reduced ? undefined : {
      animationName: pulse, animationDuration: '1400ms', animationTimingFunction: 'ease-in-out', animationIterationCount: 'infinite',
    }]}>{children}</Animated.View>
  </View>;
}

export function ParagraphSkeleton({ label = 'Writing about this work…' }: { label?: string }) {
  return <LoadingSkeleton label={label}><View style={{ gap: 11 }}>
    <Ghost /><Ghost width="92%" /><Ghost /><Ghost width="68%" />
  </View></LoadingSkeleton>;
}

export function ImageSkeleton({ label = 'Loading photo…', style }: { label?: string; style?: StyleProp<ViewStyle> }) {
  return <LoadingSkeleton label={label} style={style} fill><Ghost style={{ height: '100%', minHeight: 1 }} /></LoadingSkeleton>;
}

export function ListSkeleton({ label, rows = 4, avatar = false, grouped = false }: {
  label: string; rows?: number; avatar?: boolean; grouped?: boolean;
}) {
  return <LoadingSkeleton label={label} style={{ paddingHorizontal: 20, paddingVertical: 16 }}>
    {grouped && <Ghost width="38%" height={20} style={{ marginBottom: 12 }} />}
    {Array.from({ length: rows }, (_, index) => <View key={index} style={styles.row}>
      <Ghost width={avatar ? 44 : 56} height={avatar ? 44 : 56} round={avatar} />
      <View style={{ flex: 1, gap: 9 }}><Ghost width={index % 2 ? '58%' : '72%'} height={17} /><Ghost width="87%" /><Ghost width="46%" height={12} /></View>
    </View>)}
  </LoadingSkeleton>;
}

export function FeedSkeleton({ label = 'Loading visits…' }: { label?: string }) {
  return <LoadingSkeleton label={label}>
    {[0, 1].map((index) => <View key={index} style={styles.card}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><Ghost width={52} height={52} round />
        <View style={{ flex: 1, gap: 8 }}><Ghost width="52%" height={20} /><Ghost width="78%" height={17} /><Ghost width="40%" /></View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}><Ghost height={150} style={{ flex: 0.8 }} /><Ghost height={150} style={{ flex: 1.3 }} /><Ghost height={150} style={{ flex: 1 }} /></View>
      <View style={{ gap: 9 }}><Ghost width="88%" /><Ghost width="65%" /></View>
    </View>)}
  </LoadingSkeleton>;
}

export function ArtworkSkeleton({ label = 'Opening artwork…' }: { label?: string }) {
  return <LoadingSkeleton label={label} style={{ padding: 20 }}><View style={{ gap: 24 }}>
    <Ghost style={{ height: undefined, aspectRatio: 1 }} />
    <View style={{ gap: 12 }}><Ghost width="65%" height={32} /><Ghost width="80%" height={18} /><Ghost width="38%" /></View>
    <View style={{ gap: 11, paddingTop: 20 }}><Ghost width="50%" height={24} /><Ghost /><Ghost /><Ghost width="72%" /></View>
  </View></LoadingSkeleton>;
}

export function ProfileSkeleton() {
  return <LoadingSkeleton label="Opening profile…" style={{ padding: 20 }}><View style={{ gap: 24 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}><Ghost width={76} height={76} round />
      <View style={{ flex: 1, gap: 10 }}><Ghost width="80%" height={28} /><Ghost width="56%" /><Ghost width="68%" /></View>
    </View>
    <View style={{ gap: 11 }}><Ghost /><Ghost width="72%" /></View>
  </View></LoadingSkeleton>;
}

export function VisitSkeleton({ label = 'Loading visit…', heading = true }: { label?: string; heading?: boolean }) {
  return <LoadingSkeleton label={label} style={{ padding: 20 }}><View style={{ gap: 24 }}>
    {heading && <View style={{ gap: 14 }}><Ghost width={44} height={44} round /><Ghost width="80%" height={32} /><Ghost width="54%" /></View>}
    <View style={{ flexDirection: 'row', gap: 13 }}>{[0, 1].map((index) => <View key={index} style={{ flex: 1, gap: 10 }}>
      <Ghost style={{ height: undefined, aspectRatio: 0.85 }} /><Ghost width="86%" height={17} /><Ghost width="63%" />
    </View>)}</View>
  </View></LoadingSkeleton>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Gallery.separator },
  card: { gap: 16, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Gallery.separator },
});
