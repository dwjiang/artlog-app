import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { RETAKE_DISMISS_MS, RetakeBanner } from './retake-banner';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('shows the triage verdict and hands the viewfinder back on Retake', async () => {
  const onRetake = jest.fn();
  await render(<RetakeBanner message="Dodge the glare" onRetake={onRetake} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Dodge the glare');
  await fireEvent.press(screen.getByRole('button', { name: 'Retake' }));
  expect(onRetake).toHaveBeenCalledTimes(1);
});

it('dismisses itself after four seconds without restarting the timer on re-render', async () => {
  const onRetake = jest.fn();
  const banner = await render(<RetakeBanner message="Hold steady and try again" onRetake={onRetake} />);
  await act(() => jest.advanceTimersByTime(RETAKE_DISMISS_MS - 1000));
  await banner.rerender(<RetakeBanner message="Hold steady and try again" onRetake={jest.fn(onRetake)} />);
  await act(() => jest.advanceTimersByTime(1000));
  expect(onRetake).toHaveBeenCalledTimes(1);
});

it('stops the timer when the banner leaves the screen', async () => {
  const onRetake = jest.fn();
  const banner = await render(<RetakeBanner message="Dodge the glare" onRetake={onRetake} />);
  await banner.unmount();
  await act(() => jest.advanceTimersByTime(RETAKE_DISMISS_MS));
  expect(onRetake).not.toHaveBeenCalled();
});
