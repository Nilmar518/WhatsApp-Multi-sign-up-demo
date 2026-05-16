import { useMemo } from 'react';
import { MessageCircle, MessageSquare, Camera, Hotel, Package, Users, Wifi } from 'lucide-react';
import type { IntegrationStatus } from '../../types/integration';
import type { Message } from '../../types/message';
import type { Contact } from '../../hooks/useConversations';
import type { CatalogData } from '../../types/catalog';
import type { TranslationKey } from '../../i18n/es';
import { useChannexProperties } from '../../channex/hooks/useChannexProperties';
import CatalogView from '../CatalogView';
import { navigate } from '../../lib/navigate';
import { useLanguage } from '../../context/LanguageContext';

// ── helpers ────────────────────────────────────────────────────────────────────

function todayPrefix(): string {
  return new Date().toISOString().split('T')[0];
}

function relativeTime(iso: string, t: (key: TranslationKey) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return t('dash.time.now');
  if (m < 60) return t('dash.time.minAgo').replace('{n}', String(m));
  const h = Math.floor(m / 60);
  if (h < 24) return t('dash.time.hourAgo').replace('{n}', String(h));
  return t('dash.time.dayAgo').replace('{n}', String(Math.floor(h / 24)));
}

function avatarBg(waId: string): string {
  const palette = ['#7c3aed', '#0891b2', '#16a34a', '#d97706', '#dc2626', '#0866ff', '#9333ea', '#0d9488'];
  let h = 0;
  for (let i = 0; i < waId.length; i++) h = waId.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}

// ── KpiCard ───────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: React.ReactNode;
  icon: React.ReactNode;
  iconBg: string;
  valueColor: string;
}

function KpiCard({ label, value, sub, icon, iconBg, valueColor }: KpiCardProps) {
  return (
    <div className="bg-surface-raised border border-edge rounded-xl p-4 shadow-sm flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-content-2 uppercase tracking-widest leading-tight">
          {label}
        </span>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          {icon}
        </div>
      </div>
      <div className={`text-[28px] font-extrabold leading-none tracking-tight ${valueColor}`}>{value}</div>
      {sub && <div className="text-[11px] text-content-3 flex items-center gap-1.5 flex-wrap">{sub}</div>}
    </div>
  );
}

// ── ChannelCard ───────────────────────────────────────────────────────────────

type ChannelId = 'whatsapp' | 'messenger' | 'instagram';

const CH_META: Record<ChannelId, { label: string; cssVar: string; iconBg: string }> = {
  whatsapp:  { label: 'WhatsApp',  cssVar: 'var(--ch-wa)', iconBg: '#dcfce7' },
  messenger: { label: 'Messenger', cssVar: 'var(--ch-ms)', iconBg: '#dbeafe' },
  instagram: { label: 'Instagram', cssVar: 'var(--ch-ig)', iconBg: '#fce7f3' },
};

const CH_ICON: Record<ChannelId, React.ReactNode> = {
  whatsapp:  <MessageCircle size={18} />,
  messenger: <MessageSquare size={18} />,
  instagram: <Camera size={18} />,
};

interface ChannelCardProps {
  channel: ChannelId;
  isConnected: boolean;
  messagesToday: number;
  conversations: number;
}

function ChannelCard({ channel, isConnected, messagesToday, conversations }: ChannelCardProps) {
  const { t } = useLanguage();
  const meta = CH_META[channel];

  const stats = [
    { val: isConnected ? messagesToday : '—', lbl: t('dash.channel.msgsToday') },
    { val: isConnected ? conversations : '—',  lbl: t('dash.channel.convs') },
  ];

  return (
    <div
      className="bg-surface-raised border border-edge rounded-xl p-4 shadow-sm flex flex-col gap-3"
      style={{ borderTop: `3px solid ${meta.cssVar}` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: meta.iconBg, color: meta.cssVar }}
          >
            {CH_ICON[channel]}
          </div>
          <p className="text-[13px] font-bold text-content">{meta.label}</p>
        </div>
        <div
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
            isConnected ? 'bg-ok/10 text-ok-text' : 'bg-surface-subtle text-content-3'
          }`}
        >
          <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-ok' : 'bg-content-3'}`} />
          {isConnected ? t('dash.channel.active') : t('dash.channel.offline')}
        </div>
      </div>

      {/* Stats */}
      <div className={`flex gap-3 ${!isConnected ? 'opacity-30 pointer-events-none' : ''}`}>
        {stats.map(({ val, lbl }) => (
          <div key={lbl} className="flex-1 bg-surface-subtle rounded-lg py-2 px-2.5 text-center">
            <p className="text-[17px] font-bold text-content leading-tight">{val}</p>
            <p className="text-[10px] text-content-3 font-semibold uppercase tracking-wider mt-0.5">{lbl}</p>
          </div>
        ))}
      </div>

      {/* CTA */}
      <button
        onClick={() => navigate(`/mensajes?channel=${channel}`)}
        className={`w-full text-center text-[12px] font-semibold py-2 rounded-lg transition-colors cursor-pointer ${
          isConnected
            ? 'bg-surface-subtle text-content-2 hover:bg-edge hover:text-content'
            : 'bg-brand text-white hover:bg-brand-hover'
        }`}
      >
        {isConnected ? t('dash.channel.viewConvs') : `${t('dash.channel.connect')} ${meta.label}`}
      </button>
    </div>
  );
}

