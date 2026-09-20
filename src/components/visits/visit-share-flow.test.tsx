import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { VisitSummary } from '@/lib/journal/visit-summaries';
import type { ArtworkPhoto } from '@/db/schema';
import { dismissToast } from '@/lib/ui/toast';
import type { useVisitSharing } from '@/lib/visits/use-visit-sharing';
import { VisitShareLayout } from './visit-share-flow';
const mockPush = jest.fn(), mockBack = jest.fn(), mockDismiss = jest.fn(), mockReplace = jest.fn();
const mockController = { load: jest.fn(), edit: jest.fn(), preview: jest.fn(), publish: jest.fn(), unshare: jest.fn(), view: jest.fn() };
let mockPage: 'index' | 'preview' | 'shared' = 'index';
let mockSharing: ReturnType<typeof useVisitSharing>;
let mockPhotos: ArtworkPhoto[] = [];
const mockVisit = { localId: 'visit', owner: 'account:a', venueName: 'Museum', visitedOn: '2024-02-29', reflection: 'PRIVATE REFLECTION',
  works: [{ localId: 'save', title: 'Water Lilies', artist: 'Claude Monet', cropPath: null }] } as VisitSummary;
jest.mock('@/lib/journal/use-visits', () => ({ useVisits: () => ({ owner: mockVisit.owner, visits: [mockVisit], loading: false }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }) }));
jest.mock('@/lib/visits/use-visit-sharing', () => ({ useVisitSharing: () => mockSharing }));
jest.mock('../social/profile-form', () => ({ ProfileForm: () => null }));
jest.mock('@expo/ui/swift-ui', () => jest.requireActual('../../../__mocks__/@expo/ui/swift-ui'));
jest.mock('../settings/account-section', () => ({ AccountSection: () => null }));
jest.mock('drizzle-orm/expo-sqlite', () => ({ ...jest.requireActual('drizzle-orm/expo-sqlite'), useLiveQuery: () => ({ data: mockPhotos }) }));
jest.mock('../collection/saved-work-image', () => ({ SavedWorkImage: ({ title, path }: { title: string; path: string | null }) => {
  const { Text } = jest.requireActual('react-native'); return <Text>{title}: {path ?? 'no selected photo'}</Text>;
} }));
jest.mock('../artwork/display-media', () => ({ DisplayMedia: ({ label }: { label: string }) => {
  const { Text } = jest.requireActual('react-native'); return <Text accessibilityRole="image">{label}</Text>;
} }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return { router: { push: (...args: unknown[]) => mockPush(...args), replace: (...args: unknown[]) => mockReplace(...args), back: () => mockBack(), dismiss: () => mockDismiss() },
    useLocalSearchParams: () => ({ visitId: 'visit' }), useSegments: () => ['visit-share', '[visitId]'], useNavigation: () => ({ getState: () => undefined }),
    Stack: Object.assign(() => {
      const screens = jest.requireActual('./visit-share-flow');
      return React.createElement(mockPage === 'preview' ? screens.VisitSharePreviewScreen : mockPage === 'shared' ? screens.VisitSharedScreen : screens.VisitShareScreen);
    }, { Screen: () => null, Toolbar: Object.assign(jest.requireActual('react-native').View, { View: jest.requireActual('react-native').View }) }) };
});
afterEach(() => dismissToast());
beforeEach(() => {
  jest.clearAllMocks(); mockPage = 'index'; mockVisit.owner = 'account:a'; mockPhotos = [];
  mockVisit.works = [{ localId: 'save', title: 'Water Lilies', artist: 'Claude Monet', cropPath: null }] as VisitSummary['works'];
  mockSharing = { acknowledged: { audience: 'friends', postId: null, status: 'private', removed: false, revision: 0, saveLocalIds: [], reflection: '' },
    draft: { audience: 'friends', visitLocalId: 'visit', revision: 0, saveLocalIds: ['save'], reflection: '' }, preview: null, shared: null,
    profileRequired: false, conflict: false, busy: false, controller: mockController, token: 'token' } as unknown as ReturnType<typeof useVisitSharing>;
});
it('uses the explicitly selected visit photo in the feed preview, including an explicitly selected label', async () => {
  mockVisit.works[0].cropPath = 'private-original.jpg';
  mockPhotos = [{ owner: 'account:a', localId: 'chosen-label', savedLocalId: 'save', visitLocalId: 'visit', path: 'selected-label.jpg', kind: 'label', deletedAt: null } as ArtworkPhoto];
  mockSharing.draft!.photoSelections = [{ saveLocalId: 'save', photoLocalIds: ['chosen-label'] }];
  const view = await render(<VisitShareLayout />);
  expect(screen.getByText('Water Lilies: selected-label.jpg')).toBeOnTheScreen();
  mockSharing.draft!.photoSelections = [];
  await view.rerender(<VisitShareLayout />);
  expect(screen.queryByText('Water Lilies: selected-label.jpg')).toBeNull();
  expect(screen.getByText('Water Lilies: no selected photo')).toBeOnTheScreen();
});

