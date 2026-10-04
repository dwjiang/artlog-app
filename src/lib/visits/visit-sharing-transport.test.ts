import { createVisitSharingTransport } from "./visit-sharing-transport";

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));

it("uses the captured token and abort signal for every sharing operation", async () => {
  const fetcher = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: "success", value: null }),
  });
  const transport = createVisitSharingTransport("https://example.convex.cloud", fetcher);
  const context = {
    token: "captured-token",
    signal: new AbortController().signal,
  };
  const args = {
    audience: "public" as const,
    visitLocalId: "visit",
    saveLocalIds: [],
    reflection: "",
    revision: 0,
    color: "#FCFCF9",
  };
  await transport.getState({ visitLocalId: "visit" }, context);
  await transport.publish(args, context);
  expect(fetcher.mock.calls.map(([, options]) => JSON.parse(options.body).path)).toEqual([
    "sharedVisits:getState",
    "sharedVisits:publish",
  ]);
  for (const [, options] of fetcher.mock.calls) {
    expect(options).toMatchObject({
      signal: context.signal,
      headers: { Authorization: "Bearer captured-token" },
    });
  }
});
