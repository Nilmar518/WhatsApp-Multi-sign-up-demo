import ARICalendar from '../../../airbnb/components/ARICalendar';
import type { ActiveProperty } from '../AirbnbIntegration';

interface Props {
  integrationDocId: string | null;
  activeProperty: ActiveProperty | null;
}

export default function InventoryView({ integrationDocId, activeProperty }: Props) {
  const canRenderCalendar = Boolean(
    activeProperty &&
      activeProperty.channex_property_id &&
      activeProperty.channex_channel_id &&
      activeProperty.airbnb_listing_id,
  );

  if (!canRenderCalendar) {
    return (
      <div className="overflow-hidden rounded-2xl border border-edge bg-surface-raised shadow-sm">
        <div className="px-6 py-10 text-center text-sm text-content-2">
          Select a synced listing from the sidebar to load the calendar view.
        </div>
      </div>
    );
  }

  return <ARICalendar integrationDocId={integrationDocId} activeProperty={activeProperty} />;
}