import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("expire transient evidence", { hours: 1 }, internal.retention.expire, {});

crons.interval("expire scan vectors", { hours: 24 }, internal.scanEmbeddings.expire, {});
crons.interval("expire unattached files", { hours: 1 }, internal.files.expire, {});

// Queued jobs and failed writes schedule their own drains; this recovers jobs a crashed drain left leased.
crons.interval("recover Pinecone sync", { hours: 1 }, internal.vectorSync.drain, {});
crons.interval("recover feed photo copies", { hours: 1 }, internal.feedPhotos.wake, {});
crons.daily(
  "read due exhibition listings",
  { hourUTC: 10, minuteUTC: 23 },
  internal.exhibitionRefresh.readDueListings,
  {},
);
// Two hours after the listing reads begin, by when the day's new shows are saved.
crons.daily("look up exhibition images", { hourUTC: 12, minuteUTC: 23 }, internal.exhibitionImages.lookUpDue, {});

crons.weekly("pick popular tags", { dayOfWeek: "monday", hourUTC: 9, minuteUTC: 17 }, internal.tags.refreshPopular, {});
crons.monthly("pick artist avatars", { day: 1, hourUTC: 9, minuteUTC: 47 }, internal.artists.refreshCovers, {});

export default crons;
