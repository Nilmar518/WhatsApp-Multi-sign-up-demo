import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase/firebase';

/**
 * useIntegrationId
 *
 * Phase 4: resolves the Firestore document ID (integrationId) for a given
 * businessId using a real-time Firestore listener on `integrations` where
 * `connectedBusinessIds` contains the current businessId.
 *
 * Returns:
 *   integrationId — UUID string when an integration exists, null otherwise.
 *   isLoading     — true while the initial snapshot is pending.
 *
 * Re-runs automatically when businessId changes (BusinessToggle).
 */
export function useIntegrationId(businessId: string): {
  integrationId: string | null;
  isLoading: boolean;
} {
  const [integrationId, setIntegrationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    setIntegrationId(null);

    if (!businessId) {
      setIsLoading(false);
      return;
    }

    const q = query(
      collection(db, 'integrations'),
      where('connectedBusinessIds', 'array-contains', businessId),
      limit(1),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setIntegrationId(snapshot.empty ? null : snapshot.docs[0].id);
        setIsLoading(false);
      },
      (error) => {
        console.error('[useIntegrationId] onSnapshot error:', error);
        setIntegrationId(null);
        setIsLoading(false);
      },
    );

    return () => {
      unsubscribe();
    };
  }, [businessId]);

  return { integrationId, isLoading };
}
