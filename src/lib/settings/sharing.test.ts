import { getSetting, setSetting } from '@/db/repos/settings';
import { getSharingDefault, setSharingDefault } from './sharing';

jest.mock('@/db/repos/settings', () => ({ getSetting: jest.fn(), setSetting: jest.fn() }));

beforeEach(() => jest.resetAllMocks());

it('offers sharing until the user turns it off', async () => {
  jest.mocked(getSetting).mockResolvedValue(undefined);
  expect(await getSharingDefault()).toBe(true);
  jest.mocked(getSetting).mockResolvedValue('false');
  expect(await getSharingDefault()).toBe(false);
});

it('persists both sharing choices', async () => {
  await setSharingDefault(false);
  await setSharingDefault(true);
  expect(setSetting).toHaveBeenNthCalledWith(1, 'sharing-default', 'false');
  expect(setSetting).toHaveBeenNthCalledWith(2, 'sharing-default', 'true');
});
