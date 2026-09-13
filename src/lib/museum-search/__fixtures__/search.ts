import type { LabelFlowDisplay, MuseumSearchDisplay, SearchCandidate } from '../../../../convex/lib/validators';

export const candidate: SearchCandidate = {
  sourceUrl: 'https://museum.example/art/blue',
  fields: { title: 'Blue painting', artist: 'A. Painter' },
  imageUrls: ['https://museum.example/blue.jpg', 'https://museum.example/blue-detail.jpg'],
};
export const candidates: MuseumSearchDisplay = {
  stage: 'candidates', candidates: [candidate], promptVersion: 'describe-v1', updatedAt: 1,
};
export const verified: LabelFlowDisplay = {
  stage: 'verified', moderation: 'clear', warnings: [], evidence: ['tavily+image'], updatedAt: 2, sourceUrl: candidate.sourceUrl,
  fields: {
    title: { value: 'Blue painting', evidence: 'tavily+image', locked: true },
    artist: { value: 'A. Painter', evidence: 'tavily+image', locked: true },
  },
};
export const exhibitionCandidates: MuseumSearchDisplay = {
  stage: 'exhibitions', updatedAt: 1,
  candidates: [{ ...candidate, sourceUrl: 'https://museum.example/exhibitions/colour', fields: {},
    exhibition: { title: 'A Century of Colour', content: 'Paintings from the collection.' } }],
};
export const confirmed: MuseumSearchDisplay = {
  ...candidates, stage: 'confirmed', selected: { sourceUrl: candidate.sourceUrl, imageUrl: candidate.imageUrls[0] }, updatedAt: 2,
};
