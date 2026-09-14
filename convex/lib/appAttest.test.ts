import { describe, expect, it } from 'vitest';

import phoneFixture from './fixtures/app-attest-assertion.json';

import {
  base64ToBytes,
  bytesToBase64,
  bytesToBase64Url,
  decodeAssertion,
  derToRaw,
  parseAuthenticatorData,
  sha256,
  verifyAssertion,
} from './appAttest';
import {
  authenticatorData,
  encodeAssertion,
  makeSigner,
  rawToDer,
  signAssertion,
} from './appAttest.fixtures';

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));

describe('base64', () => {
  it('round-trips standard and url-safe alphabets', () => {
    const bytes = Uint8Array.from([0xfb, 0xff, 0xbf, 0x00, 0x01]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(bytesToBase64Url(bytes)).not.toMatch(/[+/=]/);
    expect(base64ToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
  });
});

describe('derToRaw', () => {
  it('strips the sign padding byte and left-pads short integers on a known vector', () => {
    const r = 'ff' + '11'.repeat(31);
    const s = '01'.repeat(31);
    const der = hex('30' + '44' + '02' + '21' + '00' + r + '02' + '1f' + s);
    expect(bytesToBase64(derToRaw(der))).toBe(bytesToBase64(hex(r + '00' + s)));
  });

  it('inverts the fixture encoder for random signatures', () => {
    const raw = crypto.getRandomValues(new Uint8Array(64));
    expect(derToRaw(rawToDer(raw))).toEqual(raw);
  });

  it('rejects input that is not a DER sequence', () => {
    expect(() => derToRaw(hex('0201ff'))).toThrow('DER sequence expected');
  });

  it.each([
    '3007020101020101', // Wrong sequence length.
    '300602010102010100', // Trailing bytes.
    '3006020101020201', // Truncated integer.
    '3006020180020101', // Negative integer.
    '300702020001020101', // Redundant sign padding.
    '30050200020101', // Empty integer.
  ])('rejects malformed DER %s', (der) => {
    expect(() => derToRaw(hex(der))).toThrow();
  });
});

describe('decodeAssertion', () => {
  it('decodes the two byte strings Apple returns', () => {
    const signature = Uint8Array.from([1, 2, 3]);
    const authData = authenticatorData(new Uint8Array(32), 7);
    const decoded = decodeAssertion(bytesToBase64(encodeAssertion(signature, authData)));
    expect(decoded.signature).toEqual(signature);
    expect(decoded.authenticatorData).toEqual(authData);
    expect(parseAuthenticatorData(decoded.authenticatorData).counter).toBe(7);
  });

  it('rejects malformed input', () => {
    expect(() => decodeAssertion('AAAA')).toThrow();
    expect(() => decodeAssertion(bytesToBase64(Uint8Array.from([0xa0])))).toThrow(
      'missing signature'
    );
  });
});

describe('verifyAssertion', () => {
  const appId = 'TEAMID.app.artlog.ios';

  it('verifies the real Expo iPhone assertion and rejects payload changes', async () => {
    const check = {
      publicKeySpkiBase64: phoneFixture.publicKeySpkiBase64,
      clientData: phoneFixture.clientData,
      assertionBase64: bytesToBase64(encodeAssertion(
        base64ToBytes(phoneFixture.signatureDerBase64),
        base64ToBytes(phoneFixture.authenticatorDataBase64)
      )),
      expectedRpIdHash: await sha256(phoneFixture.appId),
      previousCounter: phoneFixture.previousCounter,
    };
    expect(await verifyAssertion(check)).toEqual({ ok: true, counter: phoneFixture.expectedCounter });
    expect(await verifyAssertion({ ...check, clientData: `${check.clientData} ` })).toMatchObject({
      ok: false, reason: 'invalid_signature',
    });
  });

  it('accepts the published node-app-attest assertion vector independently of our signer', async () => {
    // Cryptographic test data from node-app-attest/test/verifyAssertion.test.js.
    const result = await verifyAssertion({
      assertionBase64: 'omlzaWduYXR1cmVYRzBFAiBB8BGAwkmFCg1M5J0mOYEun0SUN1/lse79/7ypG9WiMQIhAIHvqj7eg59B1PMFX1CN4GMGlsgfFtdL30pHCf7G/dNRcWF1dGhlbnRpY2F0b3JEYXRhWCXKPdw7T3iujcFZbHVrHX0mDSMrNms5PzEbrFbQPRA6rEAAAAAB',
      publicKeySpkiBase64: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEg69t2YzgcPTLUx8Zgu+rbcikeaEL8Ppb+HG0QTIulz8YUB9tgv1pDRruWk87nZC3our56pzIWaqXEbaWyamdzA==',
      clientData: '{"subject":"Lorem ipsum","message":"Lorem ipsum dolor sit amet, consectetur adipiscing elit."}',
      expectedRpIdHash: await sha256('V8H6LQ9448.io.uebelacker.AppAttestExample'),
      previousCounter: 0,
    });
    expect(result).toEqual({ ok: true, counter: 1 });
  });

  it('accepts a signature over authData ‖ sha256(clientData) with an increasing counter', async () => {
    const signer = await makeSigner();
    const rpIdHash = await sha256(appId);
    const clientData = 'nonce.{"objectId":"abc"}';
    const assertionBase64 = await signAssertion(signer, authenticatorData(rpIdHash, 1), clientData);

    const result = await verifyAssertion({
      publicKeySpkiBase64: signer.publicKeySpkiBase64,
      clientData,
      assertionBase64,
      expectedRpIdHash: rpIdHash,
      previousCounter: 0,
    });
    expect(result).toEqual({ ok: true, counter: 1 });
  });

  it('rejects a tampered payload, a stale counter, a foreign key and a foreign app id', async () => {
    const signer = await makeSigner();
    const other = await makeSigner();
    const rpIdHash = await sha256(appId);
    const clientData = 'nonce.{"objectId":"abc"}';
    const assertionBase64 = await signAssertion(signer, authenticatorData(rpIdHash, 5), clientData);
    const base = {
      publicKeySpkiBase64: signer.publicKeySpkiBase64,
      clientData,
      assertionBase64,
      expectedRpIdHash: rpIdHash,
      previousCounter: 4,
    };

    expect(await verifyAssertion({ ...base, clientData: 'nonce.{"objectId":"xyz"}' })).toMatchObject({
      ok: false,
      reason: 'invalid_signature',
    });
    expect(await verifyAssertion({ ...base, previousCounter: 5 })).toMatchObject({
      ok: false,
      reason: 'counter_not_increasing',
    });
    expect(
      await verifyAssertion({ ...base, publicKeySpkiBase64: other.publicKeySpkiBase64 })
    ).toMatchObject({ ok: false, reason: 'invalid_signature' });
    expect(
      await verifyAssertion({ ...base, expectedRpIdHash: await sha256('OTHER.app') })
    ).toMatchObject({ ok: false, reason: 'rp_id_mismatch' });
  });

  it('reports undecodable assertions instead of throwing', async () => {
    const result = await verifyAssertion({
      publicKeySpkiBase64: '',
      clientData: 'x',
      assertionBase64: 'AAAA',
      expectedRpIdHash: new Uint8Array(32),
      previousCounter: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('CBOR');
  });
});
