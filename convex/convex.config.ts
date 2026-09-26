import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const optional = v.optional(v.string());

// Optional because deploys validate declared vars and each deployment sets only some; callers own defaults.
const app = defineApp({
  env: {
    APP_ATTEST_ALLOW_DEV: optional,
    APP_ATTEST_APP_ID: optional,
    APP_ATTEST_REQUIRED: optional,
    APPLE_BUNDLE_ID: optional,
    CRAWLER_CONTACT: optional,
    DAILY_TAVILY_CREDIT_CAP: optional,
    DAILY_TOKEN_FACTORY_CALL_CAP: optional,
    DOCENT_MODEL: optional,
    FACT_SHEET_MODEL: optional,
    FLAG_LABEL_FLOW: optional,
    FLAG_RIGHT_NOW: optional,
    LABEL_MODEL: optional,
    MINIMUM_IOS_BUILD: optional,
    MODERATION_BLOCKLIST: optional,
    MODERATION_MODEL: optional,
    NEBIUS_API_KEY: optional,
    OPENAI_API_KEY: optional,
    SENTRY_DSN: optional,
    SENTRY_ENVIRONMENT: optional,
    SUPPORTED_MODEL_VERSIONS: optional,
    TAVILY_API_KEY: optional,
  },
});
app.use(rateLimiter);

export default app;
