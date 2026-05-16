import { useMemo } from 'react';
import type { Message } from '../types/message';

export interface Contact {
  waId: string;          // customer's wa_id (e.g. "59167025559")
  lastMessage: string;   // text preview for sidebar
  lastTimestamp: string; // ISO string — used for sort + display
}

/**
 * useConversations
 *
 * Derives a deduplicated, timestamp-sorted contact list from the flat
 * messages array. A contact is created for every unique inbound `from`
 * value. Last-message metadata is updated whenever a newer message
 * (inbound or outbound) involves that contact.
 *
 * No new Firestore subscription — reuses the existing useMessages result.
 */
export function useConversations(messages: Message[]): Contact[] {
  return useMemo(() => {
    const map = new Map<string, { lastMessage: string; lastTimestamp: string }>();

    for (const msg of messages) {
      // The contact key is always the customer's wa_id:
      //   inbound  → msg.from
      //   outbound → msg.to (populated by messaging.service.ts)
      const waId = msg.direction === 'inbound' ? msg.from : (msg.to ?? null);
      if (!waId) continue;

      const existing = map.get(waId);
      if (!existing || msg.timestamp > existing.lastTimestamp) {
        map.set(waId, { lastMessage: msg.text, lastTimestamp: msg.timestamp });
      }
    }

    return Array.from(map.entries())
      .map(([waId, { lastMessage, lastTimestamp }]) => ({
        waId,
        lastMessage,
        lastTimestamp,
      }))
      .sort((a, b) => (b.lastTimestamp ?? '').localeCompare(a.lastTimestamp ?? ''));
  }, [messages]);
}
