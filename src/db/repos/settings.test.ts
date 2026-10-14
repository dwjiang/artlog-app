import * as repo from "./settings";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));

it("stores, overwrites and removes settings by key", async () => {
  expect(await repo.getSetting("currentVisit")).toBeUndefined();
  await repo.setSetting("currentVisit", "v1");
  await repo.setSetting("currentVisit", "v2");
  await repo.setSetting("sharing", "granted");
  expect(await repo.getSetting("currentVisit")).toBe("v2");
  await repo.removeSetting("currentVisit");
  expect(await repo.getSetting("currentVisit")).toBeUndefined();
  expect(await repo.getSetting("sharing")).toBe("granted");
});

it("consumes a setting once, including when callers request it concurrently", async () => {
  await repo.setSetting("pending-answer", "on");
  const answers = await Promise.all([repo.takeSetting("pending-answer"), repo.takeSetting("pending-answer")]);
  expect(answers).toEqual(["on", undefined]);
  expect(await repo.getSetting("pending-answer")).toBeUndefined();
});
