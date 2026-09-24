import * as Sentry from "@sentry/react-native";

import { addBreadcrumb, sanitizeBreadcrumb, sanitizeEvent } from "./observability";

// Load before database/auth modules so initialization failures are captured too.
Sentry.init({
  dsn: "https://f15d821481cbfc2a9bc7ffe64aadee16@o4512128707198976.ingest.us.sentry.io/4512128734986240",
  // Dev clients across worktrees flood the project with local breakage.
  enabled: !__DEV__,
  environment: __DEV__ ? "development" : "production",
  sendDefaultPii: false,
  attachScreenshot: false,
  attachViewHierarchy: false,
  // Camera previews must never be recorded, including on an error.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  maxBreadcrumbs: 50,
  beforeBreadcrumb: sanitizeBreadcrumb,
  beforeSend: sanitizeEvent,
});

addBreadcrumb("app.started");
