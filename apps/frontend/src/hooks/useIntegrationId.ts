import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, query, where, QueryConstraint } from 'firebase/firestore';
import { db } from '../firebase/firebase';

/**
 * useIntegrationId
 *
 * Phase 4: resolves the Firestore document ID (integrationId) for a given
 * businessId using a real-time Firestore listener on `integrations` where
 * `connectedBusinessIds` contains the current businessId.
 *
 * @param businessId - tenant identifier
 * @param provider   - optional provider filter ('META' | 'META_MESSENGER').
 *                     When supplied, adds a where('provider', '==', provider)
 *                     constraint so only the matching channel's integration is
 *                     returned. Required when a business has integrations for
 *                     multiple providers (WhatsApp + Messenger).
 *
 *                     Production note: combining array-contains with an equality
 *                     filter on a different field requires a Firestore composite
 *                     index on (connectedBusinessIds, provider). The plan doc
 *                     already lists this index as a required deployment step.
 *
 * Returns:
 *   integrationId — UUID string when an integration exists, null otherwise.
 *   isLoading     — true while the initial snapshot is pending.
 *
 * Re-runs automatically when businessId or provider changes.
 */
export function useIntegrationId(
  businessId: string,
  provider?: string,
  refreshKey = 0,
): {
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

    const constraints: QueryConstraint[] = [
      where('connectedBusinessIds', 'array-contains', businessId),
    ];
    if (provider) {
      constraints.push(where('provider', '==', provider));
    }
    constraints.push(limit(1));

    const q = query(collection(db, 'integrations'), ...constraints);

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
  }, [businessId, provider, refreshKey]);

  return { integrationId, isLoading };
}
