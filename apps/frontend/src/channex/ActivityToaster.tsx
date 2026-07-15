import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { Toasts, useToasts, type ToastVariant } from '../components/ui';

const FALLBACK_BID = '787167007221172';

/**
 * Escucha el feed de actividad del tenant y lo muestra como toasts.
 *
 * El backend escribe un doc por cada cambio ya confirmado (webhook de reserva, o
 * push de ARI aceptado por Channex), así que esto avisa igual estés donde estés y
 * en todas las sesiones abiertas — incluida la que hizo el cambio.
 *
 * Va montado una sola vez en MainLayout.
 */
export default function ActivityToaster() {
  const [businessId, setBusinessId] = useState(FALLBACK_BID);
  const { toasts, showToast, dismissToast } = useToasts();

  useEffect(() => {
    fetch('/api/integrations/businesses')
      .then((r) => r.json())
      .then((ids: string[]) => { if (ids.length > 0) setBusinessId(ids[0]); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!businessId) return;

    // Los docs son inmutables: sólo llegan 'added'. El primer snapshot trae los
    // últimos 30 ya existentes — se usan de línea base y no se notifican.
    const seen = new Set<string>();
    let baselineReady = false;

    const q = query(
      collection(db, 'channex_integrations', businessId, 'activity'),
      orderBy('createdAt', 'desc'),
      limit(30),
    );

    const unsub = onSnapshot(q, (snap) => {
      if (!baselineReady) {
        for (const d of snap.docs) seen.add(d.id);
        baselineReady = true;
        return;
      }
      for (const change of snap.docChanges()) {
        if (change.type !== 'added' || seen.has(change.doc.id)) continue;
        seen.add(change.doc.id);
        const { message, variant } = change.doc.data() as { message?: string; variant?: ToastVariant };
        if (message) showToast(message, variant ?? 'notice');
      }
    }, () => {});

    return () => unsub();
  }, [businessId, showToast]);

  return <Toasts toasts={toasts} onDismiss={dismissToast} />;
}
