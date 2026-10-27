// Vercel Functions reject request bodies over 4.5 MB before the handler runs.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
