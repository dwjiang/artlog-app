import { v } from 'convex/values';

export const chunk = v.object({ storageId: v.id('_storage'), size: v.number(), sha256: v.string() });
export const preview = v.object({ title: v.string(), url: v.string() });
export const packageFields = {
  version: v.string(), modelVersion: v.string(), size: v.number(), count: v.number(),
  chunks: v.array(chunk), previews: v.array(preview),
};
export const museumPackage = v.object(packageFields);
