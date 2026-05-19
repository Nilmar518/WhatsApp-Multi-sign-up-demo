import { useEffect, useState } from 'react';
import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';

export interface ChannexThread {
  id: string;
  propertyId: string;
  tenantId: string;
  guestName: string;
  lastMessage: string | null;
  lastMessageSender: 'host' | 'guest' | null;
  updatedAt: Timestamp | null;
  bookingId: string | null;
  isInquiry: boolean;
  listingName: string | null;
  checkinDate: string | null;
  checkoutDate: string | null;
}

function resolveGuestName(d: Record<string, unknown>): string {
  const stored = d.guestName as string | undefined;
  if (stored && stored !== 'Unknown Guest') return stored;
  const bd = d.bookingDetails as Record<string, unknown> | undefined;
  const fromBooking = bd?.guest_name as string | undefined;
  if (fromBooking && fromBooking !== 'Unknown Guest') return fromBooking;
  return 'Unknown Guest';
}

function nameFromBookingDoc(d: Record<string, unknown>): string | null {
  const customerName = (d.customer_name as string | null | undefined)?.trim();
  if (customerName) return customerName;
  const first = ((d.guest_first_name as string | null | undefined) ?? '').trim();
  const last = ((d.guest_last_name as string | null | undefined) ?? '').trim();
  const full = [first, last].filter(Boolean).join(' ');
  return full || null;
}

async function enrichWithBookingNames(
  threads: ChannexThread[],
  tenantId: string,
): Promise<Map<string, string>> {
  const toEnrich = threads.filter((t) => t.guestName === 'Unknown Guest' && t.bookingId);
  if (!toEnrich.length) return new Map();

  const results = await Promise.all(
    toEnrich.map(async (t) => {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'channex_integrations', tenantId, 'bookings'),
            where('channex_booking_id', '==', t.bookingId),
            limit(1),
          ),
        );
        if (!snap.empty) {
          const name = nameFromBookingDoc(snap.docs[0].data() as Record<string, unknown>);
          if (name) return { id: t.id, name };
        }
      } catch {
        // silently skip — thread keeps 'Unknown Guest'
      }
      return null;
    }),
  );

  const map = new Map<string, string>();
  for (const r of results) {
    if (r) map.set(r.id, r.name);
  }
  return map;
}

function mapDoc(
  doc: { id: string; data(): Record<string, unknown> },
  fallbackPropertyId: string,
  fallbackTenantId: string,
): ChannexThread {
  const d = doc.data();
  return {
    id: doc.id,
    propertyId: (d.propertyId as string) ?? fallbackPropertyId,
    tenantId: (d.tenantId as string) ?? fallbackTenantId,
    guestName: resolveGuestName(d),
    lastMessage: (d.lastMessage as string | null) ?? null,
    lastMessageSender: (d.lastMessageSender as 'host' | 'guest' | null) ?? null,
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
  const [nameOverrides, setNameOverrides] = useState<Map<string, string>>(new Map());

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

  // Stable key: only threads still showing Unknown Guest with a bookingId
  const unknownKey = threads
    .filter((t) => t.guestName === 'Unknown Guest' && t.bookingId)
    .map((t) => t.id)
    .join(',');

  useEffect(() => {
    if (!unknownKey || !tenantId) return;
    void enrichWithBookingNames(threads, tenantId).then((overrides) => {
      if (overrides.size > 0) {
        setNameOverrides((prev) => new Map([...prev, ...overrides]));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unknownKey, tenantId]);

  const enrichedThreads = threads.map((t) =>
    nameOverrides.has(t.id) ? { ...t, guestName: nameOverrides.get(t.id)! } : t,
  );

  return { threads: enrichedThreads, loading };
}

/**
 * Threads merged across multiple properties — used by the global inbox in the
 * Airbnb / Booking.com connection tabs. Opens one Firestore subscription per
 * property and merges the results sorted by most-recent first.
 */
export function useAllPropertyThreads(tenantId: string, propertyIds: string[]) {
  const [threadsByProperty, setThreadsByProperty] = useState<Map<string, ChannexThread[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [nameOverrides, setNameOverrides] = useState<Map<string, string>>(new Map());

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

  const allThreads = Array.from(threadsByProperty.values())
    .flat()
    .sort((a, b) => (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0));

  const unknownKey = allThreads
    .filter((t) => t.guestName === 'Unknown Guest' && t.bookingId)
    .map((t) => t.id)
    .join(',');

  useEffect(() => {
    if (!unknownKey || !tenantId) return;
    void enrichWithBookingNames(allThreads, tenantId).then((overrides) => {
      if (overrides.size > 0) {
        setNameOverrides((prev) => new Map([...prev, ...overrides]));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unknownKey, tenantId]);

  const enrichedThreads = allThreads.map((t) =>
    nameOverrides.has(t.id) ? { ...t, guestName: nameOverrides.get(t.id)! } : t,
  );

  return { threads: enrichedThreads, loading };
}
