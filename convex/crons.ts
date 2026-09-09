import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();
crons.interval('crawl scheduler', { minutes: 15 }, internal.crawl.maybeLaunch);
crons.daily('crawl freshness', { hourUTC: 3 }, internal.crawl.enqueueStale);
crons.hourly('stale runs', { minuteUTC: 7 }, internal.crawl.staleRunsSweep);

export default crons;
