import { getIntegrationsToSetup } from "@sentry/core";
import * as Sentry from "@sentry/react-native";
import { getDefaultIntegrations } from "@sentry/react-native/dist/js/integrations/default";

function initOptions(dsn: string | undefined) {
  const configured = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (dsn === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  else process.env.EXPO_PUBLIC_SENTRY_DSN = dsn;
  try {
    jest.isolateModules(() => {
      jest.requireActual("./sentry");
    });
    return jest.mocked(Sentry.init).mock.calls.at(-1)![0]!;
  } finally {
    if (configured === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    else process.env.EXPO_PUBLIC_SENTRY_DSN = configured;
  }
}

it("leaves Sentry without a DSN in builds outside the production environment", () => {
  expect(initOptions(undefined).dsn).toBeUndefined();
});

it("keeps production error reporting without screen recording or visual attachments", () => {
  const options = initOptions("https://public@example.ingest.sentry.io/123");
  expect(options.dsn).toBe("https://public@example.ingest.sentry.io/123");
  expect(options.enabled).not.toBe(false);

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
});
