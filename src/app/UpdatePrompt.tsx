import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '../ui/kit';

/** Offers the new version instead of reloading under the user's thumb. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;
  return (
    <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 px-4">
      <div className="mx-auto flex max-w-xl items-center gap-3 rounded-2xl border border-line bg-card p-3 shadow-lg">
        <p className="flex-1">A new version is ready.</p>
        <Button variant="ghost" onClick={() => setNeedRefresh(false)}>
          Later
        </Button>
        <Button variant="primary" onClick={() => void updateServiceWorker(true)}>
          Update
        </Button>
      </div>
    </div>
  );
}
