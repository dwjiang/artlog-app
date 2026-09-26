import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("expire scan vectors", { hours: 24 }, internal.scanEmbeddings.expire, {});

crons.interval("retry Pinecone sync", { minutes: 1 }, internal.vectorSync.drain, {});

export default crons;
