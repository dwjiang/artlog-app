# Native spike evidence (2026-09-09)

See [decision 006](../../../docs/decisions/006-native-modules.md) for conclusions
and downstream acceptance gates. Native code was disposable; no native implementation is included here.

- `device-run.log`: recovered iPhone 16 Pro run; attestation/assertion/key-ID logs
  omitted and app-container paths replaced. The ORB/camera failures are retained.
- `device-retry.log`: successful permission-aware camera/QR, ORB and five-minute thermal rerun; repeated QR callbacks are collapsed to one entry.
- `device-retry-results.json`: camera window aggregates, all eleven thermal/battery readings, QR callback count and measurement limits.
- `camera-capture-trials.log`: three full-resolution captures with no rectangle; the inspected first image was nearly black, so these do not establish artwork quality or warp latency.
- `convex-runtime.json`: initial synthetic default-runtime action result from the isolated local
  Convex deployment, using `jose` 6.2.12 and Convex 1.45.0.
- `convex-real-apple.json`: real native Apple token signature/issuer/audience verification and wrong-audience rejection in the same default runtime. Token and account identifiers are excluded.
- `app-attest-results.json`: decoded metadata and actual signature-check results.
- `app-attest-assertion.json`: public-key assertion fixture. `clientData` is the
  exact UTF-8 string passed to Expo; the DER and P1363 signatures encode the
  same signature. It is useful for a real-device regression test in plan 04.04.

Verify the signature independently with Node's built-in crypto (from repo root):

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
const f = JSON.parse(readFileSync('spikes/native-modules/notes/app-attest-assertion.json', 'utf8'));
const b64 = value => Buffer.from(value, 'base64');
const hash = value => createHash('sha256').update(value).digest();
const data = b64(f.authenticatorDataBase64);
const key = await webcrypto.subtle.importKey('spki', b64(f.publicKeySpkiBase64),
  { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
const check = message => webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' },
  key, b64(f.signatureP1363Base64), message);
const joined = Buffer.concat([data, hash(f.clientData)]);
assert.equal(await check(hash(joined)), true);
assert.equal(await check(joined), false);
assert.equal(await check(hash(Buffer.concat([data, hash(f.clientData + '!')]))), false);
assert.equal(data.subarray(0, 32).equals(hash(f.appId)), true);
assert.equal(data.readUInt32BE(33), f.expectedCounter);
console.log('Real device assertion: signature, wrong-message and changed-payload checks pass');
JS
```

These checks do not establish certificate trust, challenge freshness, or server
replay protection. The fixture contains no private key or Apple account token.

## Crops and sources

The two 512×512 JPEGs were produced on the iPhone by the disposable Swift
`CIPerspectiveCorrection` / CGContext pipeline and inspected on the Mac:

- `orsay-wrong-inner-crop.jpg`: photograph by Jean-François Gornet; this cropped, warped and letterboxed derivative is licensed [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/). The 40% inner heuristic chose the sky and cut off
  the foreground. Source: [Deux visiteurs devant une toile, Musée d'Orsay, 2008](https://commons.wikimedia.org/wiki/File:Deux_visiteurs_devant_une_toile,_Mus%C3%A9e_d%27Orsay,_2008.jpg).
- `pinakothek-outer-crop.jpg`: photograph by Wikimedia Commons user Mattes; this cropped, warped and letterboxed derivative is licensed [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). Full selected painting with the outer frame retained.
  Source: [Alte Pinakothek – Room XIII](https://commons.wikimedia.org/wiki/File:Alte_Pinakothek_-_Room_XIII.JPG).

Other tested source photos:
[Alte Pinakothek – Saal IX](https://commons.wikimedia.org/wiki/File:Alte_Pinakothek-Saal_IX.JPG),
[Abraham ontvangt de drie engelen](https://commons.wikimedia.org/wiki/File:Abraham_ontvangt_de_drie_engelen_Rijksmuseum_SK-A-1577.jpeg).
The strict and loose detector parameters and individual timings are in the
record. Live-camera throughput is established separately by the rerun; these crops do not prove full-resolution capture latency or correct live artwork boundaries.
