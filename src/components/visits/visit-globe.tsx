import { Button, Host, Icon } from '@expo/ui';
import { Menu, Picker, Text as NativeText } from '@expo/ui/swift-ui';
import { accessibilityLabel, font, foregroundStyle, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { router } from 'expo-router';
import { useRef, useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gallery } from '@/constants/theme';
import { countryName, formatVisitDate, placeIdentity } from '@/lib/journal/history';
import { mappedMuseums, visitCounts, visitsAtPlace, type VisitSummary } from '@/lib/journal/visit-summaries';
import { GlobeCanvas, type GlobeCanvasHandle } from './globe-canvas';
import { ArtworkPreviews, VisitMessage, VisitSymbol, visitStyles } from './visit-ui';

export function VisitGlobe({ visits, expanded = false, initialVenueId, onList }: {
  visits: VisitSummary[]; expanded?: boolean; initialVenueId?: string; onList: () => void;
}) {
  const museums = mappedMuseums(visits);
  const [selectedId, setSelectedId] = useState(initialVenueId);
  const selected = museums.find((visit) => visit.venueId === selectedId) ?? museums[0];
  const globe = useRef<GlobeCanvasHandle>(null);
  const { height, fontScale } = useWindowDimensions();
  if (!selected) return <VisitMessage action="Show List" onAction={onList}>Globe locations are unavailable. Your visits are still in List.</VisitMessage>;
  const pins = museums.map((visit) => ({ id: visit.venueId, latitude: visit.coordinates!.latitude, longitude: visit.coordinates!.longitude, label: placeIdentity(visit).name }));
  const initialPin = pins.find((pin) => pin.id === initialVenueId) ?? pins[0];
  const place = placeIdentity(selected);
  const placeVisits = visitsAtPlace(visits, place.key);
  const counts = visitCounts(placeVisits);
  const previews = placeVisits.flatMap((visit) => visit.works);
  function select(id: string) {
    setSelectedId(id);
    const pin = pins.find((item) => item.id === id);
    if (pin) globe.current?.focus(pin);
  }
  return <View>
    <View style={{ marginTop: 8 }}>
      <GlobeCanvas ref={globe} pins={pins} selectedId={selected.venueId} initialPin={initialPin} height={expanded ? Math.max(420, height * 0.65) : 337} onSelect={setSelectedId} />
      <Host matchContents style={styles.worldMenu} colorScheme="light">
        <Menu label={<NativeText modifiers={[font({ size: 10, weight: 'medium' }), foregroundStyle('#7C8278')]}>YOUR WORLD ⌄</NativeText>}
          modifiers={[accessibilityLabel('Choose a visited museum')]}>
          <Picker label="Museums" selection={selected.venueId} onSelectionChange={select} modifiers={[pickerStyle('inline')]}>
            {museums.map((visit) => <NativeText key={visit.venueId} modifiers={[tag(visit.venueId)]}>{visit.venueName} · {placeIdentity(visit).name}</NativeText>)}
          </Picker>
        </Menu>
      </Host>
      {!expanded && <View style={styles.expand}><GlobeButton label="Expand globe" icon="arrow.up.left.and.arrow.down.right" onPress={() => router.push({ pathname: '/visit-globe', params: { venueId: selected.venueId } })} /></View>}
      <View style={styles.zoom}>
        <GlobeButton label="Zoom out" icon="minus" onPress={() => globe.current?.zoom(0.8)} />
        <GlobeButton label="Zoom in" icon="plus" onPress={() => globe.current?.zoom(1.25)} />
        <GlobeButton label="Reset globe" icon="arrow.counterclockwise" onPress={() => { setSelectedId(initialPin.id); globe.current?.reset(); }} />
      </View>
      {fontScale <= 1.5 && <Text pointerEvents="none" style={styles.hint}>Drag to explore · pinch to zoom</Text>}
    </View>
    <View style={styles.placeWrap}>
      <Pressable style={styles.placeCard} accessibilityRole="button" accessibilityLabel="Explore visits here" onPress={() => {
        const destination = { pathname: '/visit-place' as const, params: { placeKey: place.key, name: place.name } };
        if (expanded) router.dismissTo(destination); else router.push(destination);
      }}>
        <View style={styles.placeTop}>
          <View style={{ flex: 1 }}>
            {!!selected.country && <Text style={[visitStyles.eyebrow, styles.country]}>{countryName(selected.country)}</Text>}
            <Text style={styles.placeTitle}>{place.name}</Text>
            <Text style={styles.counts}>{counts.museums} {counts.museums === 1 ? 'museum' : 'museums'} · {counts.visits} {counts.visits === 1 ? 'visit' : 'visits'}</Text>
          </View>
          <View style={styles.arrow}><VisitSymbol name="arrow.right" size={15} color={Gallery.ink} /></View>
        </View>
        <View style={[styles.placeArts, fontScale > 1.5 && { flexDirection: 'column', alignItems: 'flex-start' }]}>
          <ArtworkPreviews works={previews} size={35} limit={4} />
          <Text style={styles.lastDate}>Last visited{'\n'}{formatVisitDate(placeVisits[0].visitedOn)}</Text>
        </View>
      </Pressable>
    </View>
    {visits.some((visit) => !visit.coordinates) && <VisitMessage action="Show List" onAction={onList}>Some visits have no globe location.</VisitMessage>}
  </View>;
}
function GlobeButton({ label, icon, onPress }: { label: string; icon: ComponentProps<typeof Icon>['name']; onPress: () => void }) {
  return <Host matchContents colorScheme="light">
    <Button onPress={onPress} variant="text" modifiers={[accessibilityLabel(label)]}
      style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 0.5, borderColor: '#26232026', backgroundColor: '#F6F6F2C9' }}>
      <Icon name={icon} size={14} color={Gallery.ink} />
    </Button>
  </Host>;
}
const styles = StyleSheet.create({
  worldMenu: { position: 'absolute', top: 9, left: 20 },
  expand: { position: 'absolute', top: 4, right: 18 },
  zoom: { position: 'absolute', left: 18, bottom: 13, flexDirection: 'row', gap: 5 },
  hint: { position: 'absolute', right: 18, bottom: 26, fontSize: 10, color: '#7E8178' },
  placeWrap: { paddingHorizontal: 18, paddingBottom: 4 },
  placeCard: { padding: 14, paddingBottom: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#26322222', borderRadius: 14, backgroundColor: '#E7E9E0' },
  placeTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  country: { fontSize: 9, letterSpacing: 1.2, color: '#687260' },
  placeTitle: { fontSize: 22, letterSpacing: -0.4, fontWeight: '600', color: Gallery.ink, marginVertical: 4 },
  counts: { fontSize: 11, lineHeight: 17, color: Gallery.muted },
  arrow: { width: 32, height: 32, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: '#65705C44', alignItems: 'center', justifyContent: 'center' },
  placeArts: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 11, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#26322217' },
  lastDate: { fontSize: 10, lineHeight: 16, color: '#717565', textAlign: 'right' },
});
