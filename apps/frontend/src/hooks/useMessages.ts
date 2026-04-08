import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase/firebase';
import type { Message } from '../types/message';

/**
 * useMessages  (Phase 4 — UUID-keyed documents)
 *
 * Real-time listener on `integrations/{integrationId}/messages` where
 * integrationId is the UUID Firestore document ID (not the businessId).
 *
 * When integrationId is null (not yet resolved by useIntegrationId), returns
 * an empty array immediately without opening a Firestore listener.
 *
 * Re-runs automatically when integrationId changes (BusinessToggle → useIntegrationId).
 */
export function useMessages(integrationId: string | null): Message[] {
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    setMessages([]);

    if (!integrationId) return;

    const path = `integrations/${integrationId}/messages`;
    console.log(`LISTENING_TO_FIRESTORE_PATH: ${path}`);

    const q = query(
      collection(db, 'integrations', integrationId, 'messages'),
      orderBy('timestamp', 'asc'),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        console.log(`[useMessages] snapshot received — ${snapshot.docs.length} doc(s) in ${path}`);
        setMessages(snapshot.docs.map((d) => d.data() as Message));
      },
      (error) => {
        console.error('[useMessages onSnapshot error]', error);
      },
    );

    return () => unsubscribe();
  }, [integrationId]);

  return messages;
}

