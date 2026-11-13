const META_STATUS_RANK: Record<string, number> = {
  accepted: 0,
  sent: 1,
  failed: 2,
  delivered: 3,
  read: 4,
};

/** Select the furthest monotonic Meta delivery state, then the newest event at that state. */
export function mostAdvancedMetaStatus<T extends { status: string; provider_timestamp?: string | null }>(events: readonly T[]): T | null {
  let selected: T | null = null;
  for (const event of events) {
    const rank = META_STATUS_RANK[event.status];
    if (rank === undefined) continue;
    if (!selected) {
      selected = event;
      continue;
    }
    const selectedRank = META_STATUS_RANK[selected.status] ?? -1;
    const eventTime = event.provider_timestamp ? Date.parse(event.provider_timestamp) : 0;
    const selectedTime = selected.provider_timestamp ? Date.parse(selected.provider_timestamp) : 0;
    if (rank > selectedRank || (rank === selectedRank && eventTime > selectedTime)) selected = event;
  }
  return selected;
}
