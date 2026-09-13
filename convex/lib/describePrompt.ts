// The describe prompt is a product surface: the model proposes a query, the museum's
// page supplies the words, the phone's pixels decide. Bump the version on any change.
export const DESCRIBE_PROMPT_VERSION = 'describe-v1';
export const DESCRIBE_MAX_TOKENS = 256;

export const DESCRIBE_SYSTEM_PROMPT =
  'You describe paintings for a museum catalogue search. Return only JSON matching the schema. ' +
  'Describe only what is visible; never name the work.';

export const DESCRIBE_SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    artist_guess: { type: ['string', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['description', 'artist_guess', 'confidence'],
  additionalProperties: false,
};

export const DESCRIBE_USER_PROMPT =
  'In at most 40 words, describe the subject, composition, palette and notable objects of this painting. ' +
  'Set artist_guess only when the style is unmistakable, with your confidence from 0 to 1; otherwise use null and 0. ' +
  `Return JSON matching this schema: ${JSON.stringify(DESCRIBE_SCHEMA)}`;

const MAX_DESCRIPTION_CHARS = 400;
const MAX_QUERY_CHARS = 300;
const ARTIST_GUESS_CONFIDENCE = 0.5;

export type Description = { description: string; artistGuess: string | null; confidence: number };

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function parseDescription(value: unknown): Description | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => key in DESCRIBE_SCHEMA.properties)) return null;
  const { description, artist_guess: artistGuess, confidence } = record;
  if (typeof description !== 'string' || (artistGuess !== null && typeof artistGuess !== 'string') ||
    typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  const text = collapse(description);
  if (!text || text.length > MAX_DESCRIPTION_CHARS) return null;
  return { description: text, artistGuess: artistGuess === null ? null : collapse(artistGuess) || null, confidence };
}

// The artist guess is the most selective term, so the description yields to it when the query is trimmed.
export function searchQuery({ description, artistGuess, confidence }: Description): string {
  const guess = artistGuess && confidence >= ARTIST_GUESS_CONFIDENCE ? artistGuess : null;
  const room = MAX_QUERY_CHARS - (guess ? guess.length + 1 : 0);
  const text = collapse(description.slice(0, Math.max(0, room)));
  return (guess ? collapse(`${text} ${guess}`) : text).slice(0, MAX_QUERY_CHARS);
}
