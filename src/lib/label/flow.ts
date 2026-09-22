import { reportError } from '@/lib/observability';
import type { FunctionArgs } from 'convex/server';

import type { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import type { ImageCheck, LabelFields, LabelFlowDisplay } from '../../../convex/lib/validators';
import { errorMessage, isNetworkError } from '@/lib/network-error';

export type LabelStage = 'qr' | 'read' | 'verify' | 'image-check' | 'done';
export type LabelInput = FunctionArgs<typeof api.label.verifyLabel>['fields'];

export type LabelApi = {
  fetchQr(args: FunctionArgs<typeof api.label.fetchQr>): Promise<LabelFlowDisplay>;
  readLabel(args: FunctionArgs<typeof api.label.readLabel>): Promise<LabelFlowDisplay>;
  verifyLabel(args: FunctionArgs<typeof api.label.verifyLabel>): Promise<LabelFlowDisplay>;
};

export type OcrLine = FunctionArgs<typeof api.label.readLabel>['lines'][number];

export type LabelFlowInput = {
  scanId: Id<'scans'>;
  labelPhotoUri?: string;
  qrUrl?: string;
  api: LabelApi;
  /** The label's printed lines, read on the phone (label-ocr.ts); the photo itself never leaves the device. */
  readText(uri: string): Promise<OcrLine[]>;
  /** The phone's verdict on the verifier's museum images; absent when the scan's features are not on this phone. */
  checkImages?(urls: string[]): Promise<ImageCheck | null>;
  onStage?(stage: LabelStage): void;
};

export const LABEL_ERROR_MESSAGES: Record<string, string> = {
  feature_off: 'Label reading is paused right now',
  spend_cap: 'Label reading is paused for today',
  rate_limited: 'Try again in a minute',
  model_error: 'Couldn’t read the label — try a sharper shot',
  model_unconfigured: 'Couldn’t read the label — try a sharper shot',
  bad_lines: 'Couldn’t read the label — try a sharper shot',
  nothing_read: 'Couldn’t read the label — try a sharper shot',
  label_flagged: 'This label couldn’t be accepted — try another photo',
  qr_host_not_allowed: 'That QR code doesn’t point to the museum’s collection',
  qr_no_artwork: 'That QR code doesn’t point to the museum’s collection',
  page_unavailable: 'Couldn’t open the museum’s page — try the label instead',
  scan_not_found: 'This scan is no longer available',
  scan_restarted: 'This scan is no longer available',
  network: 'No connection — try again when you’re back online',
};
const DEFAULT_MESSAGE = 'Couldn’t verify the label right now';

export class LabelFlowError extends Error {
  readonly code: string;
  constructor(code: string, options?: { cause?: unknown }) {
    super(LABEL_ERROR_MESSAGES[code] ?? DEFAULT_MESSAGE, options);
    this.name = 'LabelFlowError';
    this.code = code;
  }
}

export function toLabelFlowError(error: unknown): LabelFlowError {
  if (error instanceof LabelFlowError) return error;
  return new LabelFlowError(isNetworkError(error) ? 'network' : errorMessage(error), { cause: error });
}

export function toLabelInput(fields: LabelFields): LabelInput {
  const input: LabelInput = {};
  for (const name of ['title', 'artist', 'date', 'accession', 'medium', 'creditLine'] as const) {
    const value = fields[name]?.value;
    if (value) input[name] = value;
  }
  return input;
}

/**
 * The label flow on the phone: a QR code fetches the museum's page, otherwise the photo is read on the
 * phone and its lines sorted into fields; the fields are verified, and a museum image the phone confirms
 * upgrades the verification.
 */
export async function runLabelFlow(input: LabelFlowInput): Promise<LabelFlowDisplay> {
  const { scanId, api, onStage } = input;
  try {
    let flow: LabelFlowDisplay;
    if (input.qrUrl) {
      onStage?.('qr');
      flow = await api.fetchQr({ scanId, url: input.qrUrl });
    } else if (input.labelPhotoUri) {
      onStage?.('read');
      const lines = await input.readText(input.labelPhotoUri);
      if (!lines.length) throw new LabelFlowError('nothing_read');
      flow = await api.readLabel({ scanId, lines });
    } else {
      throw new LabelFlowError('nothing_read');
    }
    const fields = toLabelInput(flow.fields);
    if (Object.keys(fields).length === 0) throw new LabelFlowError('nothing_read');

    onStage?.('verify');
    let verified = await api.verifyLabel({ scanId, fields });
    const urls = verified.imageUrls ?? [];
    if (urls.length > 0 && input.checkImages) {
      onStage?.('image-check');
      const check = await input.checkImages(urls).catch((error: unknown) => {
        reportError(error, 'label.check_images', { level: 'warning' });
        console.warn('Image check failed; keeping the text verification', error);
        return null;
      });
      // Resending the verified values takes the server's no-search path, so this costs no credit.
      if (check?.homographyValid) verified = await api.verifyLabel({ scanId, fields: toLabelInput(verified.fields), imageCheck: check });
    }
    if (verified.moderation !== 'clear') throw new LabelFlowError('label_flagged');
    if (Object.keys(toLabelInput(verified.fields)).length === 0) throw new LabelFlowError('nothing_read');
    onStage?.('done');
    return verified;
  } catch (error) {
    throw toLabelFlowError(error);
  }
}
