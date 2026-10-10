import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("expire transient evidence", { hours: 1 }, internal.retention.expire, {});

crons.interval("expire scan vectors", { hours: 24 }, internal.scanEmbeddings.expire, {});
crons.interval("expire unattached files", { hours: 1 }, internal.files.expire, {});

crons.interval("retry Pinecone sync", { minutes: 1 }, internal.vectorSync.drain, {});
crons.interval("read exhibition listings", { minutes: 15 }, internal.exhibitionRefresh.dispatch, {});

crons.weekly("pick popular tags", { dayOfWeek: "monday", hourUTC: 9, minuteUTC: 17 }, internal.tags.refreshPopular, {});
crons.monthly("pick artist avatars", { day: 1, hourUTC: 9, minuteUTC: 47 }, internal.artists.refreshCovers, {});

export default crons;
