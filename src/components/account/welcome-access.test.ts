import appConfig from "../../../app.json";
import { accessPrompts } from "./welcome-access";

// The prompt data is pure; the hook's native camera module only needs to load.
jest.mock("react-native-vision-camera", () => ({ useCameraPermission: jest.fn() }));

function pluginOptions(name: string): Record<string, unknown> {
  const plugin = appConfig.expo.plugins.find((entry) => Array.isArray(entry) && entry[0] === name);
  if (!Array.isArray(plugin) || typeof plugin[1] !== "object" || plugin[1] === null) {
    throw new Error(`${name} plugin options missing from app.json`);
  }
  return plugin[1] as Record<string, unknown>;
}

it("previews the same usage strings iPhone shows in each prompt", () => {
  expect(accessPrompts.camera.message).toBe(appConfig.expo.ios.infoPlist.NSCameraUsageDescription);
  expect(accessPrompts.photos.message).toBe(pluginOptions("expo-media-library").savePhotosPermission);
  expect(accessPrompts.location.message).toBe(pluginOptions("expo-location").locationWhenInUsePermission);
});

it("marks an option that every prompt offers", () => {
  for (const prompt of Object.values(accessPrompts)) {
    expect(prompt.options).toContain(prompt.allowed);
  }
});
