// Must run before the SDK reads the clock.
import "./sentry-clock";
import * as Sentry from "@sentry/react-native";

import { addBreadcrumb, sanitizeBreadcrumb, sanitizeEvent, sanitizeTransaction } from "./observability";

export const navigationIntegration = Sentry.reactNavigationIntegration();

// Load before database/auth modules so initialization failures are captured too.
Sentry.init({
  // Only the EAS production environment sets a DSN; without one the SDK stays off, so other builds never report.
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  environment: "production",
  sendDefaultPii: false,
  attachScreenshot: false,
  attachViewHierarchy: false,
  tracesSampleRate: 1,
  // The backend reports without trace continuation, so trace headers would only reach third parties.
  tracePropagationTargets: [],
  // Keep replay unconfigured without recording consent; even zero sample rates install its integration.
  integrations: [navigationIntegration],
  maxBreadcrumbs: 50,
  beforeBreadcrumb: sanitizeBreadcrumb,
  beforeSend: sanitizeEvent,
  beforeSendTransaction: sanitizeTransaction,
});

addBreadcrumb("app.started");
