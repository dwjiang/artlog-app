import { fakeOpenCV, type FakeOpenCVOptions } from "@/lib/image/opencv-fake";
import { BLUR_THRESHOLD, GLARE_LEVEL, GLARE_THRESHOLD, TRIAGE_SIZE, check, decide } from "./triage";

const mockBase64 = jest.fn();
jest.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    base64() {
      return mockBase64(this.uri);
    }
  },
}));

beforeEach(() => {
  mockBase64.mockReset();
  mockBase64.mockImplementation(async (uri: string) => `b64:${uri}`);
  jest.spyOn(console, "debug").mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("decide", () => {
  it("asks for a steadier shot below the blur threshold", () => {
    expect(decide({ blurVariance: BLUR_THRESHOLD - 1, glareFraction: 0 })).toEqual({
      ok: false,
      reason: "blur",
      message: "Hold steady and try again",
    });
    expect(decide({ blurVariance: BLUR_THRESHOLD, glareFraction: 0 })).toEqual({
      ok: true,
    });
  });

  it("asks to dodge glare above the highlight fraction", () => {
    expect(decide({ blurVariance: 2000, glareFraction: GLARE_THRESHOLD + 0.001 })).toEqual({
      ok: false,
      reason: "glare",
      message: "Adjust the angle to reduce glare",
    });
    expect(decide({ blurVariance: 2000, glareFraction: GLARE_THRESHOLD })).toEqual({ ok: true });
  });

  it("reports blur before glare when both fail", () => {
    expect(decide({ blurVariance: 0, glareFraction: 1 })).toMatchObject({
      reason: "blur",
    });
  });
});

describe("check", () => {
  function crop(options: FakeOpenCVOptions) {
    return fakeOpenCV({
      images: { "b64:file:///crop.jpg": { rows: 512, cols: 512, channels: 3 } },
      ...options,
    });
  }

  it("measures blur as the Laplacian variance and glare as the highlight fraction of the downscaled crop", async () => {
    const fake = crop({
      laplacianStddev: 45,
      highlightPixels: Math.round(TRIAGE_SIZE * TRIAGE_SIZE * 0.05),
    });
    await expect(check("file:///crop.jpg", fake.cv)).resolves.toEqual({
      ok: false,
      reason: "glare",
      message: "Adjust the angle to reduce glare",
    });
    expect(fake.calls).toContainEqual({
      name: "resize",
      args: [TRIAGE_SIZE, TRIAGE_SIZE, "INTER_AREA"],
    });
    expect(fake.calls).toContainEqual({
      name: "threshold",
      args: [GLARE_LEVEL - 1, 255, "THRESH_BINARY"],
    });
    expect(fake.leaked()).toEqual([]);
  });

  it("passes a sharp, glare-free crop and releases everything", async () => {
    const fake = crop({ laplacianStddev: 45, highlightPixels: 0 });
    await expect(check("file:///crop.jpg", fake.cv)).resolves.toEqual({
      ok: true,
    });
    expect(fake.leaked()).toEqual([]);
  });

  it("flags blur from a low Laplacian deviation", async () => {
    const fake = crop({ laplacianStddev: 5, highlightPixels: 0 });
    await expect(check("file:///crop.jpg", fake.cv)).resolves.toMatchObject({
      ok: false,
      reason: "blur",
    });
  });

  it("releases native objects when the crop cannot be decoded", async () => {
    const fake = fakeOpenCV({
      images: { "b64:file:///crop.jpg": { rows: 512, cols: 512, channels: 3 } },
      cvtColorError: new Error("bad image"),
    });
    await expect(check("file:///crop.jpg", fake.cv)).rejects.toThrow("bad image");
    expect(fake.leaked()).toEqual([]);
  });
});
