import { bytesToBase64, concat, sha256 } from "./appAttest";

// Definite-length CBOR, the layout Apple uses for `{ signature, authenticatorData }`.
function cborBytes(bytes: Uint8Array): Uint8Array {
  const header =
    bytes.length < 24
      ? [0x40 | bytes.length]
      : bytes.length < 256
        ? [0x58, bytes.length]
        : [0x59, bytes.length >> 8, bytes.length & 0xff];
  return concat(Uint8Array.from(header), bytes);
}

function cborText(text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  return concat(Uint8Array.from([0x60 | bytes.length]), bytes);
}

export function encodeAssertion(
  signature: Uint8Array,
  authenticatorData: Uint8Array,
): Uint8Array {
  return concat(
    Uint8Array.from([0xa2]),
    cborText("signature"),
    cborBytes(signature),
    cborText("authenticatorData"),
    cborBytes(authenticatorData),
  );
}

function derInteger(bytes: Uint8Array): Uint8Array {
  let body = bytes;
  while (body.length > 1 && body[0] === 0 && !(body[1] & 0x80)) {
    body = body.slice(1);
  }
  if (body[0] & 0x80) body = concat(Uint8Array.from([0]), body);
  return concat(Uint8Array.from([0x02, body.length]), body);
}

export function rawToDer(raw: Uint8Array): Uint8Array {
  const body = concat(derInteger(raw.slice(0, 32)), derInteger(raw.slice(32)));
  return concat(Uint8Array.from([0x30, body.length]), body);
}

export function authenticatorData(
  rpIdHash: Uint8Array,
  counter: number,
): Uint8Array {
  const out = new Uint8Array(37);
  out.set(rpIdHash);
  out[32] = 0x40;
  new DataView(out.buffer).setUint32(33, counter);
  return out;
}

export type Signer = { privateKey: CryptoKey; publicKeySpkiBase64: string };

export async function makeSigner(): Promise<Signer> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const spki = new Uint8Array(
    await crypto.subtle.exportKey("spki", pair.publicKey),
  );
  return {
    privateKey: pair.privateKey,
    publicKeySpkiBase64: bytesToBase64(spki),
  };
}

export async function signAssertion(
  signer: Signer,
  authData: Uint8Array,
  clientData: string,
): Promise<string> {
  const nonce = await sha256(concat(authData, await sha256(clientData)));
  const raw = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      signer.privateKey,
      nonce as BufferSource,
    ),
  );
  return bytesToBase64(encodeAssertion(rawToDer(raw), authData));
}
