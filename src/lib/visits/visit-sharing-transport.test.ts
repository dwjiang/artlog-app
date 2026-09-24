import { createVisitSharingTransport } from "./visit-sharing-transport";

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));

it("uses the captured token and abort signal for all four sharing operations", async () => {
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
  };
  await transport.getState({ visitLocalId: "visit" }, context);
  await transport.preview(args, context);
  await transport.publish(args, context);
  await transport.get({ postId: "post" }, context);
  expect(fetcher.mock.calls.map(([, options]) => JSON.parse(options.body).path)).toEqual([
    "sharedVisits:getState",
    "sharedVisits:preview",
    "sharedVisits:publish",
    "sharedVisits:get",
  ]);
  for (const [, options] of fetcher.mock.calls) {
    expect(options).toMatchObject({
      signal: context.signal,
      headers: { Authorization: "Bearer captured-token" },
    });
  }
});
