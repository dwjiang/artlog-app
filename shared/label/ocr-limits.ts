/** Bounds on the phone's OCR payload: the phone trims to these, the server refuses more. */
export const MAX_OCR_LINES = 80;
export const MAX_OCR_LINE_CHARS = 300;

/** One printed line as the phone read it, in reading order. */
export type OcrLine = { text: string; confidence: number };
