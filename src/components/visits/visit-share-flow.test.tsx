import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { VisitSummary } from '@/lib/journal/visit-summaries';
import type { useVisitSharing } from '@/lib/visits/use-visit-sharing';
import { VisitShareLayout } from './visit-share-flow';
const mockPush = jest.fn(), mockBack = jest.fn(), mockDismiss = jest.fn();
const mockController = { load: jest.fn(), edit: jest.fn(), preview: jest.fn(), publish: jest.fn(), unshare: jest.fn(), view: jest.fn() };
let mockPage: 'index' | 'preview' | 'shared' = 'index';
let mockSharing: ReturnType<typeof useVisitSharing>;
const mockVisit = { localId: 'visit', owner: 'account:a', venueName: 'Museum', visitedOn: '2024-02-29', reflection: 'PRIVATE REFLECTION',
  works: [{ localId: 'save', title: 'Water Lilies', artist: 'Claude Monet', cropPath: null }] } as VisitSummary;
jest.mock('@/lib/journal/use-visits', () => ({ useVisits: () => ({ owner: mockVisit.owner, visits: [mockVisit], loading: false }) }));
jest.mock('@/lib/visits/use-visit-sharing', () => ({ useVisitSharing: () => mockSharing }));
jest.mock('../social/profile-form', () => ({ ProfileForm: () => null }));
jest.mock('@expo/ui/swift-ui', () => jest.requireActual('../../../__mocks__/@expo/ui/swift-ui'));
jest.mock('../settings/account-section', () => ({ AccountSection: () => null }));
jest.mock('../collection/saved-work-image', () => ({ SavedWorkImage: () => null }));
jest.mock('../artwork/display-media', () => ({ DisplayMedia: ({ label }: { label: string }) => {
  const { Text } = jest.requireActual('react-native'); return <Text accessibilityRole="image">{label}</Text>;
} }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return { router: { push: (...args: unknown[]) => mockPush(...args), back: () => mockBack(), dismiss: () => mockDismiss() },
    useLocalSearchParams: () => ({ visitId: 'visit' }),
    Stack: Object.assign(() => {
      const screens = jest.requireActual('./visit-share-flow');
      return React.createElement(mockPage === 'preview' ? screens.VisitSharePreviewScreen : mockPage === 'shared' ? screens.VisitSharedScreen : screens.VisitShareScreen);
    }, { Screen: () => null }) };
});
beforeEach(() => {
  jest.clearAllMocks(); mockPage = 'index'; mockVisit.owner = 'account:a';
  mockSharing = { acknowledged: { postId: null, status: 'private', removed: false, revision: 0, saveLocalIds: [], reflection: '' },
    draft: { visitLocalId: 'visit', revision: 0, saveLocalIds: ['save'], reflection: '' }, preview: null, shared: null,
    profileRequired: false, conflict: false, busy: false, controller: mockController, token: 'token' } as unknown as ReturnType<typeof useVisitSharing>;
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
it('renders the server preview and stays on it when publishing fails', async () => {
  mockPage = 'preview';
  mockSharing.preview = { author: { name: 'Reader', username: 'reader' } as never, venue: { name: 'Museum', venueId: 'museum' as never },
    visitedOn: '2024-02-29', reflection: 'Shared reflection only', artworks: [{ saveLocalId: 'save', artwork: { title: 'Water Lilies', artist: 'Monet', media: { kind: 'placeholder', width: 1, height: 1 } } }] };
  mockController.publish.mockResolvedValue(false);
  await render(<VisitShareLayout />);
  expect(screen.getByRole('image', { name: 'Water Lilies' })).toBeOnTheScreen();
  expect(screen.queryByText('PRIVATE REFLECTION')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Share with friends' }));
  expect(mockBack).not.toHaveBeenCalled();
});
it('offers a refreshed preview after revision conflicts', async () => {
  mockPage = 'preview'; mockSharing.conflict = true; mockSharing.error = 'Refresh the preview.';
  await render(<VisitShareLayout />);
  expect(screen.queryByRole('button', { name: 'Share with friends' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Back to selection' })); expect(mockBack).toHaveBeenCalled();
});
it('reuses profile and sign-in entry points before offering sharing', async () => {
  mockSharing.profileRequired = true;
  const view = await render(<VisitShareLayout />);
  expect(screen.getByRole('button', { name: 'Create profile' })).toBeOnTheScreen();
  mockVisit.owner = 'device:guest'; await view.rerender(<VisitShareLayout />);
  await waitFor(() => expect(screen.queryByLabelText('Shared reflection')).toBeNull());
  expect(screen.getByText('Sign in to share visits with friends.')).toBeOnTheScreen();
});
