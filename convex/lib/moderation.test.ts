import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { completion } from './labelFixtures';
import { blocklistFlags, checkText } from './moderation';

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('NEBIUS_API_KEY', 'k');
  vi.stubEnv('MODERATION_MODEL', 'nvidia/Nemotron-3_5-Lightning');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('text moderation', () => {
  it('asks the moderation model with the fields as data and returns its verdict', async () => {
    fetchMock.mockResolvedValueOnce(completion({ flagged: true }));
    await expect(checkText(['Title', null, 'Gift of Someone'])).resolves.toEqual({ flagged: true, method: 'model', calls: 1 });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.model).toBe('nvidia/Nemotron-3_5-Lightning');
    expect(JSON.parse(body.messages[1].content)).toMatchObject({ input: 'Title\nGift of Someone' });
    expect(body.response_format.json_schema.name).toBe('moderation');
  });

  it('falls back to the blocklist when the model fails, keeping the spent call count', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response('down', { status: 500 }));
    const pending = checkText(['Water Lilies', 'Claude Monet']);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual({ flagged: false, method: 'blocklist', calls: 2 });
    const flagged = checkText(['Call me at 415-555-0123']);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(flagged).resolves.toEqual({ flagged: true, method: 'blocklist', calls: 2 });
    vi.useRealTimers();
  });

  it('uses the blocklist alone when no model is configured and skips empty input', async () => {
    vi.stubEnv('MODERATION_MODEL', '');
    await expect(checkText(['donor@example.org'])).resolves.toEqual({ flagged: true, method: 'blocklist', calls: 0 });
    await expect(checkText([' ', null, undefined])).resolves.toEqual({ flagged: false, method: 'blocklist', calls: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('flags personal information patterns but not accession numbers, years or credit lines', () => {
    expect(blocklistFlags('Gift of Louise Reinhardt Smith, 1983\n1998.325.2\nFrench, 1840–1926')).toBe(false);
    expect(blocklistFlags('(415) 555 0123')).toBe(true);
    expect(blocklistFlags('4111 1111 1111 1111')).toBe(true);
    expect(blocklistFlags('078-05-1120')).toBe(true);
    expect(blocklistFlags('someone@museum.example')).toBe(true);
  });

  it('honors operator blocklist terms as whole phrases', () => {
    vi.stubEnv('MODERATION_BLOCKLIST', 'badword, worse phrase');
    expect(blocklistFlags('A BadWord in the title')).toBe(true);
    expect(blocklistFlags('Worse phrase here')).toBe(true);
    expect(blocklistFlags('badwords are not matched')).toBe(false);
  });

  it.each(['', 'custom phrase'])('retains baseline slur checks with optional terms "%s"', async (terms) => {
    vi.stubEnv('MODERATION_MODEL', '');
    vi.stubEnv('MODERATION_BLOCKLIST', terms);
    await expect(checkText(['FAGGOT'])).resolves.toEqual({ flagged: true, method: 'blocklist', calls: 0 });
    await expect(checkText(['wetbacks'])).resolves.toMatchObject({ flagged: true });
    await expect(checkText(['Portrait of Dick', 'Scunthorpe'])).resolves.toMatchObject({ flagged: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the baseline slur checks when the model fails without an operator blocklist', async () => {
    vi.stubEnv('MODERATION_BLOCKLIST', '');
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(checkText(['faggot'])).resolves.toEqual({ flagged: true, method: 'blocklist', calls: 1 });
  });
});
