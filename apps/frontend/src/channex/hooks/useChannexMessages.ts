import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';

export interface ChannexMessage {
  id: string;
  text: string;
  sender: string;
  guestName: string | null;
  createdAt: Timestamp | null;
}

export function useThreadMessages(tenantId: string, propertyId: string, threadId: string) {
  const [messages, setMessages] = useState<ChannexMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId || !propertyId || !threadId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(
        db,
        'channex_integrations', tenantId,
        'properties', propertyId,
        'threads', threadId,
        'messages',
      ),
      orderBy('createdAt', 'asc'),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setMessages(
          snap.docs.map((doc) => {
            const d = doc.data();
            return {
              id: doc.id,
              text: (d.text as string) ?? '',
              sender: (d.sender as string) ?? 'unknown',
              guestName: (d.guestName as string | null) ?? null,
              createdAt: (d.createdAt as Timestamp | null) ?? null,
            };
          }),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );

    return () => unsub();
  }, [tenantId, propertyId, threadId]);

  return { messages, loading };
}
