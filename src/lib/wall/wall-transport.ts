import { ConvexHttpClient } from "convex/browser";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { fetch as expoFetch } from "expo/fetch";
import { api } from "../../../convex/_generated/api";

export type OwnerWall = FunctionReturnType<typeof api.walls.getMine>;
export type LayoutInput = FunctionArgs<typeof api.walls.setLayout>;
export type VisibilityInput = FunctionArgs<typeof api.walls.setNoteVisibility>;
export type CollectionInput = FunctionArgs<typeof api.collections.listMine>;
export type RequestContext = { token: string; signal: AbortSignal };

export function createWallTransport(url: string, fetcher: typeof globalThis.fetch = expoFetch) {
  function client({ token, signal }: RequestContext) {
    return new ConvexHttpClient(url, {
      auth: token,
      logger: false,
      fetch: (input, options) => fetcher(input, { ...options, signal }),
    });
  }
  return {
    getMine: (context: RequestContext) => client(context).query(api.walls.getMine, {}),
    setLayout: (args: LayoutInput, context: RequestContext) =>
      client(context).mutation(api.walls.setLayout, args, { skipQueue: true }),
    setNoteVisibility: (args: VisibilityInput, context: RequestContext) =>
      client(context).mutation(api.walls.setNoteVisibility, args, {
        skipQueue: true,
      }),
    listMine: (args: CollectionInput, context: RequestContext) => client(context).query(api.collections.listMine, args),
  };
}
export type WallTransport = ReturnType<typeof createWallTransport>;

export function createPublicWallReader(url: string) {
  const client = new ConvexHttpClient(url);
  return {
    getWall: (args: FunctionArgs<typeof api.walls.getPublic>) => client.query(api.walls.getPublic, args),
    getArtwork: (args: FunctionArgs<typeof api.walls.getArtwork>) => client.query(api.walls.getArtwork, args),
  };
}
