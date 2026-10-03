import { getIntegrationsToSetup } from "@sentry/core";
import * as Sentry from "@sentry/react-native";
import { getDefaultIntegrations } from "@sentry/react-native/dist/js/integrations/default";

it("keeps production error reporting enabled without screen recording or visual attachments", () => {
  const development = __DEV__;
  Object.defineProperty(globalThis, "__DEV__", { configurable: true, value: false });
  try {
    jest.isolateModules(() => {
      jest.requireActual("./sentry");
    });
    const options = jest.mocked(Sentry.init).mock.calls.at(-1)![0]!;
    expect(options.enabled).toBe(true);

    const integrations = getIntegrationsToSetup({
      ...options,
      defaultIntegrations: getDefaultIntegrations({
        ...options,
        integrations: [],
        enableNative: true,
        transport: jest.fn(),
        stackParser: () => [],
      }),
    });
    const names = integrations.map((integration) => integration.name);
    expect(names).toContain("ReactNativeErrorHandlers");
    expect(names).not.toContain("MobileReplay");
    expect(names).not.toContain("Screenshot");
    expect(names).not.toContain("ViewHierarchy");
  } finally {
    Object.defineProperty(globalThis, "__DEV__", { configurable: true, value: development });
  }
});
