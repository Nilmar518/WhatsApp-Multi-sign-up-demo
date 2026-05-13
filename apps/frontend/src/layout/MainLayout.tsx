import SideNav from './SideNav';

interface Props {
  children: React.ReactNode;
  transitioning?: boolean;
}

export default function MainLayout({ children, transitioning }: Props) {
  return (
    <div className="flex min-h-screen bg-surface transition-colors duration-200">
      <SideNav />
      <div className="flex-1 min-w-0 relative">
        {/* Thin progress bar at the top of the content area */}
        <div
          className={[
            'absolute top-0 left-0 right-0 h-0.5 z-50 overflow-hidden transition-opacity duration-150',
            transitioning ? 'opacity-100' : 'opacity-0 pointer-events-none',
          ].join(' ')}
        >
          <div className="h-full bg-brand animate-[navprogress_0.9s_ease-in-out_infinite]" />
        </div>
        {/* Content fades slightly during transition */}
        <div className={`transition-opacity duration-200 ${transitioning ? 'opacity-60' : 'opacity-100'}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
