import { convexErrorCode } from '../network-error';
import type { LayoutInput, OwnerWall, VisibilityInput, WallTransport } from './wall-transport';

type LayoutDraft = Omit<LayoutInput, 'scope' | 'revision'>;
type NoteDraft = VisibilityInput['changes'];
type State = { acknowledged: OwnerWall | null; layoutDraft: LayoutDraft | null; noteDraft: NoteDraft;
  pending: boolean; needsNoteConfirmation: boolean };
type Session = { owner: string; scope?: string; token: string | null; isCurrent: () => boolean };
type Dependencies = { transport: WallTransport; capture: () => Session; online: () => Promise<boolean>;
  subscribeOwner: (listener: () => void) => () => void };
const empty = (): State => ({ acknowledged: null, layoutDraft: null, noteDraft: [], pending: false, needsNoteConfirmation: false });

export function createWallRepository(deps: Dependencies) {
  let state = empty();
  let disposed = false;
  let generation = 0;
  let reading = 0;
  let layoutRevision: number | null = null;
  const requests = new Set<AbortController>();
  const listeners = new Set<() => void>();
  function update(patch: Partial<State>) { state = { ...state, ...patch }; for (const listener of listeners) listener(); }
  function clear() {
    generation++; reading++;
    for (const controller of requests) controller.abort();
    requests.clear(); layoutRevision = null; state = empty(); for (const listener of listeners) listener();
  }
  let unsubscribe: (() => void) | undefined;
  function request() {
    const session = deps.capture(), version = generation, controller = new AbortController();
    if (disposed || !session.scope || !session.token || !session.owner.startsWith('account:')) throw new Error('Wall account is not ready');
    requests.add(controller);
    function check() {
      if (disposed || version !== generation || !session.isCurrent() || controller.signal.aborted) throw new Error('Wall request cancelled');
    }
    return { scope: session.scope, context: { token: session.token, signal: controller.signal }, check,
      ready: async () => { if (!await deps.online()) throw new Error('Connect to publish your wall'); check(); },
      finish: () => requests.delete(controller) };
  }
  async function refresh() {
    if (state.pending) throw new Error('A wall update is in progress');
    const current = request(), read = ++reading;
    try {
      await current.ready();
      const acknowledged = await deps.transport.getMine(current.context);
      current.check();
      if (acknowledged.scope !== current.scope) throw new Error('Wall account changed');
      if (read === reading) update({ acknowledged });
    } finally { current.finish(); }
  }
  async function publish(kind: 'layout' | 'notes') {
    if (state.pending) throw new Error('A wall update is in progress');
    const acknowledged = state.acknowledged, layoutDraft = state.layoutDraft, noteDraft = state.noteDraft;
    if (!acknowledged) throw new Error('Refresh your wall first');
    if (kind === 'layout' ? !layoutDraft : noteDraft.length === 0) return;
    const current = request();
    if (acknowledged.scope !== current.scope) { current.finish(); throw new Error('Refresh your wall first'); }
    reading++;
    update({ pending: true });
    try {
      await current.ready();
      const result = kind === 'layout'
        ? await deps.transport.setLayout({ ...layoutDraft!, scope: current.scope, revision: layoutRevision ?? acknowledged.revision }, current.context)
        : await deps.transport.setNoteVisibility({ scope: current.scope, changes: noteDraft }, current.context);
      current.check();
      if (result.scope !== current.scope) throw new Error('Wall account changed');
      if (kind === 'layout') layoutRevision = result.revision;
      update({ acknowledged: result,
        ...(kind === 'layout' && state.layoutDraft === layoutDraft ? { layoutDraft: null } : {}),
        ...(kind === 'notes' && state.noteDraft === noteDraft ? { noteDraft: [], needsNoteConfirmation: false } : {}) });
    } catch (error) {
      current.check();
      if (convexErrorCode(error) === 'conflict') {
        update({ noteDraft: [], needsNoteConfirmation: true, acknowledged: null });
        const fresh = await deps.transport.getMine(current.context);
        current.check();
        if (fresh.scope !== current.scope) throw new Error('Wall account changed');
        if (kind === 'layout') layoutRevision = fresh.revision;
        update({ acknowledged: fresh });
      }
      throw error;
    } finally {
      current.finish();
      if (!current.context.signal.aborted && !disposed) update({ pending: false });
    }
  }
  return {
    connect: () => { disposed = false; unsubscribe ??= deps.subscribeOwner(clear); },
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    setLayoutDraft: (draft: LayoutDraft) => {
      if (!state.acknowledged) throw new Error('Refresh your wall first');
      if (!state.layoutDraft) layoutRevision = state.acknowledged.revision;
      update({ layoutDraft: { color: draft.color, items: draft.items.map((item) => ({ placementId: item.placementId, saveLocalId: item.saveLocalId, photoLocalId: item.photoLocalId, layout: { ...item.layout } })) } });
    },
    setNoteDraft: (changes: { itemId: NoteDraft[number]['itemId']; visible: boolean }[]) => {
      if (!state.acknowledged) throw new Error('Refresh your wall first');
      const noteDraft = changes.map((change) => {
        const item = state.acknowledged!.items.find((item) => item.itemId === change.itemId);
        if (!item || (change.visible && !item.noteEligible)) throw new Error('Note is unavailable');
        return { ...change, noteRevision: item.noteRevision };
      });
      update({ noteDraft, needsNoteConfirmation: false });
    },
    publishLayout: () => publish('layout'),
    publishNotes: () => publish('notes'),
    listSelections: async (cursor?: string | null) => {
      const current = request();
      try {
        await current.ready();
        const result = await deps.transport.listMine({ scope: current.scope, cursor }, current.context);
        current.check(); return result;
      } finally { current.finish(); }
    },
    discardDrafts: () => update({ layoutDraft: null, noteDraft: [], needsNoteConfirmation: false }),
    dispose: () => { disposed = true; unsubscribe?.(); unsubscribe = undefined; clear(); },
  };
}
