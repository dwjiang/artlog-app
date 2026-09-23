import { getMuseumSearchConsent, setMuseumSearchConsent } from "./museum-search";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("../../db/test-db").createTestDatabase(),
}));

it("defaults to unset and persists grants and revocations across fresh reads", async () => {
  expect(await getMuseumSearchConsent()).toBe("unset");
  await setMuseumSearchConsent("granted");
  expect(await getMuseumSearchConsent()).toBe("granted");
  await setMuseumSearchConsent("declined");
  expect(await getMuseumSearchConsent()).toBe("declined");
  // Reload the consent module while retaining the persisted SQLite database.
  await jest.isolateModulesAsync(async () => {
    const repo = jest.requireActual<typeof import("./museum-search")>("./museum-search");
    await expect(repo.getMuseumSearchConsent()).resolves.toBe("declined");
  });
});
