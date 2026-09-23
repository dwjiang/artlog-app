import { decode } from "cbor-x/decode";

export type Assertion = { signature: Uint8Array; authenticatorData: Uint8Array };

export type AuthenticatorData = { rpIdHash: Uint8Array; flags: number; counter: number };

export type AssertionCheck = {
  publicKeySpkiBase64: string;
  clientData: string;
  assertionBase64: string;
  expectedRpIdHash: Uint8Array;
  previousCounter: number;
};

export type AssertionResult = { ok: boolean; counter: number; reason?: string };

const textEncoder = new TextEncoder();

export function base64ToBytes(base64: string): Uint8Array {
  const normalized = base64.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? textEncoder.encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function asBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

export function decodeAssertion(base64: string): Assertion {
  let decoded: unknown;
  try {
    decoded = decode(base64ToBytes(base64));
  } catch {
    throw new Error("assertion is not valid CBOR");
  }
  const map = decoded as Record<string, unknown> | null;
  const signature = asBytes(map?.signature);
  const authenticatorData = asBytes(map?.authenticatorData);
  if (!signature || !authenticatorData)
    throw new Error("assertion is missing signature or authenticatorData");
  return { signature, authenticatorData };
}

export function parseAuthenticatorData(authData: Uint8Array): AuthenticatorData {
  if (authData.length < 37) throw new Error("authenticatorData is too short");
  const view = new DataView(authData.buffer, authData.byteOffset, authData.byteLength);
  return { rpIdHash: authData.slice(0, 32), flags: authData[32], counter: view.getUint32(33) };
}

function readDerInteger(der: Uint8Array, offset: number): { value: Uint8Array; next: number } {
  if (der[offset] !== 0x02) throw new Error("DER integer expected");
  const length = der[offset + 1];
  const start = offset + 2;
  if (!length || length > 33 || start + length > der.length) {
    throw new Error("invalid DER integer length");
  }
  if (der[start] & 0x80 || (length > 1 && der[start] === 0 && !(der[start + 1] & 0x80))) {
    throw new Error("DER integer must be minimally encoded and positive");
  }
  return { value: der.slice(start, start + length), next: start + length };
}

function leftPad(value: Uint8Array, size: number): Uint8Array {
  let trimmed = value;
  while (trimmed.length > size && trimmed[0] === 0) trimmed = trimmed.slice(1);
  if (trimmed.length > size) throw new Error("DER integer too large");
  const out = new Uint8Array(size);
  out.set(trimmed, size - trimmed.length);
  return out;
}

/** Converts an ASN.1 DER ECDSA signature `SEQUENCE { r INTEGER, s INTEGER }` to the raw r‖s form WebCrypto verifies. */
export function derToRaw(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error("DER sequence expected");
  // P-256 signatures fit in 72 bytes, so DER always uses a one-byte length.
  if (der.length < 8 || der.length > 72 || der[1] !== der.length - 2) {
    throw new Error("invalid DER sequence length");
  }
  const r = readDerInteger(der, 2);
  const s = readDerInteger(der, r.next);
  if (s.next !== der.length) throw new Error("trailing DER data");
  return concat(leftPad(r.value, 32), leftPad(s.value, 32));
}

export async function importAttestPublicKey(spkiBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    base64ToBytes(spkiBase64) as BufferSource,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

export function appIdHash(appId: string): Promise<Uint8Array> {
  return sha256(appId);
}

// Apple: nonce = SHA-256(authenticatorData ‖ SHA-256(clientData)); the ECDSA-SHA256 signature is over nonce.
export async function verifyAssertion(check: AssertionCheck): Promise<AssertionResult> {
  let assertion: Assertion;
  try {
    assertion = decodeAssertion(check.assertionBase64);
  } catch (error) {
    return { ok: false, counter: check.previousCounter, reason: (error as Error).message };
  }
  let authData: AuthenticatorData;
  try {
    authData = parseAuthenticatorData(assertion.authenticatorData);
  } catch (error) {
    return { ok: false, counter: check.previousCounter, reason: (error as Error).message };
  }
  if (!bytesEqual(authData.rpIdHash, check.expectedRpIdHash)) {
    return { ok: false, counter: authData.counter, reason: "rp_id_mismatch" };
  }
  if (authData.counter <= check.previousCounter) {
    return { ok: false, counter: authData.counter, reason: "counter_not_increasing" };
  }
  let rawSignature: Uint8Array;
  try {
    rawSignature = derToRaw(assertion.signature);
  } catch (error) {
    return { ok: false, counter: authData.counter, reason: (error as Error).message };
  }
  const nonce = await sha256(concat(assertion.authenticatorData, await sha256(check.clientData)));
  let key: CryptoKey;
  try {
    key = await importAttestPublicKey(check.publicKeySpkiBase64);
  } catch {
    return { ok: false, counter: authData.counter, reason: "invalid_public_key" };
  }
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    rawSignature as BufferSource,
    nonce as BufferSource,
  );
  return valid
    ? { ok: true, counter: authData.counter }
    : { ok: false, counter: authData.counter, reason: "invalid_signature" };
}
