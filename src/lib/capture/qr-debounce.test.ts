import { createQrDebouncer } from './qr-debounce';

it('accepts only complete HTTP(S) URLs', () => {
  const accept = createQrDebouncer();
  for (const value of ['', 'painting', 'javascript:alert(1)', 'file:///image.jpg', 'https://', '//example.com']) {
    expect(accept(value, 0)).toBe(false);
  }
  expect(accept('https://museum.org/work/1', 0)).toBe(true);
  expect(accept('http://museum.org/work/2', 0)).toBe(true);
});

it('limits each distinct value to one callback every three seconds', () => {
  const accept = createQrDebouncer();
  const first = 'https://museum.org/1';
  const second = 'https://museum.org/2';
  expect(accept(first, 0)).toBe(true);
  expect(accept(second, 10)).toBe(true);
  expect(accept(first, 2999)).toBe(false);
  expect(accept(first, 3000)).toBe(true);
  expect(accept(second, 3009)).toBe(false);
  expect(accept(second, 3010)).toBe(true);
});
