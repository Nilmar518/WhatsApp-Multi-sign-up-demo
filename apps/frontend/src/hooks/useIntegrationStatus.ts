import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/firebase';
import type { IntegrationStatus } from '../types/integration';
import type { CatalogData } from '../types/catalog';

/**
 * useIntegrationStatus  (Phase 4 — UUID-keyed documents)
 *
 * Single onSnapshot listener on `integrations/{integrationId}` where
 * integrationId is a UUID generated at connect-time (not the businessId).
 *
 * When integrationId is null (still resolving via useIntegrationId), the
 * hook returns IDLE immediately without opening a Firestore listener.
 *
 * Re-runs automatically when integrationId changes.
 */
export function useIntegrationStatus(
  integrationId: string | null,
  refreshKey = 0,
) {
  const [status, setStatus] = useState<IntegrationStatus>('IDLE');
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [metaData, setMetaData] = useState<Record<string, unknown> | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Reset to loading state on every integrationId change
    setIsLoading(true);
    setStatus('IDLE');
    setCatalog(null);
    setMetaData(null);

    // If no integration has been created yet for this business, stay IDLE
    if (!integrationId) {
      setIsLoading(false);
      return;
    }

    const docRef = doc(db, 'integrations', integrationId);

    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setStatus(data.status as IntegrationStatus);
          setCatalog((data.catalog ?? null) as CatalogData | null);
          setMetaData((data.metaData ?? null) as Record<string, unknown> | null);
        } else {
          setStatus('IDLE');
          setCatalog(null);
          setMetaData(null);
        }
        setIsLoading(false);
      },
      (error) => {
        console.error('[Firestore onSnapshot error]', error);
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [integrationId, refreshKey]);

  return { status, catalog, metaData, isLoading };
}
