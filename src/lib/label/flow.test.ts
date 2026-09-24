import { ConvexError } from "convex/values";

import type { Id } from "../../../convex/_generated/dataModel";
import type { LabelFlowDisplay } from "../../../convex/lib/validators";
import {
  LabelFlowError,
  runLabelFlow,
  toLabelInput,
  type LabelApi,
  type LabelStage,
} from "./flow";

const scanId = "scan-1" as Id<"scans">;

function flow(
  partial: Partial<LabelFlowDisplay> & Pick<LabelFlowDisplay, "stage">,
): LabelFlowDisplay {
  return {
    fields: {},
    evidence: [],
    warnings: [],
    moderation: "clear",
    updatedAt: 1,
    ...partial,
  };
}

const read = flow({
  stage: "read",
  fields: {
    title: { value: "Water Lilies", evidence: "ocr", locked: false },
    artist: { value: "Claude Monet", evidence: "ocr", locked: false },
  },
});
const qr = flow({
  stage: "qr",
  evidence: ["qr"],
  sourceUrl: "https://museum.example/objects/1",
  fields: {
    title: { value: "Water Lilies", evidence: "qr", locked: true },
    artist: { value: "Claude Monet", evidence: "qr", locked: true },
  },
});
const verified = flow({
  stage: "verified",
  evidence: ["tavily"],
  imageUrls: ["https://museum.example/a.jpg", "https://museum.example/b.jpg"],
  fields: {
    title: { value: "Water Lilies", evidence: "tavily", locked: true },
    artist: { value: "Claude Monet", evidence: "tavily", locked: true },
    date: { value: "1916", evidence: "ocr", locked: false },
  },
});
const upgraded = flow({ ...verified, evidence: ["tavily+image"] });

function fakeApi() {
  return {
    fetchQr: jest.fn<Promise<LabelFlowDisplay>, [unknown]>(async () => qr),
    readLabel: jest.fn<Promise<LabelFlowDisplay>, [unknown]>(async () => read),
    verifyLabel: jest.fn<Promise<LabelFlowDisplay>, [unknown]>(
      async () => verified,
    ),
  } satisfies LabelApi;
}

const lines = [
  { text: "Claude Monet", confidence: 1 },
  { text: "Water Lilies", confidence: 1 },
];
const readText = jest.fn(async () => lines);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it("reads the photo, verifies what was read and reports the stages in order", async () => {
  const api = fakeApi();
  const stages: LabelStage[] = [];
  const result = await runLabelFlow({
    scanId,
    labelPhotoUri: "file:///tmp/label.jpg",
    api,
    readText,
    onStage: (stage) => stages.push(stage),
  });
  expect(readText).toHaveBeenCalledWith("file:///tmp/label.jpg");
  expect(api.readLabel).toHaveBeenCalledWith({ scanId, lines });
  expect(api.verifyLabel).toHaveBeenCalledTimes(1);
  expect(api.verifyLabel).toHaveBeenCalledWith({
    scanId,
    fields: { title: "Water Lilies", artist: "Claude Monet" },
  });
  expect(api.fetchQr).not.toHaveBeenCalled();
  expect(stages).toEqual(["read", "verify", "done"]);
  expect(result).toBe(verified);
});

it("a QR code fetches the museum page instead of reading", async () => {
  const api = fakeApi();
  const stages: LabelStage[] = [];
  await runLabelFlow({
    scanId,
    qrUrl: "https://museum.example/qr/1",
    labelPhotoUri: "file:///tmp/label.jpg",
    api,
    readText,
    onStage: (stage) => stages.push(stage),
  });
  expect(api.fetchQr).toHaveBeenCalledWith({
    scanId,
    url: "https://museum.example/qr/1",
  });
  expect(api.readLabel).not.toHaveBeenCalled();
  expect(readText).not.toHaveBeenCalled();
  expect(api.verifyLabel).toHaveBeenCalledWith({
    scanId,
    fields: { title: "Water Lilies", artist: "Claude Monet" },
  });
  expect(stages).toEqual(["qr", "verify", "done"]);
});

it.each([
  [
    "a valid homography",
    {
      url: "https://museum.example/b.jpg",
      cosine: 0.93,
      homographyValid: true,
    },
    2,
  ],
  [
    "a failed homography",
    {
      url: "https://museum.example/b.jpg",
      cosine: 0.93,
      homographyValid: false,
    },
    1,
  ],
  ["no image near the scan", null, 1],
])(
  "compares the verifier’s images and re-verifies only after %s",
  async (_case, check, verifyCalls) => {
    const api = fakeApi();
    api.verifyLabel
      .mockResolvedValueOnce(verified)
      .mockResolvedValueOnce(upgraded);
    const checkImages = jest.fn(async () => check);
    const stages: LabelStage[] = [];
    const result = await runLabelFlow({
      scanId,
      labelPhotoUri: "file:///tmp/label.jpg",
      api,
      readText,
      checkImages,
      onStage: (stage) => stages.push(stage),
    });
    expect(checkImages).toHaveBeenCalledWith([
      "https://museum.example/a.jpg",
      "https://museum.example/b.jpg",
    ]);
    expect(api.verifyLabel).toHaveBeenCalledTimes(verifyCalls);
    expect(stages).toEqual(["read", "verify", "image-check", "done"]);
    if (verifyCalls === 2) {
      // The verified values go back unchanged (including the date the verifier added), so the server skips its searches.
      expect(api.verifyLabel).toHaveBeenLastCalledWith({
        scanId,
        fields: { title: "Water Lilies", artist: "Claude Monet", date: "1916" },
        imageCheck: check,
      });
      expect(result).toBe(upgraded);
    } else {
      expect(result).toBe(verified);
    }
  },
);