it('does not use another owner, visit, artwork, deleted, or unselected photo for the feed preview', async () => {
  mockVisit.works[0].cropPath = 'private-original.jpg';
  const photo = { owner: 'account:a', localId: 'chosen', savedLocalId: 'save', visitLocalId: 'visit', path: 'must-stay-private.jpg', kind: 'full', deletedAt: null } as ArtworkPhoto;
  mockPhotos = [
    { ...photo, owner: 'account:b' }, { ...photo, visitLocalId: 'other-visit' }, { ...photo, savedLocalId: 'other-save' },
    { ...photo, deletedAt: 1 }, { ...photo, localId: 'unselected' },
  ];
  mockSharing.draft!.photoSelections = [{ saveLocalId: 'save', photoLocalIds: ['chosen'] }];
  await render(<VisitShareLayout />);
  expect(screen.getByText('Water Lilies: no selected photo')).toBeOnTheScreen();
  expect(screen.queryByText('Water Lilies: must-stay-private.jpg')).toBeNull();
});
it('shows selection and an independent shared reflection without exposing the private reflection', async () => {
  await render(<VisitShareLayout />);
  expect(screen.queryByText('PRIVATE REFLECTION')).toBeNull();
  expect(screen.getByLabelText('Shared reflection')).toHaveProp('value', '');
  await fireEvent.changeText(screen.getByLabelText('Shared reflection'), 'For friends');
  expect(mockController.edit).toHaveBeenCalledWith({ reflection: 'For friends' });
  await fireEvent.press(screen.getByRole('button', { name: 'Deselect all' }));
  expect(mockController.edit).toHaveBeenCalledWith({ saveLocalIds: [] });
});
it('opens the native preview route only after a successful preview response', async () => {
  mockController.preview.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await render(<VisitShareLayout />);
  await fireEvent.press(screen.getByRole('button', { name: 'Preview shared visit' })); expect(mockPush).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Preview shared visit' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/visit-share/[visitId]/preview', params: { visitId: 'visit' } });
});
it('lets an artwork tile change the shared selection without changing the reflection', async () => {
  await render(<VisitShareLayout />);
  const choice = screen.getByRole('checkbox', { name: 'Share Water Lilies', checked: true });
  await fireEvent.press(choice);
  expect(mockController.edit).toHaveBeenCalledWith({ saveLocalIds: [] });
  expect(screen.getByLabelText('Shared reflection')).toHaveProp('value', '');
});
it('explains the highlight limit inside the sheet, where the root toast layer is covered', async () => {
  const works = ['a', 'b', 'c', 'd'].map((id) => ({ localId: id, title: `Work ${id}`, artist: '', cropPath: null }));
  const view = await render(<VisitShareLayout />);
  mockVisit.works = works as VisitSummary['works'];
  mockSharing.draft = { ...mockSharing.draft!, saveLocalIds: ['a', 'b', 'c', 'd'], highlightLocalIds: ['a', 'b', 'c'] };
  await view.rerender(<VisitShareLayout />);
  await fireEvent.press(screen.getByRole('button', { name: 'Highlight Work d' }));
  expect(mockController.edit).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Choose up to 3 highlights. Remove one to choose another.');
  await fireEvent.press(screen.getByRole('button', { name: 'Remove highlight Work c' }));
  expect(mockController.edit).toHaveBeenCalledWith({ highlightLocalIds: ['a', 'b'] });
});
it('renders the server preview in published order and stays on it when publishing fails', async () => {
  mockPage = 'preview';
  const media = { kind: 'placeholder', width: 1, height: 1 } as const;
  mockSharing.draft = { ...mockSharing.draft!, saveLocalIds: ['save', 'lead'], highlightLocalIds: ['lead'] };
  mockSharing.preview = { audience: 'friends', author: { name: 'Reader', username: 'reader' } as never, venue: { name: 'Museum', venueId: 'museum' as never },
    visitedOn: '2024-02-29', reflection: 'Shared reflection only', artworks: [
      { saveLocalId: 'save', artwork: { title: 'Water Lilies', artist: 'Monet', media }, photos: [media] },
      { saveLocalId: 'lead', artwork: { title: 'Haystacks', artist: 'Monet', media }, photos: [media] }] };
  mockController.publish.mockResolvedValue(false);
  await render(<VisitShareLayout />);
  expect(screen.getAllByRole('image').map((image) => image.props.children)).toEqual(['Haystacks', 'Water Lilies']);
  expect(screen.queryByText('PRIVATE REFLECTION')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Publish visit' }));
  expect(mockBack).not.toHaveBeenCalled();
});
it('offers a refreshed preview after revision conflicts', async () => {
  mockPage = 'preview'; mockSharing.conflict = true; mockSharing.error = 'Refresh the preview.';
  await render(<VisitShareLayout />);
  expect(screen.queryByRole('button', { name: 'Publish visit' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Back to selection' })); expect(mockBack).toHaveBeenCalled();
});
it('reuses profile and sign-in entry points before offering sharing', async () => {
  mockSharing.profileRequired = true;
  const view = await render(<VisitShareLayout />);
  expect(screen.getByRole('button', { name: 'Create profile' })).toBeOnTheScreen();
  mockVisit.owner = 'device:guest'; await view.rerender(<VisitShareLayout />);
  await waitFor(() => expect(screen.queryByLabelText('Shared reflection')).toBeNull());
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/sign-in', params: { context: 'visit', visitId: 'visit' } });
});

it('starts with Friends and explains public access before previewing', async () => {
  const view = await render(<VisitShareLayout />);
  expect(screen.getByRole('button', { name: 'Friends' })).toBeSelected();
  await fireEvent.press(screen.getByRole('button', { name: 'Public' }));
  expect(mockController.edit).toHaveBeenCalledWith({ audience: 'public' });
  mockSharing.draft!.audience = 'public';
  await view.rerender(<VisitShareLayout />);
  expect(screen.getByText('Anyone can see this visit, its selected photos and reflection, including people without an account.')).toBeOnTheScreen();
});

it('names the public audience before publishing and allows returning to selection', async () => {
  mockPage = 'preview';
  mockSharing.preview = { audience: 'public', author: { name: 'Reader', username: 'reader' } as never,
    venue: { name: 'Museum', venueId: 'museum' as never }, visitedOn: '2024-02-29', reflection: '', artworks: [] };
  await render(<VisitShareLayout />);
  expect(screen.getByText('Only this will be shared')).toBeOnTheScreen();
  expect(screen.getByText('Public')).toBeOnTheScreen();
  expect(screen.getByText('This visit will appear on public Home, including for people without an account; your private journal stays private.')).toBeOnTheScreen();
  expect(mockController.publish).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Edit selection' }));
  expect(mockBack).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Publish visit' }));
  expect(mockController.publish).toHaveBeenCalledTimes(1);
});

it('shows the sign-in gate for a guest opening the shared-version route', async () => {
  mockPage = 'shared'; mockVisit.owner = 'device:guest';
  await render(<VisitShareLayout />);
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeOnTheScreen();
  expect(screen.queryByText('Loading shared visit…')).toBeNull();
  expect(mockController.view).not.toHaveBeenCalled();
});

it('distinguishes a withdrawn share from loading and returns to selection', async () => {
  mockPage = 'shared';
  await render(<VisitShareLayout />);
  expect(screen.getByText('This visit is not currently shared.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Back to selection' }));
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/visit-share/[visitId]', params: { visitId: 'visit' } });
});

it('keeps shared-version errors retryable after loading ends', async () => {
  mockPage = 'shared'; mockSharing.acknowledged = null; mockSharing.error = 'Check your connection and try again.';
  await render(<VisitShareLayout />);
  expect(screen.getByText('The shared visit could not load.')).toBeOnTheScreen();
  expect(screen.getByRole('alert')).toHaveTextContent('Check your connection and try again.');
  mockController.view.mockClear();
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(mockController.view).toHaveBeenCalledTimes(1);
});
