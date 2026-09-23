import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("promote", { minutes: 10 }, internal.promotion.run, {});

export default crons;
