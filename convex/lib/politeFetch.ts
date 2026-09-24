const REPO_URL = "https://github.com/dwjiang/artlog-app";

export function userAgent(): string {
  const contact = process.env.CRAWLER_CONTACT;
  return `artlog-bot/0.1 (+${REPO_URL}${contact ? `; mailto:${contact}` : ""})`;
}

export async function readBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Response too large");
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
}

export type FetchedText = { status: number; headers: Headers; body: string };

// One timer covers headers and body so a stalled body cannot hang the action.
export async function fetchText(
  url: string,
  init: RequestInit,
  options: { timeoutMs: number; maxBytes: number },
): Promise<FetchedText> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await readBody(response, options.maxBytes);
    return { status: response.status, headers: response.headers, body };
  } finally {
    clearTimeout(timer);
  }
}
