import SideNav from './SideNav';

interface Props {
  children: React.ReactNode;
}

export default function MainLayout({ children }: Props) {
  return (
    <div className="flex min-h-screen">
      <SideNav />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