it("skips the image check without images or without the scan’s features and survives a failing check", async () => {
  const api = fakeApi();
  api.verifyLabel.mockResolvedValue(
    flow({ ...verified, imageUrls: undefined }),
  );
  const checkImages = jest.fn(async () => null);
  await runLabelFlow({
    scanId,
    labelPhotoUri: "file:///tmp/label.jpg",
    api,
    readText,
    checkImages,
  });
  expect(checkImages).not.toHaveBeenCalled();

  api.verifyLabel.mockResolvedValue(verified);
  const stagesWithoutFeatures: LabelStage[] = [];
  await runLabelFlow({
    scanId,
    labelPhotoUri: "file:///tmp/label.jpg",
    api,
    readText,
    onStage: (stage) => stagesWithoutFeatures.push(stage),
  });
  expect(stagesWithoutFeatures).toEqual(["read", "verify", "done"]);

  const failing = jest.fn(async () => {
    throw new Error("download failed");
  });
  const result = await runLabelFlow({
    scanId,
    labelPhotoUri: "file:///tmp/label.jpg",
    api,
    readText,
    checkImages: failing,
  });
  expect(result).toBe(verified);
  expect(console.warn).toHaveBeenCalledWith(
    "Image check failed; keeping the text verification",
    expect.any(Error),
  );
});

it("stops with the sharper-shot message when the reader found nothing", async () => {
  const api = fakeApi();
  api.readLabel.mockResolvedValue(
    flow({ stage: "read", moderation: "flagged" }),
  );
  await expect(
    runLabelFlow({
      scanId,
      labelPhotoUri: "file:///tmp/label.jpg",
      api,
      readText,
    }),
  ).rejects.toMatchObject({
    name: "LabelFlowError",
    code: "nothing_read",
    message: "Couldn’t read the label — try a sharper shot",
  });
  expect(api.verifyLabel).not.toHaveBeenCalled();
  await expect(runLabelFlow({ scanId, api, readText })).rejects.toMatchObject({
    code: "nothing_read",
  });
});

it("sends nothing when the phone recognizes no text on the photo", async () => {
  const api = fakeApi();
  readText.mockResolvedValueOnce([]);
  await expect(
    runLabelFlow({
      scanId,
      labelPhotoUri: "file:///tmp/label.jpg",
      api,
      readText,
    }),
  ).rejects.toMatchObject({ code: "nothing_read" });
  expect(api.readLabel).not.toHaveBeenCalled();
});

it.each([
  [
    new ConvexError({ code: "feature_off" }),
    "feature_off",
    "Label reading is paused right now",
  ],
  [
    new ConvexError({ code: "rate_limited", retryAfter: 60_000 }),
    "rate_limited",
    "Try again in a minute",
  ],
  [
    new ConvexError({ code: "model_error" }),
    "model_error",
    "Couldn’t read the label — try a sharper shot",
  ],
  [
    new ConvexError({ code: "qr_no_artwork" }),
    "qr_no_artwork",
    "That QR code doesn’t point to the museum’s collection",
  ],
  [
    new Error("Network request failed"),
    "network",
    "No connection — try again when you’re back online",
  ],
  [
    new ConvexError({ code: "something_new" }),
    "something_new",
    "Couldn’t verify the label right now",
  ],
])("maps %s to a user message", async (error, code, message) => {
  const api = fakeApi();
  api.readLabel.mockRejectedValue(error);
  const failure = await runLabelFlow({
    scanId,
    labelPhotoUri: "file:///tmp/label.jpg",
    api,
    readText,
  }).catch((e: unknown) => e);
  expect(failure).toBeInstanceOf(LabelFlowError);
  expect(failure).toMatchObject({ code, message, cause: error });
});

it("turns the reader’s fields into the verifier’s input, dropping blanks", () => {
  expect(
    toLabelInput({
      title: { value: "Water Lilies", evidence: "ocr", locked: false },
      artist: { value: "", evidence: "ocr", locked: false },
      creditLine: {
        value: "Gift of Louise Reinhardt Smith",
        evidence: "ocr",
        locked: false,
      },
    }),
  ).toEqual({
    title: "Water Lilies",
    creditLine: "Gift of Louise Reinhardt Smith",
  });
});

it("rejects a moderated verification without reporting completion", async () => {
  const api = fakeApi();
  api.verifyLabel.mockResolvedValue(
    flow({ stage: "verified", moderation: "flagged" }),
  );
  const stages: LabelStage[] = [];
  await expect(
    runLabelFlow({
      scanId,
      qrUrl: "https://museum.example/qr/1",
      api,
      readText,
      onStage: (stage) => stages.push(stage),
    }),
  ).rejects.toMatchObject({ code: "label_flagged" });
  expect(stages).not.toContain("done");
});
