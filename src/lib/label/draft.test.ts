import type { Id } from '../../../convex/_generated/dataModel';
import { clearLabelDraft, loadLabelDraft, saveLabelDraft } from './draft';
import { formStateFromFlow, toSubmittedFields, unlockField } from './fields';

jest.mock('@/db/client', () => ({ db: jest.requireActual('@/db/test-db').createTestDatabase() }));

it('persists edit provenance per scan and clears it for a new label', async () => {
  const first = 'scan-first' as Id<'scans'>;
  const second = 'scan-second' as Id<'scans'>;
  const draft = unlockField(formStateFromFlow({
    stage: 'verified', moderation: 'clear', evidence: ['wikidata'], warnings: [], updatedAt: 1,
    fields: {
      title: { value: 'Water Lilies', evidence: 'wikidata', locked: true },
      artist: { value: 'Claude Monet', evidence: 'wikidata', locked: true },
    },
  }), 'title');
  expect(await loadLabelDraft(first)).toBeUndefined();
  await saveLabelDraft(first, draft);
  await saveLabelDraft(second, draft);
  const restored = await loadLabelDraft(first);
  expect(restored).toEqual(draft);
  expect(toSubmittedFields(restored!)?.title.edited).toBe(true);
  await clearLabelDraft(first);
  expect(await loadLabelDraft(first)).toBeUndefined();
  expect(await loadLabelDraft(second)).toEqual(draft);
});
