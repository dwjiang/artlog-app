import { fireEvent, render, screen } from '@testing-library/react-native';
import type { VisitSummary } from '@/lib/journal/visit-summaries';
import { VisitGlobe } from './visit-globe';
const mockPush = jest.fn(), mockDismissTo = jest.fn(), mockFocus = jest.fn(), mockReset = jest.fn(), mockZoom = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args), dismissTo: (...args: unknown[]) => mockDismissTo(...args) } }));
jest.mock('../collection/saved-work-image', () => ({ SavedWorkImage: ({ title }: { title: string }) => {
  const { Text } = jest.requireActual('react-native'); return <Text accessibilityRole="image">{title}</Text>;
} }));
jest.mock('@expo/ui/swift-ui', () => jest.requireActual('../../../__mocks__/@expo/ui/swift-ui'));
jest.mock('./globe-canvas', () => {
  const React = jest.requireActual('react');
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return { GlobeCanvas: React.forwardRef(function MockGlobe({ pins, onSelect }: { pins: { id: string; label: string }[]; onSelect: (id: string) => void }, ref: unknown) {
    React.useImperativeHandle(ref, () => ({ focus: mockFocus, reset: mockReset, zoom: mockZoom }));
    return <View>{pins.map((pin) => <Pressable accessibilityRole="button" key={pin.id} onPress={() => onSelect(pin.id)}><Text>Pin: {pin.id}</Text></Pressable>)}</View>;
  }) };
});
const visit = (localId: string, venueId: string, city: string): VisitSummary => ({ localId, venueId, venueName: venueId, city, cityKey: city,
  visitedOn: '2024-02-29', coordinates: { latitude: 40, longitude: -73 }, works: [] } as unknown as VisitSummary);
beforeEach(() => jest.clearAllMocks());
it('renders one pin per museum and opens the selected place grouped by museum', async () => {
  await render(<VisitGlobe visits={[visit('1', 'Met', 'New York'), visit('2', 'Met', 'New York'), visit('3', 'MoMA', 'New York'), visit('4', 'Louvre', 'Paris')]} onList={jest.fn()} />);
  expect(screen.getAllByRole('button', { name: /^Pin:/ })).toHaveLength(3);
  expect(screen.getByText('2 museums · 3 visits')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Pin: Louvre' }));
  expect(screen.getByText('1 museum · 1 visit')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Explore visits here' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/visit-place', params: { placeKey: 'Paris', name: 'Paris' } });
});
it('supports menu selection without marker callbacks and provides globe zoom and reset', async () => {
  await render(<VisitGlobe visits={[visit('1', 'Met', 'New York'), visit('2', 'Louvre', 'Paris')]} onList={jest.fn()} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Louvre · Paris' }));
  expect(mockFocus).toHaveBeenCalledWith(expect.objectContaining({ id: 'Louvre' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Zoom in' }));
  expect(mockZoom).toHaveBeenCalledWith(1.25);
  await fireEvent.press(screen.getByRole('button', { name: 'Reset globe' }));
  expect(mockReset).toHaveBeenCalled();
});
it('keeps visits without coordinates available through List', async () => {
  const onList = jest.fn();
  await render(<VisitGlobe visits={[{ ...visit('1', 'Museum', 'Paris'), coordinates: undefined }]} onList={onList} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Show List' })); expect(onList).toHaveBeenCalled();
});
it('dismisses the expanded modal into the museum visit browser', async () => {
  await render(<VisitGlobe visits={[visit('1', 'Met', 'New York')]} expanded onList={jest.fn()} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Explore visits here' }));
  expect(mockDismissTo).toHaveBeenCalledWith({ pathname: '/visit-place', params: { placeKey: 'New York', name: 'New York' } });
});
