import { describe, expect, it } from 'vitest';

import fixture from '../../shared/docent/fixtures/docent-validator.json';
import { validateDocent } from './docentValidator';

describe('docent validator (shared fixture)', () => {
  it('has at least eight cases', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(8);
  });

  it.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))('%s', (_name, testCase) => {
    expect(validateDocent(testCase.sentences, new Set(testCase.factIds))).toEqual(testCase.expectedKept);
  });
});
