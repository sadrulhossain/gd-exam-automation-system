import { useEffect, useState } from 'react';
import { seatCount } from '@eas/allocation';
import { appName } from '@eas/shared';
import { fetchHealth } from './lib/health';

type ApiState = 'checking' | 'ok' | 'unreachable';

export function App() {
  const [api, setApi] = useState<ApiState>('checking');

  useEffect(() => {
    fetchHealth()
      .then((h) => setApi(h.status === 'ok' ? 'ok' : 'unreachable'))
      .catch(() => setApi('unreachable'));
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-50">
      <h1 className="text-3xl font-semibold text-slate-900">{appName()}</h1>
      <p className="text-slate-600">Seat plans and duty plans. Setup in progress.</p>
      <p className="text-sm text-slate-400">
        Workspace check: 4 x 6 room = {seatCount(4, 6)} seats
      </p>
      <p className="text-sm text-slate-500" data-testid="api-status">
        API: {api}
      </p>
    </main>
  );
}
