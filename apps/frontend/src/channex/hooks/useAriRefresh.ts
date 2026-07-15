import { useEffect } from 'react';
import { refreshARISnapshot } from '../api/channexHubApi';

const TTL_MS = 60_000;

// Channex no emite webhooks de ARI: un cambio hecho fuera de nuestra app (panel
// de Channex, extranet de Airbnb/Booking, otro PMS) no llega solo. Refrescamos el
// snapshot al montar, al cambiar de mes/propiedad y al volver el foco a la pestaña.
// Estado a nivel módulo: varias secciones piden el mismo mes y no queremos N pulls.
const lastRefresh = new Map<string, number>();
const inFlight = new Set<string>();

export function useAriRefresh(tenantId: string, propertyId: string, monthKey: string): void {
  useEffect(() => {
    if (!tenantId || !propertyId || !monthKey) return;
    const key = `${tenantId}|${propertyId}|${monthKey}`;

    const run = () => {
      const now = Date.now();
      if (inFlight.has(key)) return;
      if (now - (lastRefresh.get(key) ?? 0) < TTL_MS) return;
      inFlight.add(key);
      lastRefresh.set(key, now);
      refreshARISnapshot(propertyId, tenantId, monthKey)
        .catch(() => lastRefresh.delete(key)) // falló: que el próximo foco reintente
        .finally(() => inFlight.delete(key));
    };

    run();
    window.addEventListener('focus', run);
    return () => window.removeEventListener('focus', run);
  }, [tenantId, propertyId, monthKey]);
}
