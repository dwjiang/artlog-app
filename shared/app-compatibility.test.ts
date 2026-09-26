import { isIosBuildSupported, parseIosBuild } from "./app-compatibility";

describe("iOS build compatibility", () => {
  it.each([
    ["9", "10", false],
    ["10", "10", true],
    ["11", "10", true],
    ["1.2", "1.2.0", true],
    ["1.2.9", "1.3", false],
    ["2", "1.99.99", true],
  ])("compares build %s with minimum %s numerically", (build, minimum, supported) => {
    expect(isIosBuildSupported(build, minimum)).toBe(supported);
  });

  it.each(["", "-1", "1.2.3.4", "1beta", "1..2", "1e3", "9007199254740992"])("rejects malformed build %s", (build) =>
    expect(parseIosBuild(build)).toBeNull(),
  );

  it("allows the app when no requirement or native build is available", () => {
    expect(isIosBuildSupported("1", null)).toBe(true);
    expect(isIosBuildSupported(null, "42")).toBe(true);
  });
});
