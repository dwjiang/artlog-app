import { customCtx, customMutation } from "convex-helpers/server/customFunctions";
import type { MutationBuilder } from "convex/server";

import type { DataModel } from "./_generated/dataModel";
// oxlint-disable-next-line no-restricted-imports -- This module installs the database triggers.
import { mutation as rawMutation, internalMutation as rawInternalMutation } from "./_generated/server";
import { databaseTriggers } from "./lib/databaseTriggers";

export const mutation: MutationBuilder<DataModel, "public"> = customMutation(
  rawMutation,
  customCtx(databaseTriggers.wrapDB),
);
export const internalMutation: MutationBuilder<DataModel, "internal"> = customMutation(
  rawInternalMutation,
  customCtx(databaseTriggers.wrapDB),
);