// ── RecentConversations ───────────────────────────────────────────────────────

type ChannelContact = Contact & { channel: ChannelId };

function RecentConversations({ items }: { items: ChannelContact[] }) {
  const { t } = useLanguage();
  const chColor: Record<ChannelId, string> = {
    whatsapp:  'var(--ch-wa)',
    messenger: 'var(--ch-ms)',
    instagram: 'var(--ch-ig)',
  };

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center py-12 text-content-3 text-sm">
        {t('dash.recentConvs.empty')}
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-edge">
      {items.map((c) => (
        <div
          key={`${c.channel}-${c.waId}`}
          onClick={() => navigate(`/mensajes?channel=${c.channel}`)}
          className="flex items-center gap-3 py-3 px-1 rounded-lg hover:bg-surface-subtle cursor-pointer transition-colors"
        >
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold"
              style={{ background: avatarBg(c.waId) }}
            >
              {c.waId.slice(-2)}
            </div>
            <div
              className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-surface-raised"
              style={{ background: chColor[c.channel] }}
            />
          </div>

          {/* Body */}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-content truncate">{c.waId}</p>
            <p className="text-[11px] text-content-3 truncate">{c.lastMessage}</p>
          </div>

          {/* Time */}
          <span className="text-[10px] text-content-3 flex-shrink-0">{relativeTime(c.lastTimestamp, t)}</span>
        </div>
      ))}
    </div>
  );
}

// ── CatalogCard ───────────────────────────────────────────────────────────────

interface CatalogCardProps {
  businessId: string;
  catalog: CatalogData | null;
  activeCatalogId: string | undefined;
  catalogIntegrationId: string | null;
  catalogStatus: IntegrationStatus;
  onCatalogLinked: () => void;
}

