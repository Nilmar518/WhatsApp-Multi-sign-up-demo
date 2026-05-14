import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import type { StoredRoomType } from '../api/channexHubApi';

export type ConnectionStatus = 'pending' | 'active' | 'token_expired' | 'error';

export interface ChannexProperty {
  firestoreDocId: string;
  channex_property_id: string;
  title: string;
  currency: string;
  timezone: string;
  connection_status: ConnectionStatus;
  connected_channels: string[];
  room_types: StoredRoomType[];
}

interface Result {
  properties: ChannexProperty[];
  loading: boolean;
  error: string | null;
}

export interface UseChannexPropertiesOptions {
  source?: 'airbnb' | 'booking';
}

export function useChannexProperties(
  tenantId: string,
  options?: UseChannexPropertiesOptions,
): Result {
  const [properties, setProperties] = useState<ChannexProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setProperties([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const propertiesCol = collection(db, 'channex_integrations', tenantId, 'properties');

    const unsubscribe = onSnapshot(
      propertiesCol,
      (snapshot) => {
        let next: ChannexProperty[] = snapshot.docs.map((doc) => {
          const d = doc.data();
          return {
            firestoreDocId: doc.id,
            channex_property_id: (d.channex_property_id as string) ?? '',
            title: (d.title as string) ?? 'Untitled Property',
            currency: (d.currency as string) ?? 'USD',
            timezone: (d.timezone as string) ?? 'America/New_York',
            connection_status: (d.connection_status as ConnectionStatus) ?? 'pending',
            connected_channels: (d.connected_channels as string[]) ?? [],
            room_types: (d.room_types as StoredRoomType[]) ?? [],
          };
        });

        if (options?.source) {
          const src = options.source;
          next = next.filter((p) => p.connected_channels.includes(src));
        }

        setProperties(next);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [tenantId, options?.source]);

  return { properties, loading, error };
}
