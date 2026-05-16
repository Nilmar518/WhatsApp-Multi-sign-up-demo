import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import type { MigoProperty } from '../api/migoPropertyApi';

interface Result {
  pools: MigoProperty[];
  loading: boolean;
  error: string | null;
}

export function useMigoProperties(tenantId: string): Result {
  const [pools, setPools] = useState<MigoProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setPools([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const q = query(
      collection(db, 'migo_properties'),
      where('tenant_id', '==', tenantId),
      orderBy('created_at', 'desc'),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setPools(snapshot.docs.map((doc) => doc.data() as MigoProperty));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [tenantId]);

  return { pools, loading, error };
}
