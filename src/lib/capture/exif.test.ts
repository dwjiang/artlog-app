import { execFileSync } from "node:child_process";

import { extractCaptureMeta } from "./exif";

it("reads flat iOS metadata and southern/western hemispheres", () => {
  expect(
    extractCaptureMeta({
      GPSLatitude: 33.86,
      GPSLatitudeRef: "S",
      GPSLongitude: 151.21,
      GPSLongitudeRef: "W",
      DateTimeOriginal: "2026:09:08 12:34:56",
    }),
  ).toEqual({ lat: -33.86, lng: -151.21, capturedAt: new Date(2026, 8, 8, 12, 34, 56).getTime() });
});

it("reads nested Apple dictionaries and DMS coordinates", () => {
  expect(
    extractCaptureMeta({
      "{GPS}": {
        Latitude: [37, 30, 0],
        LatitudeRef: "N",
        Longitude: [122, 15, 0],
        LongitudeRef: "W",
      },
      "{Exif}": { DateTimeOriginal: "2026:09:08 12:34:56", OffsetTimeOriginal: "-07:00" },
    }),
  ).toEqual({ lat: 37.5, lng: -122.25, capturedAt: Date.parse("2026-09-08T12:34:56-07:00") });
});

it.each(["America/Los_Angeles", "UTC"])(
  "preserves an offset timestamp across the local DST gap in %s",
  (timezone) => {
    const result = execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "-e",
        `const { extractCaptureMeta } = require(${JSON.stringify(require.resolve("./exif"))});
     process.stdout.write(JSON.stringify(extractCaptureMeta({
       DateTimeOriginal: '2026:03:08 02:30:00', OffsetTimeOriginal: '+01:00',
     })));`,
      ],
      { encoding: "utf8", env: { ...process.env, TZ: timezone } },
    );

    expect(JSON.parse(result)).toEqual({ capturedAt: Date.parse("2026-03-08T01:30:00Z") });
  },
);

it("preserves signed coordinates and accepts zero", () => {
  expect(extractCaptureMeta({ GPSLatitude: 0, GPSLongitude: -122.5 })).toMatchObject({
    lat: 0,
    lng: -122.5,
  });
});

it.each([
  null,
  undefined,
  {},
  { GPSLatitude: "no", GPSLongitude: Infinity, DateTimeOriginal: "not a date" },
  { GPSLatitude: 91, GPSLongitude: -181, DateTimeOriginal: "2026:02:30 10:00:00" },
  { DateTimeOriginal: "2026:02:30 10:00:00", OffsetTimeOriginal: "+01:00" },
  { DateTimeOriginal: "1904:01:01 00:00:00" },
  { DateTimeOriginal: "1969:12:31 23:59:59", OffsetTimeOriginal: "+00:00" },
])("omits missing/invalid values and defaults the time: %s", (exif) => {
  jest.spyOn(Date, "now").mockReturnValue(1234);
  expect(extractCaptureMeta(exif)).toEqual({ capturedAt: 1234 });
  jest.restoreAllMocks();
});
