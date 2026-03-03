import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase/firebase';
import type { Message } from '../types/message';

/**
 * useMessages
 *
 * Real-time listener on `integrations/{businessId}/messages` sub-collection.
 * Returns messages sorted by timestamp ascending, updating immediately as
 * the backend writes inbound or outbound documents.
 *
 * Re-runs automatically when businessId changes (BusinessToggle).
 */
export function useMessages(businessId: string): Message[] {
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    setMessages([]);

    const path = `integrations/${businessId}/messages`;
    console.log(`LISTENING_TO_FIRESTORE_PATH: ${path}`);

    const q = query(
      collection(db, 'integrations', businessId, 'messages'),
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
  }, [businessId]);

  return messages;
}
