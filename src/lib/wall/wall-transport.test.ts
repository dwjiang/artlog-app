import { createWallTransport } from "./wall-transport";

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));

it("sends one abortable HTTP mutation with the captured token and scope", async () => {
  const controller = new AbortController();
  const fetcher = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: "success", value: null }),
  });
  const transport = createWallTransport("https://example.convex.cloud", fetcher);
  await transport.setLayout(
    { scope: "account:a:1", revision: 0, color: "#45524B", items: [] },
    { token: "captured-token", signal: controller.signal },
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe("https://example.convex.cloud/api/mutation");
  expect(options).toMatchObject({
    method: "POST",
    signal: controller.signal,
    headers: { Authorization: "Bearer captured-token" },
  });
  expect(JSON.parse(options.body)).toMatchObject({
    path: "walls:setLayout",
    args: [{ scope: "account:a:1" }],
  });
});

it("does not retry a failed network request and preserves conflict error codes", async () => {
  const fetcher = jest.fn().mockRejectedValueOnce(new Error("Network request failed"));
  const transport = createWallTransport("https://example.convex.cloud", fetcher);
  const context = { token: "token", signal: new AbortController().signal };
  await expect(transport.setNoteVisibility({ scope: "account:a:1", changes: [] }, context)).rejects.toThrow(
    "Network request failed",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValueOnce({
    ok: false,
    status: 560,
    json: async () => ({
      status: "error",
      errorMessage: "Conflict",
      errorData: { code: "conflict" },
    }),
  });
  await expect(transport.setNoteVisibility({ scope: "account:a:1", changes: [] }, context)).rejects.toMatchObject({
    data: { code: "conflict" },
  });
});
