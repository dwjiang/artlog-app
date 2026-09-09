import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const descriptorFields = {
  objectId: v.id('objects'),
  descriptors: v.bytes(),
  keypoints: v.bytes(),
  keypointCount: v.number(),
  inputSize: v.number(),
  extractedFrom: v.string(),
};

export default defineSchema({
  objects: defineTable({ ordinal: v.number() }).index('by_ordinal', ['ordinal']),
  descriptors: defineTable(descriptorFields).index('by_objectId', ['objectId']),
});
