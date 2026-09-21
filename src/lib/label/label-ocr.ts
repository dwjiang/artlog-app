import { MAX_OCR_LINE_CHARS, MAX_OCR_LINES } from '@/shared/label/ocr-limits';
import { getVisionRect, type TextLine } from '../../../modules/vision-rect/src';
import { filePath } from '@/lib/file-uri';
import type { OcrLine } from './flow';

/** Trims the recognizer's lines to what convex/label.ts accepts, keeping reading order. */
export function toOcrLines(lines: readonly Pick<TextLine, 'text' | 'confidence'>[]): OcrLine[] {
  return lines
    .map((line) => ({ text: line.text.trim().slice(0, MAX_OCR_LINE_CHARS), confidence: Math.min(1, Math.max(0, line.confidence)) }))
    .filter((line) => line.text)
    .slice(0, MAX_OCR_LINES);
}

/** Reads the label photo with Apple Vision on the phone; nothing leaves the device until the lines are sent. */
export async function readLabelText(uri: string): Promise<OcrLine[]> {
  const recognized = await getVisionRect().recognizeText(filePath(uri));
  return toOcrLines(recognized.lines);
}
