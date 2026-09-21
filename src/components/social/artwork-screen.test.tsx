import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, DeviceEventEmitter, ScrollView } from 'react-native';
import { getFunctionName } from 'convex/server';
import type { SharedArtwork } from '@/lib/social/types';
import { ArtworkScreen } from './artwork-screen';

const mockQuery = jest.fn();
let mockSession = { key: 'viewer', status: 'ready', offline: false, token: 'private-token' };
jest.mock('@/lib/social/use-social-session', () => ({ useSocialSession: () => mockSession }));
jest.mock('@/lib/social/use-social-query', () => ({ useSocialQuery: (...args: unknown[]) => mockQuery(...args) }));
jest.mock('@/components/settings/account-section', () => ({ AccountSection: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-image', () => ({ Image: (props: object) => {
  const { View } = jest.requireActual('react-native'); return <View accessibilityRole="image" {...props} />;
} }));

const media = (photoLocalId: string): NonNullable<SharedArtwork['photos']>[number] => ({ kind: 'photo', width: 200, height: 400,
  reference: { kind: 'sharedVisit', postId: 'post-a', itemId: 'art-a' as never, photoLocalId } });
let artwork: SharedArtwork;
beforeEach(() => {
  jest.clearAllMocks(); process.env.EXPO_PUBLIC_CONVEX_SITE_URL = 'https://test.convex.site';
  mockSession = { key: 'viewer', status: 'ready', offline: false, token: 'private-token' };
  artwork = { itemId: 'art-a' as never, artwork: { title: 'Starry Night', artist: 'Vincent van Gogh', date: '1889', medium: 'Oil on canvas',
    media: media('unselected-cover') }, photos: [media('selected-a'), media('selected-b')] };
  mockQuery.mockImplementation((query, args) => ({ data: args === 'skip' ? undefined : getFunctionName(query) === 'sharedVisits:getArtwork' ? artwork : null,
    refresh: jest.fn() }));
});

it('navigates only the selected shared photos and preserves authenticated media scope', async () => {
  await render(<ArtworkScreen kind="visit" postId="post-a" itemId="art-a" />);
  expect(screen.getByText('1 / 2')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Previous photo' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Next photo' }));
  expect(screen.getByText('2 / 2')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Next photo' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Previous photo' }));
  expect(screen.getByText('1 / 2')).toBeOnTheScreen();
  const photos = [1, 2].map((index) => screen.getByRole('image', { name: `Starry Night, photo ${index}` }));
  expect(photos.map((photo) => new URL(photo.props.source.uri).searchParams.get('photoLocalId'))).toEqual(['selected-a', 'selected-b']);
  expect(photos.every((photo) => photo.props.source.headers.Authorization === 'Bearer private-token')).toBe(true);
  expect(photos.every((photo) => photo.props.cachePolicy === 'none')).toBe(true);
  expect(screen.getByText(/Vincent van Gogh/)).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'Starry Night' })).toBeOnTheScreen();
});

it('resets the gallery when a shared photo is removed and hides it when the session becomes unavailable', async () => {
  const view = await render(<ArtworkScreen kind="visit" postId="post-a" itemId="art-a" />);
  await fireEvent.press(screen.getByRole('button', { name: 'Next photo' }));
  artwork = { ...artwork, photos: [media('selected-a')] };
  await view.rerender(<ArtworkScreen kind="visit" postId="post-a" itemId="art-a" />);
  expect(screen.queryByText('1 / 1')).toBeNull();
  expect(screen.queryByRole('image', { name: 'Starry Night, photo 2' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Next photo' })).toBeNull();
  expect(screen.getByRole('image', { name: 'Starry Night, photo 1' })).toBeOnTheScreen();
  mockSession = { ...mockSession, key: 'new-account', status: 'loading' };
  await view.rerender(<ArtworkScreen kind="visit" postId="post-a" itemId="art-a" />);
  expect(screen.queryByText('Vincent van Gogh')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Next photo' })).toBeNull();
});

it('does not replace an empty shared-photo selection with another artwork image', async () => {
  artwork = { ...artwork, photos: [] };
  await render(<ArtworkScreen kind="visit" postId="post-a" itemId="art-a" />);
  expect(screen.getByText('No photos shared for this artwork.')).toBeOnTheScreen();
  expect(screen.queryByRole('image', { name: 'Starry Night, photo 1' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Next photo' })).toBeNull();
});

it('respects a live Reduce Motion change when navigating shared photos', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((event, listener) => DeviceEventEmitter.addListener(event, listener));
  const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo');
  try {
    await render(<ArtworkScreen kind="visit" postId="post-a" itemId="art-a" />);
    await act(() => DeviceEventEmitter.emit('reduceMotionChanged', true));
    await fireEvent.press(screen.getByRole('button', { name: 'Next photo' }));
    expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ animated: false }));
    await act(() => DeviceEventEmitter.emit('reduceMotionChanged', false));
    await fireEvent.press(screen.getByRole('button', { name: 'Previous photo' }));
    expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ animated: true }));
    await screen.unmount();
  } finally { jest.restoreAllMocks(); }
});
