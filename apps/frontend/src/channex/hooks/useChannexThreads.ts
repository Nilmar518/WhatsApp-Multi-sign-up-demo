import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';

export interface ChannexThread {
  id: string;
  propertyId: string;
  tenantId: string;
  guestName: string;
  lastMessage: string | null;
  updatedAt: Timestamp | null;
  bookingId: string | null;
  isInquiry: boolean;
  listingName: string | null;
  checkinDate: string | null;
  checkoutDate: string | null;
}

function mapDoc(doc: { id: string; data(): Record<string, unknown> }, fallbackPropertyId: string, fallbackTenantId: string): ChannexThread {
  const d = doc.data();
  return {
    id: doc.id,
    propertyId: (d.propertyId as string) ?? fallbackPropertyId,
    tenantId: (d.tenantId as string) ?? fallbackTenantId,
    guestName: (d.guestName as string) ?? 'Unknown Guest',
    lastMessage: (d.lastMessage as string | null) ?? null,
    updatedAt: (d.updatedAt as Timestamp | null) ?? null,
    bookingId: (d.bookingId as string | null) ?? null,
    isInquiry: (d.isInquiry as boolean) ?? false,
    listingName: (d.listingName as string | null) ?? null,
    checkinDate: (d.checkinDate as string | null) ?? null,
    checkoutDate: (d.checkoutDate as string | null) ?? null,
  };
}

/** Threads for a single property — used by the Messages tab in PropertyDetail. */
export function usePropertyThreads(tenantId: string, propertyId: string) {
  const [threads, setThreads] = useState<ChannexThread[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId || !propertyId) {
      setThreads([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'channex_integrations', tenantId, 'properties', propertyId, 'threads'),
      orderBy('updatedAt', 'desc'),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setThreads(snap.docs.map((doc) => mapDoc(doc, propertyId, tenantId)));
        setLoading(false);
      },
      () => setLoading(false),
    );

    return () => unsub();
  }, [tenantId, propertyId]);

  return { threads, loading };
}

/**
 * Threads merged across multiple properties — used by the global inbox in the
 * Airbnb / Booking.com connection tabs. Opens one Firestore subscription per
 * property and merges the results sorted by most-recent first.
 */
export function useAllPropertyThreads(tenantId: string, propertyIds: string[]) {
  const [threadsByProperty, setThreadsByProperty] = useState<Map<string, ChannexThread[]>>(new Map());
  const [loading, setLoading] = useState(true);

  // Stable dep: sorted join so array order / reference changes don't re-trigger
  const idsKey = [...propertyIds].sort().join(',');

  useEffect(() => {
    if (!tenantId || !propertyIds.length) {
      setThreadsByProperty(new Map());
      setLoading(false);
      return;
    }

    const local = new Map<string, ChannexThread[]>();
    let pending = propertyIds.length;
    const unsubs: (() => void)[] = [];

    for (const propertyId of propertyIds) {
      const q = query(
        collection(db, 'channex_integrations', tenantId, 'properties', propertyId, 'threads'),
        orderBy('updatedAt', 'desc'),
      );

      const unsub = onSnapshot(
        q,
        (snap) => {
          local.set(propertyId, snap.docs.map((doc) => mapDoc(doc, propertyId, tenantId)));
          pending = Math.max(0, pending - 1);
          if (pending === 0) setLoading(false);
          setThreadsByProperty(new Map(local));
        },
        () => {
          pending = Math.max(0, pending - 1);
          if (pending === 0) setLoading(false);
        },
      );

      unsubs.push(unsub);
    }

    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, idsKey]);

  const threads = Array.from(threadsByProperty.values())
    .flat()
    .sort((a, b) => (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0));

  return { threads, loading };
}
