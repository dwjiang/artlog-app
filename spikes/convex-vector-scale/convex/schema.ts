import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const vectorFields = {
  objectId: v.string(),
  modelVersion: v.string(),
  source: v.string(),
  vector: v.array(v.float64()),
};

export default defineSchema({
  vectors: defineTable(vectorFields)
    .vectorIndex("by_vector", {
      vectorField: "vector",
      dimensions: 1536,
      filterFields: ["modelVersion"],
    })
    .index("by_objectId_modelVersion", ["objectId", "modelVersion"]),
  // One checkpoint per version avoids full vector scans for stats and safe retries.
  progress: defineTable({
    modelVersion: v.string(),
    seed: v.number(),
    nextRow: v.number(),
    count: v.number(),
    deleting: v.boolean(),
  }).index("by_modelVersion", ["modelVersion"]),
});
