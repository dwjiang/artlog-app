import { Link } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import type { SavedWork } from '@/db/schema';

type WorkLinkProps = {
  work: Pick<SavedWork, 'localId' | 'title' | 'artist'>;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

export function WorkLink({ work, style, children }: WorkLinkProps) {
  return (
    <Link href={{ pathname: '/[savedId]', params: { savedId: work.localId } }} asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={`${work.title}, ${work.artist}`} style={style}>
        {children}
      </Pressable>
    </Link>
  );
}
