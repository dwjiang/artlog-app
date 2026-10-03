// Must run before the SDK reads the clock.
import "./sentry-clock";
import * as Sentry from "@sentry/react-native";

import { addBreadcrumb, sanitizeBreadcrumb, sanitizeEvent, sanitizeTransaction } from "./observability";

export const navigationIntegration = Sentry.reactNavigationIntegration();

// Load before database/auth modules so initialization failures are captured too.
Sentry.init({
  dsn: "https://f15d821481cbfc2a9bc7ffe64aadee16@o4512128707198976.ingest.us.sentry.io/4512128734986240",
  // Dev clients across worktrees flood the project with local breakage.
  enabled: !__DEV__,
  environment: __DEV__ ? "development" : "production",
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