function CatalogCard({
  businessId,
  catalog,
  activeCatalogId,
  catalogIntegrationId,
  catalogStatus,
  onCatalogLinked,
}: CatalogCardProps) {
  const { t } = useLanguage();

  if (!catalog) {
    return (
      <div className="bg-surface-raised border border-edge rounded-xl p-4 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-bold text-content">{t('dash.catalog.title')}</span>
          <Package size={14} className="text-content-3" />
        </div>
        {catalogIntegrationId ? (
          <CatalogView
            businessId={businessId}
            status={catalogStatus}
            activeCatalogId={activeCatalogId}
            onCatalogLinked={onCatalogLinked}
          />
        ) : (
          <p className="text-[12px] text-caution-text bg-caution-bg border border-caution/30 rounded-lg px-3 py-2">
            {t('dash.catalog.noChannel')}
          </p>
        )}
      </div>
    );
  }

  const total    = catalog.products.length;
  const inStock  = catalog.products.filter((p) => p.availability === 'in stock').length;
  const noStock  = catalog.products.filter((p) => p.availability === 'out of stock').length;
  const other    = total - inStock - noStock;

  const catalogStats = [
    { val: total,   lbl: t('dash.catalog.total'),     color: 'text-brand' },
    { val: inStock, lbl: t('dash.catalog.inStock'),   color: 'text-ok-text' },
    { val: noStock + other > 0 ? noStock + other : noStock, lbl: t('dash.catalog.outOfStock'), color: 'text-caution-text' },
  ];

  return (
    <div className="bg-surface-raised border border-edge rounded-xl p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-bold text-content">{t('dash.catalog.active')}</span>
        <button
          onClick={() => navigate('/inventory')}
          className="text-[11px] font-semibold text-brand hover:text-brand-hover transition-colors"
        >
          {t('dash.catalog.manage')}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-brand-subtle flex items-center justify-center flex-shrink-0">
          <Package size={16} className="text-brand" />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-content truncate">{catalog.catalogName}</p>
          <p className="text-[10px] text-content-3 font-mono truncate">{catalog.catalogId}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-edge">
        {catalogStats.map(({ val, lbl, color }) => (
          <div key={lbl} className="text-center">
            <p className={`text-[18px] font-extrabold leading-tight ${color}`}>{val}</p>
            <p className="text-[10px] text-content-3 font-semibold uppercase tracking-wider">{lbl}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PropertiesCard ────────────────────────────────────────────────────────────

function PropertiesCard({ businessId }: { businessId: string }) {
  const { t } = useLanguage();
  const { properties, loading } = useChannexProperties(businessId);

  const hasAirbnb  = properties.some((p) => p.connected_channels.includes('airbnb') || p.connection_status === 'active');
  const hasBooking = properties.some((p) => p.connected_channels.includes('booking'));

  return (
    <div className="bg-surface-raised border border-edge rounded-xl p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Hotel size={14} className="text-brand" />
          <span className="text-[13px] font-bold text-content">{t('dash.props.title')}</span>
        </div>
        <button
          onClick={() => navigate('/channex')}
          className="text-[11px] font-semibold text-brand hover:text-brand-hover transition-colors"
        >
          {t('dash.props.viewAll')}
        </button>
      </div>

      {loading && (
        <p className="text-[12px] text-content-3">{t('dash.props.loading')}</p>
      )}

      {!loading && properties.length === 0 && (
        <p className="text-[12px] text-content-3">{t('dash.props.empty')}</p>
      )}

      {!loading && properties.length > 0 && (
        <>
          <div className="flex flex-col gap-1.5">
            {properties.slice(0, 3).map((p) => (
              <div
                key={p.firestoreDocId}
                onClick={() => navigate('/channex')}
                className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-surface-subtle cursor-pointer transition-colors"
              >
                <div className="w-7 h-7 rounded-md bg-brand-subtle flex items-center justify-center flex-shrink-0">
                  <Hotel size={13} className="text-brand" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-content truncate">{p.title}</p>
                  <div className="flex gap-1 mt-0.5">
                    {p.connected_channels.includes('airbnb') && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600">Airbnb</span>
                    )}
                    {p.connected_channels.includes('booking') && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">Booking</span>
                    )}
                    {p.connected_channels.length === 0 && (
                      <span className="text-[10px] text-content-3">{t('dash.props.noOta')}</span>
                    )}
                  </div>
                </div>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  p.connection_status === 'active' ? 'bg-ok' : 'bg-content-3'
                }`} />
              </div>
            ))}
            {properties.length > 3 && (
              <p className="text-[11px] text-content-3 text-center pt-1">
                +{properties.length - 3} {t('dash.props.more')}
              </p>
            )}
          </div>

          {/* OTA summary */}
          <div className="flex gap-2 pt-2 border-t border-edge">
            <div className={`flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${
              hasAirbnb ? 'bg-red-50 text-red-600' : 'bg-surface-subtle text-content-3'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${hasAirbnb ? 'bg-red-500' : 'bg-content-3'}`} />
              Airbnb
            </div>
            <div className={`flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${
              hasBooking ? 'bg-blue-50 text-blue-700' : 'bg-surface-subtle text-content-3'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${hasBooking ? 'bg-blue-500' : 'bg-content-3'}`} />
              Booking.com
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── DashboardView (main) ──────────────────────────────────────────────────────

interface Props {
  businessId: string;
  // WhatsApp
  isWaActive: boolean;
  waMessages: Message[];
  waConversations: Contact[];
  // Messenger
  isMsgrConnected: boolean;
  msgrMessages: Message[];
  msgrConversations: Contact[];
  // Instagram
  isIgConnected: boolean;
  igMessages: Message[];
  igConversations: Contact[];
  // Catalog (from WA/Messenger integration doc)
  catalog: CatalogData | null;
  activeCatalogId: string | undefined;
  catalogIntegrationId: string | null;
  catalogStatus: IntegrationStatus;
  onCatalogLinked: () => void;
}

export default function DashboardView({
  businessId,
  isWaActive, waMessages, waConversations,
  isMsgrConnected, msgrMessages, msgrConversations,
  isIgConnected, igMessages, igConversations,
  catalog, activeCatalogId, catalogIntegrationId, catalogStatus, onCatalogLinked,
}: Props) {
  const { t } = useLanguage();
  const today = todayPrefix();

  const waMsgToday   = useMemo(() => waMessages.filter((m) => m.timestamp?.startsWith(today)).length,   [waMessages, today]);
  const msgrMsgToday = useMemo(() => msgrMessages.filter((m) => m.timestamp?.startsWith(today)).length, [msgrMessages, today]);
  const igMsgToday   = useMemo(() => igMessages.filter((m) => m.timestamp?.startsWith(today)).length,   [igMessages, today]);

  const messagesToday       = waMsgToday + msgrMsgToday + igMsgToday;
  const totalConversations  = waConversations.length + msgrConversations.length + igConversations.length;
  const connectedCount      = [isWaActive, isMsgrConnected, isIgConnected].filter(Boolean).length;
  const productCount        = catalog?.products?.length ?? null;

  const recentConvs = useMemo<ChannelContact[]>(() => [
    ...waConversations.map((c) => ({ ...c, channel: 'whatsapp' as const })),
    ...msgrConversations.map((c) => ({ ...c, channel: 'messenger' as const })),
    ...igConversations.map((c) => ({ ...c, channel: 'instagram' as const })),
  ]
    .sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp))
    .slice(0, 7),
    [waConversations, msgrConversations, igConversations],
  );

  const disconnectedLabels = [
    !isWaActive       && 'WhatsApp',
    !isMsgrConnected  && 'Messenger',
    !isIgConnected    && 'Instagram',
  ].filter(Boolean).join(', ');

  return (
    <div className="flex-1 p-6 space-y-5">

      {/* HTTPS guard */}
      {window.location.protocol === 'http:' && (
        <div className="bg-caution-bg border border-caution/30 rounded-xl px-4 py-3 text-xs text-caution-text leading-relaxed">
          <strong className="font-semibold">{t('dash.insecure.title')}</strong>{' '}
          {t('dash.insecure.body')}{' '}
          <code className="font-mono bg-caution-bg/60 px-1 rounded">https://localhost:5173</code>.
        </div>
      )}

      {/* ── KPI row ──────────────────────────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-content-3 mb-3">
          {t('dash.kpi.section')}
        </p>
        <div className="grid grid-cols-4 gap-3">

          <KpiCard
            label={t('dash.kpi.msgsToday')}
            value={messagesToday}
            icon={<MessageCircle size={14} className="text-brand" />}
            iconBg="bg-brand-subtle"
            valueColor="text-brand"
            sub={<span>{waMsgToday} WA · {msgrMsgToday} MS · {igMsgToday} IG</span>}
          />

          <KpiCard
            label={t('dash.kpi.activeConvs')}
            value={totalConversations}
            icon={<Users size={14} className="text-notice" />}
            iconBg="bg-notice-bg"
            valueColor="text-notice"
            sub={totalConversations === 0 ? t('dash.kpi.noConvs') : `${waConversations.length} WA · ${msgrConversations.length} MS · ${igConversations.length} IG`}
          />

          <KpiCard
            label={t('dash.kpi.channels')}
            value={`${connectedCount}/3`}
            icon={<Wifi size={14} className={connectedCount === 3 ? 'text-ok' : 'text-caution'} />}
            iconBg={connectedCount === 3 ? 'bg-ok/10' : 'bg-caution-bg'}
            valueColor={connectedCount === 3 ? 'text-ok-text' : 'text-caution-text'}
            sub={
              connectedCount === 3
                ? <span className="text-ok-text">{t('dash.kpi.allActive')}</span>
                : <span>{t('dash.kpi.pending')} {disconnectedLabels}</span>
            }
          />

          <KpiCard
            label={t('dash.kpi.products')}
            value={productCount !== null ? productCount : '—'}
            icon={<Package size={14} className="text-orange-500" />}
            iconBg="bg-orange-50"
            valueColor="text-orange-500"
            sub={
              productCount === null
                ? t('dash.kpi.noCatalog')
                : `${catalog!.products.filter((p) => p.availability === 'in stock').length} ${t('dash.kpi.inStock')}`
            }
          />

        </div>
      </div>

      {/* ── Channel status cards ──────────────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-content-3 mb-3">
          {t('dash.channels.section')}
        </p>
        <div className="grid grid-cols-3 gap-3">
          <ChannelCard
            channel="whatsapp"
            isConnected={isWaActive}
            messagesToday={waMsgToday}
            conversations={waConversations.length}
          />
          <ChannelCard
            channel="messenger"
            isConnected={isMsgrConnected}
            messagesToday={msgrMsgToday}
            conversations={msgrConversations.length}
          />
          <ChannelCard
            channel="instagram"
            isConnected={isIgConnected}
            messagesToday={igMsgToday}
            conversations={igConversations.length}
          />
        </div>
      </div>

      {/* ── Bottom row ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">

        {/* Recent conversations */}
        <div className="bg-surface-raised border border-edge rounded-xl p-4 shadow-sm flex flex-col gap-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] font-bold text-content">{t('dash.recentConvs.title')}</span>
            <button
              onClick={() => navigate('/mensajes')}
              className="text-[11px] font-semibold text-brand hover:text-brand-hover transition-colors"
            >
              {t('dash.recentConvs.viewAll')}
            </button>
          </div>
          <RecentConversations items={recentConvs} />
        </div>

        {/* Catalog + Properties stacked */}
        <div className="flex flex-col gap-3">
          <CatalogCard
            businessId={businessId}
            catalog={catalog}
            activeCatalogId={activeCatalogId}
            catalogIntegrationId={catalogIntegrationId}
            catalogStatus={catalogStatus}
            onCatalogLinked={onCatalogLinked}
          />
          <PropertiesCard businessId={businessId} />
        </div>

      </div>

    </div>
  );
}
