import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/firebase';
import type { IntegrationStatus } from '../types/integration';
import type { CatalogData } from '../types/catalog';

/**
 * useIntegrationStatus
 *
 * Single onSnapshot listener on `integrations/{businessId}`.
 * Returns status and catalog from the root document.
 * Messages are handled separately by useMessages (sub-collection listener).
 *
 * Re-runs automatically when businessId changes (BusinessToggle).
 */
export function useIntegrationStatus(businessId: string) {
  const [status, setStatus] = useState<IntegrationStatus>('IDLE');
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Reset to loading state when switching business contexts
    setIsLoading(true);
    setStatus('IDLE');
    setCatalog(null);

    const docRef = doc(db, 'integrations', businessId);

    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setStatus(data.status as IntegrationStatus);
          setCatalog((data.catalog ?? null) as CatalogData | null);
        } else {
          setStatus('IDLE');
          setCatalog(null);
        }
        setIsLoading(false);
      },
      (error) => {
        console.error('[Firestore onSnapshot error]', error);
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [businessId]);

  return { status, catalog, isLoading };
}
