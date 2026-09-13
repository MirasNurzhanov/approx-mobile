export type HistoryPage<T> = { results: T[]; next_before: number | null; has_more: boolean };

/** Fetch through the last known server ID, including gaps longer than one page. */
export async function catchUpHistory<T extends { id?: string | number }>(
  fetchPage: (before?: number) => Promise<HistoryPage<T>>,
  latestKnownId: number,
  active: () => boolean = () => true,
): Promise<{ rows: T[]; firstPage: HistoryPage<T> } | null> {
  let before: number | undefined;
  let firstPage: HistoryPage<T> | undefined;
  const rows: T[] = [];
  while (active()) {
    const page = await fetchPage(before);
    if (!active()) return null;
    firstPage ??= page;
    rows.push(...page.results);
    if (!latestKnownId || page.results.some(row => Number(row.id) <= latestKnownId)
        || !page.has_more || page.next_before === null) break;
    if (before !== undefined && page.next_before >= before) throw new Error('History cursor did not advance.');
    before = page.next_before;
  }
  return firstPage ? { rows, firstPage } : null;
}

export interface IdentifiedMessage {
  id: string;
  client_id?: string | null;
  sender_id: number;
  pending?: boolean;
  failed?: boolean;
  failure?: string;
}

/** ID/client-ID reconciliation never uses text or the position of a pending bubble. */
export function mergeMessages<T extends IdentifiedMessage>(existing: T[], incoming: T[]): T[] {
  let result = [...existing];
  for (const message of incoming) {
    result = result.filter(row => row.id !== message.id && !(
      message.client_id && row.client_id === message.client_id && row.sender_id === message.sender_id
    ));
    result.push(message);
  }
  return result.sort((a, b) => {
    const left = Number(a.id), right = Number(b.id);
    if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
    if (Number.isFinite(left)) return -1;
    if (Number.isFinite(right)) return 1;
    return 0;
  });
}

export function failMessage<T extends IdentifiedMessage>(rows: T[], clientId: string, detail = 'Delivery not confirmed.'): T[] {
  return rows.map(row => row.client_id === clientId && row.pending
    ? { ...row, pending: false, failed: true, failure: detail } : row);
}

export function newMessageId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const value = Math.floor(Math.random() * 16);
    return (character === 'x' ? value : (value & 3) | 8).toString(16);
  });
}
