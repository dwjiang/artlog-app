import { type Infer, v } from 'convex/values';

export const journalVenue = v.object({ id: v.id('museums'), key: v.string(), name: v.string(), lat: v.number(), lng: v.number(),
  region: v.string(), website: v.optional(v.string()), city: v.optional(v.string()), cityKey: v.optional(v.string()), country: v.optional(v.string()) });
export type JournalVenue = Infer<typeof journalVenue>;
