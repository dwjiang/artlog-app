import { useLocalOwner } from '@/lib/account/owner-store';
import { commitRemoval, undoRemoval, usePendingRemovals } from '@/lib/collection/pending-removals';
import { ToastPill } from '../toast-pill';

export function RemovalToast() {
  const owner = useLocalOwner();
  const pending = usePendingRemovals().filter((item) => item.owner === owner);
  return <>{pending.map((item) => <ToastPill key={item.localId} busy={item.status === 'saving'}
    message={item.status === 'failed' ? `Couldn’t remove ${item.title}.` : item.status === 'saving' ? 'Removing artwork…' : 'Artwork removed. Museum visits kept.'}
    actions={[...(item.status === 'failed' ? [{ label: 'Retry', onPress: () => { void commitRemoval(item); } }] : []),
      ...(item.status !== 'saving' ? [{ label: 'Undo', onPress: () => undoRemoval(item) }] : [])]} />)}</>;
}
