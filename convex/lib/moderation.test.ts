import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { completion } from "./labelFixtures";
import { blocklistFlags, checkText, flaggedUserTexts } from "./moderation";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEBIUS_API_KEY", "k");
  vi.stubEnv("MODERATION_MODEL", "nvidia/Nemotron-3_5-Lightning");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("text moderation", () => {
  it("asks the moderation model with the fields as data and returns its verdict", async () => {
    fetchMock.mockResolvedValueOnce(completion({ flagged: true }));
    await expect(checkText(["Title", null, "Gift of Someone"])).resolves.toEqual({
      flagged: true,
      method: "model",
      calls: 1,
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.model).toBe("nvidia/Nemotron-3_5-Lightning");
    expect(JSON.parse(body.messages[1].content)).toMatchObject({
      input: "Title\nGift of Someone",
    });
    expect(body.response_format.json_schema.name).toBe("moderation");
  });

  it("falls back to the blocklist when the model fails, keeping the spent call count", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response("down", { status: 500 }));
    const pending = checkText(["Water Lilies", "Claude Monet"]);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual({
      flagged: false,
      method: "blocklist",
      calls: 2,
    });
    const flagged = checkText(["Call me at 415-555-0123"]);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(flagged).resolves.toEqual({
      flagged: true,
      method: "blocklist",
      calls: 2,
    });
    vi.useRealTimers();
  });

  it("uses the blocklist alone when no model is configured and skips empty input", async () => {
    vi.stubEnv("MODERATION_MODEL", "");
    await expect(checkText(["donor@example.org"])).resolves.toEqual({
      flagged: true,
      method: "blocklist",
      calls: 0,
    });
    await expect(checkText([" ", null, undefined])).resolves.toEqual({
      flagged: false,
      method: "blocklist",
      calls: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flags personal information patterns but not accession numbers, years or credit lines", () => {
    expect(blocklistFlags("Gift of Louise Reinhardt Smith, 1983\n1998.325.2\nFrench, 1840–1926")).toBe(false);
    expect(blocklistFlags("(415) 555 0123")).toBe(true);
    expect(blocklistFlags("4111 1111 1111 1111")).toBe(true);
    expect(blocklistFlags("078-05-1120")).toBe(true);
    expect(blocklistFlags("someone@museum.example")).toBe(true);
  });

  it("honors operator blocklist terms as whole phrases", () => {
    vi.stubEnv("MODERATION_BLOCKLIST", "badword, worse phrase");
    expect(blocklistFlags("A BadWord in the title")).toBe(true);
    expect(blocklistFlags("Worse phrase here")).toBe(true);
    expect(blocklistFlags("badwords are not matched")).toBe(false);
  });
});

describe("shared text moderation", () => {
  const verdicts = (...flags: boolean[]) => Response.json({ results: flags.map((flagged) => ({ flagged })) });
  beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "test-openai-key"));

  it("follows OpenAI over the word list after swapping linked record titles out", async () => {
    fetchMock.mockResolvedValueOnce(verdicts(false, false, false, true));
    await expect(
      flaggedUserTexts(
        [
          "The vagina imagery in The Dinner Party",
          "PAY ATTENTION MOTHERFUCKERS is still loud in person",
          "Show me more like this",
          "you idiot",
        ],
        ["Pay Attention Motherfuckers", "Me"],
      ),
    ).resolves.toEqual([false, false, false, true]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/moderations");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "omni-moderation-latest",
      input: [
        "The vagina imagery in The Dinner Party",
        "the artwork is still loud in person",
        "Show me more like this",
        "you idiot",
      ],
    });
  });

  it("falls back to the word list when OpenAI fails, times out, answers oddly or is not configured", async () => {
    const failures = [
      async () => new Response("down", { status: 500 }),
      async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
      async () => Response.json({ results: [] }),
    ];
    for (const failure of failures) {
      fetchMock.mockImplementationOnce(failure);
      await expect(flaggedUserTexts(["What a load of shit", "Water Lilies"], [])).resolves.toEqual([true, false]);
    }
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(
      flaggedUserTexts(["fuck you", "Pay Attention Motherfuckers is loud"], ["Pay Attention Motherfuckers"]),
    ).resolves.toEqual([true, false]);
    expect(fetchMock).toHaveBeenCalledTimes(failures.length);
  });

  it("blocks slurs and the strongest swearing that OpenAI lets through, without asking about them", async () => {
    fetchMock.mockResolvedValueOnce(verdicts(false));
    await expect(
      flaggedUserTexts(["fuck this museum", "Water Lilies", "what a faggot"], ["Pay Attention Motherfuckers"]),
    ).resolves.toEqual([true, false, true]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).input).toEqual(["Water Lilies"]);
  });

  it("passes empty text without asking OpenAI", async () => {
    await expect(flaggedUserTexts(["", "  "], [])).resolves.toEqual([false, false]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
