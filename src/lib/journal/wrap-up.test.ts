import { db } from "@/db/client";
import { getSetting } from "@/db/repos/settings";
import { settings } from "@/db/schema";

import { clearWrapUp, markWrapUp } from "./wrap-up";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));

beforeEach(async () => {
  await db.delete(settings);
});

it("persists a pending visit and dismisses it idempotently", async () => {
  await markWrapUp("account:me", "visit-1");
  expect(await getSetting("wrapUpVisit:account:me")).toBe("visit-1");
  await clearWrapUp("account:me", "visit-1");
  await clearWrapUp("account:me", "visit-1");
  expect(await getSetting("wrapUpVisit:account:me")).toBeUndefined();
});

it("keeps a newer pending visit and another owner's prompt when an old sheet closes", async () => {
  await markWrapUp("account:me", "visit-1");
  await markWrapUp("account:me", "visit-2");
  await markWrapUp("account:other", "visit-1");
  await clearWrapUp("account:me", "visit-1");
  expect(await getSetting("wrapUpVisit:account:me")).toBe("visit-2");
  expect(await getSetting("wrapUpVisit:account:other")).toBe("visit-1");
});
