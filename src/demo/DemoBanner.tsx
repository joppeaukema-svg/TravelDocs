import { isDemo } from '../db/db';
import { Button, Card } from '../ui/kit';
import { DEMO_PASSPHRASE, enterDemo, exitDemo } from './demo';

export function DemoBanner() {
  if (!isDemo) return null;
  return (
    <div className="no-print border-b border-info/30 bg-info-soft px-4 py-2 text-info" role="status">
      <div className="mx-auto flex max-w-xl items-center gap-3">
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-bold">Demo mode</span> — sample data only. Vault passphrase: <span className="font-mono">{DEMO_PASSPHRASE}</span>
        </p>
        <button type="button" className="min-h-10 shrink-0 rounded-full border border-info/40 px-3 text-sm font-bold" onClick={() => void exitDemo()}>
          Leave demo
        </button>
      </div>
    </div>
  );
}

/** Explains demo mode and switches to it. */
export function DemoCard() {
  if (isDemo) return null;
  return (
    <Card>
      <p className="font-bold">Demo mode</p>
      <p className="mt-1 text-muted">
        Look around with a sample trip, documents, insurance and expenses. It uses a separate store on this phone: your own data
        stays untouched and comes back when you leave the demo.
      </p>
      <Button className="mt-3 w-full" onClick={enterDemo}>
        Try demo mode
      </Button>
    </Card>
  );
}
