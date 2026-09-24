import { ConvexError } from "convex/values";

import { convexErrorCode } from "@/lib/network-error";
import { addBreadcrumb, reportError } from "@/lib/observability";
import type { RequestContext } from "@/lib/wall/wall-transport";
import { LIMITS } from "@/shared/journal/limits";
import { socialErrorMessage } from "@/shared/social/errors";

import type {
  SharePreview,
  ShareSelection,
  ShareState,
  SharedVisit,
  VisitSharingTransport,
} from "./visit-sharing-transport";

type Session = {
  owner: string;
  scope?: string;
  token: string | null;
  isCurrent: () => boolean;
};
type State = {
  acknowledged: ShareState | null;
  draft: ShareSelection | null;
  preview: SharePreview | null;
  shared: SharedVisit | null;
  busy: boolean;
  error?: string;
  profileRequired: boolean;
  conflict: boolean;
};
const empty = (): State => ({
  acknowledged: null,
  draft: null,
  preview: null,
  shared: null,
  busy: false,
  profileRequired: false,
  conflict: false,
});

export function createVisitSharingController({
  visitLocalId,
  saveLocalIds,
  transport,
  capture,
  subscribeOwner,
  flush,
  photoSelections = () => [],
}: {
  visitLocalId: string;
  saveLocalIds: () => string[];
  photoSelections?: () => NonNullable<ShareSelection["photoSelections"]>;
  transport: VisitSharingTransport;
  capture: () => Session;
  subscribeOwner: (listener: () => void) => () => void;
  flush: () => Promise<void>;
}) {
  let state = empty();
  let abort: AbortController | undefined;
  let unsubscribe: (() => void) | undefined;
  let disposed = false;
  const listeners = new Set<() => void>();
  const emit = (patch: Partial<State>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  function reset() {
    abort?.abort();
    abort = undefined;
    state = empty();
    listeners.forEach((listener) => listener());
  }
  async function run(
    operation: "load" | "preview" | "publish" | "view",
    work: (context: RequestContext, current: () => boolean) => Promise<void>,
  ): Promise<boolean> {
    if (state.busy || disposed) return false;
    const session = capture();
    if (!session.owner.startsWith("account:") || !session.token || !session.scope) {
      emit({
        error: "Sign in and wait for your journal to sync before sharing.",
      });
      return false;
    }
    const request = new AbortController();
    abort = request;
    const current = () => !disposed && abort === request && !request.signal.aborted && session.isCurrent();
    const context = { token: session.token, signal: request.signal };
    const cancelled = new Promise<never>((_, reject) => {
      request.signal.addEventListener("abort", () => reject(new Error("Sharing request cancelled or timed out")), {
        once: true,
      });
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      request.abort();
    }, 30_000);
    addBreadcrumb(`visit.sharing.${operation}.started`);
    emit({ busy: true, error: undefined });
    try {
      await Promise.race([flush(), cancelled]);
      if (!current()) return false;
      await Promise.race([work(context, current), cancelled]);
      if (current()) addBreadcrumb(`visit.sharing.${operation}.completed`);
      return current();
    } catch (cause) {
      if (!disposed && abort === request && session.isCurrent()) {
        reportError(timedOut ? new Error("Visit sharing timed out") : cause, `visit.sharing.${operation}`);
        const conflict = convexErrorCode(cause) === "conflict";
        emit({
          profileRequired: convexErrorCode(cause) === "profile_required",
          error: conflict
            ? "This share changed on another device. Your draft is kept. Refresh the preview before sharing again."
            : (socialErrorMessage(cause)
              ?? "The request did not finish. Your draft is kept. Check your connection and try again."),
          ...(conflict ? { conflict: true, preview: null, shared: null } : {}),
        });
      }
      return false;
    } finally {
      clearTimeout(timeout);
      if (!disposed && abort === request && session.isCurrent()) {
        emit({ busy: false });
      }
    }
  }
  function accept(acknowledged: ShareState, preserveDraft = true) {
    const preview =
      state.draft?.reflection !== acknowledged.reflection || state.draft?.revision !== acknowledged.revision
        ? null
        : state.preview;
    const available = new Set(saveLocalIds());
    const previous = preserveDraft ? state.draft : null;
    const draft = previous
      ? {
          ...previous,
          saveLocalIds: previous.saveLocalIds.filter((id) => available.has(id)),
          revision: acknowledged.revision,
        }
      : {
          visitLocalId,
          audience: acknowledged.audience,
          revision: acknowledged.revision,
          saveLocalIds: (acknowledged.postId
            ? acknowledged.saveLocalIds.filter((id) => available.has(id))
            : [...available]
          ).slice(0, LIMITS.selectedSaves),
          photoSelections: acknowledged.postId
            ? (acknowledged.photoSelections ?? [])
            : photoSelections().filter((row) =>
                [...available].slice(0, LIMITS.selectedSaves).includes(row.saveLocalId),
              ),
          highlightLocalIds: acknowledged.postId ? (acknowledged.highlightLocalIds ?? []) : [...available].slice(0, 3),
        };
    draft.photoSelections = draft.photoSelections?.filter((row) => draft.saveLocalIds.includes(row.saveLocalId));
    draft.highlightLocalIds = draft.highlightLocalIds?.filter((id) => draft.saveLocalIds.includes(id));
    emit({
      acknowledged,
      draft: { ...draft, reflection: acknowledged.reflection },
      preview,
      profileRequired: false,
    });
  }
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    connect() {
      disposed = false;
      unsubscribe ??= subscribeOwner(reset);
    },
    dispose() {
      disposed = true;
      abort?.abort();
      unsubscribe?.();
      unsubscribe = undefined;
      state = empty();
    },
    load: () =>
      run("load", async (context, current) => {
        const result = await transport.getState({ visitLocalId }, context);
        if (current()) accept(result);
      }),
    edit(patch: Partial<Pick<ShareSelection, "saveLocalIds" | "photoSelections" | "highlightLocalIds">>) {
      if (!state.draft || state.busy || disposed) return;
      const available = new Set(saveLocalIds());
      const selected = patch.saveLocalIds;
      if (
        selected
        && (selected.length > LIMITS.selectedSaves
          || new Set(selected).size !== selected.length
          || selected.some((id) => !available.has(id)))
      ) {
        return;
      }
      const draft = { ...state.draft, ...patch };
      if (selected) {
        for (const id of selected) {
          if (!state.draft.saveLocalIds.includes(id) && !draft.photoSelections?.some((row) => row.saveLocalId === id)) {
            const defaults = photoSelections().find((row) => row.saveLocalId === id);
            if (defaults) {
              draft.photoSelections = [...(draft.photoSelections ?? []), defaults];
            }
          }
        }
      }
      draft.photoSelections = draft.photoSelections?.filter((row) => draft.saveLocalIds.includes(row.saveLocalId));
      draft.highlightLocalIds = draft.highlightLocalIds?.filter((id) => draft.saveLocalIds.includes(id)).slice(0, 3);
      emit({ draft, preview: null });
    },
    preview: () =>
      run("preview", async (context, current) => {
        const fresh = await transport.getState({ visitLocalId }, context);
        if (!current()) return;
        accept(fresh);
        emit({ preview: null });
        if (fresh.removed) throw new ConvexError({ code: "not_found" });
        const result = await transport.preview(state.draft!, context);
        if (current()) emit({ preview: result, conflict: false });
      }),
    publish: () => {
      if (!state.preview || !state.draft || state.conflict || state.acknowledged?.removed) {
        return Promise.resolve(false);
      }
      const { draft } = state;
      return run("publish", async (context, current) => {
        const result = await transport.publish(draft, context);
        if (current()) {
          accept(result, false);
          emit({ preview: null });
        }
      });
    },
    view: () =>
      run("view", async (context, current) => {
        const fresh = await transport.getState({ visitLocalId }, context);
        if (!current()) return;
        accept(fresh);
        if (!fresh.postId || fresh.status !== "active" || fresh.removed) {
          emit({ shared: null, error: "This visit is not currently shared." });
          return;
        }
        let result = await transport.get({ postId: fresh.postId, limit: LIMITS.maxPage }, context);
        const pages = new Set<string>();
        while (current() && !result.artworks.isDone && result.artworks.cursor) {
          const { cursor } = result.artworks;
          if (pages.has(cursor)) {
            throw new Error("The artwork page did not advance");
          }
          pages.add(cursor);
          const next = await transport.get({ postId: fresh.postId, limit: LIMITS.maxPage, cursor }, context);
          result = {
            ...next,
            artworks: {
              ...next.artworks,
              page: [...result.artworks.page, ...next.artworks.page],
            },
          };
        }
        if (current()) emit({ shared: result });
      }),
  };
}
