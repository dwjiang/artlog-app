import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { DocentSection } from './docent-section';

const mockOpenBrowser = jest.fn();

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

describe('while the backend is still writing', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows the writing line under the title until the sentences arrive', async () => {
    const view = await render(<DocentSection title="About this work" pending />);
    expect(screen.getByText('About this work')).toBeOnTheScreen();
    expect(screen.getByText('Writing about this work…')).toBeOnTheScreen();
    await view.rerender(<DocentSection title="About this work" pending={false} docent={docent} factSheet={factSheet} />);
    expect(screen.queryByText('Writing about this work…')).toBeNull();
    expect(screen.getByText('Monet painted this pond at Giverny in 1916.')).toBeOnTheScreen();
  });

  it('gives up after ten seconds and disappears', async () => {
    const view = await render(<DocentSection title="About this work" pending />);
    await act(() => { jest.advanceTimersByTime(9_999); });
    expect(screen.getByText('Writing about this work…')).toBeOnTheScreen();
    await act(() => { jest.advanceTimersByTime(1); });
    expect(view.toJSON()).toBeNull();
  });
});
