import type { FunctionReturnType } from "convex/server";

import type { api } from "../../../convex/_generated/api";

export type SharedVisit = FunctionReturnType<typeof api.sharedVisits.get>;
export type SharedArtwork = FunctionReturnType<typeof api.sharedVisits.getArtwork>;
export type PublicProfile = NonNullable<FunctionReturnType<typeof api.profiles.getPublic>>;
export type PublicWall = NonNullable<FunctionReturnType<typeof api.walls.getPublic>>;
export type Relationship = FunctionReturnType<typeof api.friendships.getState>;
export type FriendshipAction = "request" | "accept" | "decline" | "cancel" | "remove";
