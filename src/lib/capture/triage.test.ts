import type { OpenCVFeatures, TriageMetrics } from "../../../modules/opencv-features/src";
import { BLUR_THRESHOLD, GLARE_LEVEL, GLARE_THRESHOLD, TRIAGE_SIZE, check, decide } from "./triage";

beforeEach(() => {
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
  it("decides from the metrics of the crop file at the triage size and glare level", async () => {
    const metrics: TriageMetrics = { blurVariance: 2000, glareFraction: GLARE_THRESHOLD + 0.01 };
    const native = { detectOrb: jest.fn(), measureTriage: jest.fn(async () => metrics) } satisfies OpenCVFeatures;
    await expect(check("file:///crops/a%20b.jpg", native)).resolves.toEqual({
      ok: false,
      reason: "glare",
      message: "Adjust the angle to reduce glare",
    });
    expect(native.measureTriage).toHaveBeenCalledWith("/crops/a b.jpg", TRIAGE_SIZE, GLARE_LEVEL);
  });
});
