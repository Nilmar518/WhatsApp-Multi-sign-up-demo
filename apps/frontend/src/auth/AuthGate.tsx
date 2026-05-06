import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../firebase/firebase';
import LoginPage from './LoginPage';

interface Props {
  children: React.ReactNode;
}

export default function AuthGate({ children }: Props) {
  const [user, setUser]       = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Patch window.fetch once so every /api/* call carries the Firebase ID token.
    // This avoids modifying each of the existing API files individually.
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('/api') && auth.currentUser) {
        const token = await auth.currentUser.getIdToken();
        const headers = new Headers((init as RequestInit | undefined)?.headers);
        headers.set('Authorization', `Bearer ${token}`);
        return originalFetch(input, { ...(init as RequestInit), headers });
      }
      return originalFetch(input, init as RequestInit);
    };

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });

    return () => {
      unsub();
      window.fetch = originalFetch;
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <span className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return <>{children}</>;
}
