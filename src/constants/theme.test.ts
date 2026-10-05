let mockIOSVersion: string;
jest.mock("react-native", () => {
  const native = jest.requireActual<typeof import("react-native")>("react-native");
  Object.defineProperty(native.Platform, "Version", { get: () => mockIOSVersion });
  return native;
});

function headersOn(version: string) {
  mockIOSVersion = version;
  let theme!: typeof import("./theme");
  jest.isolateModules(() => {
    theme = jest.requireActual<typeof import("./theme")>("./theme");
  });
  return [theme.TransparentHeader, theme.ScrollTitleHeader, theme.LargeTitleHeader];
}

it.each(["17.7", "18.7"])("protects navigation text from scrolling content on iOS %s", (version) => {
  for (const header of headersOn(version)) {
    expect(header).toMatchObject({ headerTransparent: true, headerBlurEffect: "systemMaterial" });
  }
});

it("leaves background protection to native scroll edges on iOS 26", () => {
  for (const header of headersOn("26.5.1")) {
    expect(header).toMatchObject({ headerTransparent: true });
    expect(header).not.toHaveProperty("headerBlurEffect", "systemMaterial");
  }
});
