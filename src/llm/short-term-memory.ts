import type { RecentExchange } from '../db/campaigns-repo';

export function appendExchange(
  current: RecentExchange[],
  exchange: RecentExchange,
  maxSize = 5
): RecentExchange[] {
  return [...current, exchange].slice(-maxSize);
}
