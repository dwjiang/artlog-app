import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { EditProfileForm } from './edit-profile-screen';
import { switchOwner } from '@/lib/account/owner-store';
import { chooseProfilePhoto, profilePhotoBytes } from '@/lib/social/profile-photo';
const mockSave = jest.fn(), mockBack = jest.fn();
jest.mock('convex/react', () => ({ ...jest.requireActual('convex/react'), useAction: () => mockSave }));
jest.mock('expo-router', () => ({ router: { back: () => mockBack() } }));
jest.mock('@/lib/social/profile-photo', () => ({ chooseProfilePhoto: jest.fn(), profilePhotoBytes: jest.fn(), removeProfilePhotoDraft: jest.fn() }));
jest.mock('@expo/ui', () => {
  const native = jest.requireActual('react-native');
  return { ...jest.requireActual('../../../__mocks__/@expo/ui'),
    TextInput: ({ modifiers, ...props }: { modifiers: { label?: string }[] }) => <native.TextInput {...props} accessibilityLabel={modifiers[0].label} /> };
});
const profile = { profileId: 'profile' as never, username: 'alex', name: 'Alex Morgan', publishedWallCount: 2, photoUrl: 'https://example.com/avatar.jpg' };
beforeEach(() => { jest.clearAllMocks(); mockSave.mockResolvedValue(profile); switchOwner('account:a', 'scope-a'); });
it('saves trimmed profile text while preserving an unchanged photo', async () => {
  await render(<EditProfileForm profile={profile} />);
  await fireEvent.changeText(screen.getByLabelText('Name'), ' Alex Chen ');
  await fireEvent.changeText(screen.getByLabelText('Introduction'), ' A love of art. ');
  await fireEvent.press(screen.getByRole('button', { name: 'Save profile' }));
  expect(mockSave).toHaveBeenCalledWith({ name: 'Alex Chen', bio: 'A love of art.' });
  expect(mockBack).toHaveBeenCalledTimes(1);
});
it('removes the photo explicitly and preserves the draft after a save failure', async () => {
  mockSave.mockRejectedValue(new Error('offline'));
  await render(<EditProfileForm profile={profile} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Remove photo' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save profile' }));
  expect(mockSave).toHaveBeenCalledWith({ name: 'Alex Morgan', bio: '', photo: null });
  expect(screen.getByRole('alert')).toHaveTextContent(/Your profile was not saved/);
  expect(screen.getByRole('button', { name: 'Add photo' })).toBeOnTheScreen();
  expect(mockBack).not.toHaveBeenCalled();
});
it('does not upload a selected photo into a different account after preparation', async () => {
  jest.mocked(chooseProfilePhoto).mockResolvedValue('file:///draft.jpg');
  let finish!: (bytes: ArrayBuffer) => void;
  jest.mocked(profilePhotoBytes).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render(<EditProfileForm profile={profile} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Change photo' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save profile' }));
  await act(() => switchOwner('account:b', 'scope-b'));
  await act(() => finish(new ArrayBuffer(3)));
  expect(mockSave).not.toHaveBeenCalled();
});
