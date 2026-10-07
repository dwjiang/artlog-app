import { convexErrorCode } from "@/lib/network-error";

import type { LayoutInput, OwnerWall, WallTransport } from "./wall-transport";

type LayoutDraft = Omit<LayoutInput, "scope" | "revision">;
export type WallState<Wall> = {
  acknowledged: Wall | null;
  layoutDraft: LayoutDraft | null;
  pending: boolean;
};
type State = WallState<OwnerWall>;
type Session = {
  owner: string;
  scope?: string;
  token: string | null;
  isCurrent: () => boolean;
};
type Dependencies = {
  transport: WallTransport;
  capture: () => Session;
  online: () => Promise<boolean>;
  subscribeOwner: (listener: () => void) => () => void;
};
const empty = (): State => ({
  acknowledged: null,
  layoutDraft: null,
  pending: false,
});

export function createWallRepository(deps: Dependencies) {
  let state = empty();
  let disposed = false;
  let generation = 0;
  let reading = 0;
  let layoutRevision: number | null = null;
  const requests = new Set<AbortController>();
  const listeners = new Set<() => void>();
  function update(patch: Partial<State>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }
  function clear() {
    generation++;
    reading++;
    for (const controller of requests) controller.abort();
    requests.clear();
    layoutRevision = null;
    state = empty();
    for (const listener of listeners) listener();
  }
  let unsubscribe: (() => void) | undefined;
  function request() {
    const session = deps.capture();
    const version = generation;
    const controller = new AbortController();
    if (disposed || !session.scope || !session.token || !session.owner.startsWith("account:")) {
      throw new Error("Wall account is not ready");
    }
    requests.add(controller);
    function check() {
      if (disposed || version !== generation || !session.isCurrent() || controller.signal.aborted) {
        throw new Error("Wall request cancelled");
      }
    }
    return {
      scope: session.scope,
      context: { token: session.token, signal: controller.signal },
      check,
      ready: async () => {
        if (!(await deps.online())) {
          throw new Error("Connect to publish your wall");
        }
        check();
      },
      finish: () => requests.delete(controller),
    };
  }
  async function refresh() {
    if (state.pending) throw new Error("A wall update is in progress");
    const current = request();
    const read = ++reading;
    try {
      await current.ready();
      const acknowledged = await deps.transport.getMine(current.context);
      current.check();
      if (acknowledged.scope !== current.scope) {
        throw new Error("Wall account changed");
      }
      if (read === reading) update({ acknowledged });
    } finally {
      current.finish();
    }
  }
  async function publishLayout() {
    if (state.pending) throw new Error("A wall update is in progress");
    const { acknowledged, layoutDraft } = state;
    if (!acknowledged) throw new Error("Refresh your wall first");
    if (!layoutDraft) return;
    const current = request();
    if (acknowledged.scope !== current.scope) {
      current.finish();
      throw new Error("Refresh your wall first");
    }
    reading++;
    update({ pending: true });
    try {
      await current.ready();
      const result = await deps.transport.setLayout(
        {
          ...layoutDraft,
          scope: current.scope,
          revision: layoutRevision ?? acknowledged.revision,
        },
        current.context,
      );
      current.check();
      if (result.scope !== current.scope) {
        throw new Error("Wall account changed");
      }
      layoutRevision = result.revision;
      update({
        acknowledged: result,
        ...(state.layoutDraft === layoutDraft ? { layoutDraft: null } : {}),
      });
    } catch (error) {
      current.check();
      if (convexErrorCode(error) === "conflict") {
        update({ acknowledged: null });
        const fresh = await deps.transport.getMine(current.context);
        current.check();
        if (fresh.scope !== current.scope) {
          throw new Error("Wall account changed");
        }
        layoutRevision = fresh.revision;
        update({ acknowledged: fresh });
      }
      throw error;
    } finally {
      current.finish();
      if (!current.context.signal.aborted && !disposed) {
        update({ pending: false });
      }
    }
  }
  return {
    connect: () => {
      disposed = false;
      unsubscribe ??= deps.subscribeOwner(clear);
    },
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    setLayoutDraft: (draft: LayoutDraft) => {
      if (!state.acknowledged) throw new Error("Refresh your wall first");
      if (!state.layoutDraft) layoutRevision = state.acknowledged.revision;
      update({
        layoutDraft: {
          color: draft.color,
          pattern: draft.pattern,
          items: draft.items.map((item) => ({
            placementId: item.placementId,
            saveLocalId: item.saveLocalId,
            photoLocalId: item.photoLocalId,
            layout: { ...item.layout },
          })),
        },
      });
    },
    publishLayout,
    discardDrafts: () => update({ layoutDraft: null }),
    dispose: () => {
      disposed = true;
      unsubscribe?.();
      unsubscribe = undefined;
      clear();
    },
  };
}
