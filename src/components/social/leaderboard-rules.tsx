import { Text, View } from 'react-native';
import { useState } from 'react';
import { Gallery } from '@/constants/theme';
import { GalleryButton } from '../collection/gallery-button';
import { LeaderboardSheet } from './leaderboard-sheet';

const rules = [
  { title: 'Museum visits', paragraphs: [
    'One logged visit per museum, per calendar day. Returning on another day counts again; saving artworks is not required. Multiple entries for the same museum and date count once.',
    'Backdated visits count when they happened, not when they were entered. Future and invalid dates are excluded. These are self-reported logs, not verified attendance.',
    'Two entries at the same museum on Saturday: 1 visit. A return on Sunday: 1 more visit. Twenty paintings in one visit: still 1 visit.',
  ] },
  { title: 'Helpful contributions', paragraphs: [
    'Each distinct artwork-identification record counts once, in the period when it was first accepted. Duplicate records, pending submissions, raw scans, and the number of people helped do not add points.',
    'Removing a saved artwork doesn’t erase an accepted contribution. Contributions are credited to your account when the submitting device is linked to it.',
  ] },
  { title: 'Periods and ties', paragraphs: [
    'This month uses the current calendar month in UTC. All time includes all counted activity. Museum visits use the calendar date recorded for the visit; contributions use their acceptance date in UTC.',
    'Both audiences use the same rules. Equal totals share a rank, with names alphabetized within a tie. The next rank skips the tied positions: 1, 2, 2, 4.',
  ] },
  { title: 'Your choice to join', paragraphs: [
    'Participation starts off. Friends includes connected people who chose to participate; Global includes only people who selected Friends & Global. Nonparticipants are omitted, not given a zero.',
    'Joining shares identity and activity totals, not the underlying visits. A public wall doesn’t enroll you. You can leave both boards in Participation or Settings. You can browse Global without signing in.',
  ] },
];

export function LeaderboardRules({ onDismiss, onParticipation }: { onDismiss: () => void; onParticipation: () => void }) {
  const [participating, setParticipating] = useState(false);
  return <LeaderboardSheet title="How rankings work" isPresented={!participating} onDismiss={participating ? onParticipation : onDismiss}>
    {rules.map((rule) => <View key={rule.title} style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ color: Gallery.ink, fontSize: 16, fontWeight: '600' }}>{rule.title}</Text>
      {rule.paragraphs.map((paragraph) => <Text key={paragraph} style={{ color: Gallery.muted, fontSize: 13, lineHeight: 21 }}>{paragraph}</Text>)}
    </View>)}
    <GalleryButton label="Manage participation" variant="outlined" fullWidth onPress={() => setParticipating(true)} />
  </LeaderboardSheet>;
}
