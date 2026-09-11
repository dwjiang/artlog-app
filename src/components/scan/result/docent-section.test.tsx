import { fireEvent, render, screen } from '@testing-library/react-native';

import { DocentSection } from './docent-section';

const mockOpenBrowser = jest.fn();

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: (url: string) => mockOpenBrowser(url) }));

const docent = [
  { sentence: 'Monet painted this pond at Giverny in 1916.', factIds: ['f1', 'f2', 'f3'] },
  { sentence: 'It entered the collection in 1959.', factIds: ['missing'] },
];
const factSheet = [
  { id: 'f1', sourceUrl: 'https://www.wikidata.org/wiki/Q1', sourceLabel: 'Wikidata' },
  { id: 'f2', sourceUrl: 'https://museum.example/lilies', sourceLabel: 'Test Museum' },
  { id: 'f3', sourceUrl: 'https://museum.example/lilies', sourceLabel: 'Test Museum' },
];

beforeEach(() => {
  mockOpenBrowser.mockReset();
  mockOpenBrowser.mockResolvedValue(undefined);
});

it('renders each sentence with one chip per source and opens the source on tap', async () => {
  await render(<DocentSection docent={docent} factSheet={factSheet} />);
  expect(screen.getByText('Monet painted this pond at Giverny in 1916.')).toBeOnTheScreen();
  expect(screen.getByText('It entered the collection in 1959.')).toBeOnTheScreen();
  expect(screen.getAllByRole('link').map((chip) => chip.props.accessibilityLabel ?? undefined)).toHaveLength(2);
  expect(screen.getByRole('link', { name: 'Wikidata' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('link', { name: 'Test Museum' }));
  expect(mockOpenBrowser).toHaveBeenCalledWith('https://museum.example/lilies');
});

it('renders nothing without sentences', async () => {
  const empty = await render(<DocentSection docent={[]} factSheet={factSheet} />);
  expect(empty.toJSON()).toBeNull();
  const pending = await render(<DocentSection />);
  expect(pending.toJSON()).toBeNull();
});
