import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { Gallery } from '@/constants/theme';
import { useListening } from '@/lib/audio/use-listening';
import { audioTime } from '@/lib/audio/narration';
import { AudioIconButton } from './audio-icon';
import { ArtworkThumbnail } from './artwork-thumbnail';
export const MINI_PLAYER_HEIGHT = 66;
export function openPlayer(view: 'player' | 'queue' = 'player') { router.push({ pathname: '/now-playing', params: { view } }); }
export function MiniPlayer() {
  const audio = useListening();
  if (!audio.current) return null;
  const subtitle = audio.phase === 'loading' ? 'Preparing narration…' : audio.phase === 'error' ? 'Couldn’t play · Tap to retry'
    : audio.waiting ? 'Ready when you are' : `${audio.playing ? 'Playing' : 'Paused'} · ${audioTime(audio.duration - audio.position)} left`;
  return <View style={styles.container}>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open player, ${audio.current.work.title}, ${subtitle}`} onPress={() => openPlayer()} style={styles.summary}>
        <ArtworkThumbnail uri={audio.current.work.imageUri} size={40} />
        <View style={{ flex: 1, gap: 2 }}><Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '600' }}>{audio.current.work.title}</Text><Text numberOfLines={1} style={{ fontSize: 11, color: Gallery.muted }}>{subtitle}</Text></View>
      </Pressable>
      <AudioIconButton name={audio.playing ? 'pause.fill' : 'play.fill'} label={audio.phase === 'error' ? 'Retry narration' : audio.playing ? 'Pause narration' : 'Play narration'} onPress={audio.controller.toggle} disabled={audio.phase === 'loading'} color={Gallery.accent} size={23} />
      <AudioIconButton name="list.bullet" label="Up next" onPress={() => openPlayer('queue')} size={22} />
    </View>
    <View style={styles.track}><View style={{ height: 2, width: `${audio.duration ? Math.min(100, audio.position / audio.duration * 100) : 0}%`, backgroundColor: Gallery.accent }} /></View>
  </View>;
}
const styles = StyleSheet.create({
  container: { backgroundColor: Gallery.surface, overflow: 'hidden' },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 5 },
  summary: { flex: 1, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { height: 2, backgroundColor: Gallery.softBorder },
});
