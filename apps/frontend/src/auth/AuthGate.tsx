import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/firebase';
import LoginPage from './LoginPage';
import ChangePasswordForm from './ChangePasswordForm';

interface Props {
  children: React.ReactNode;
}

export default function AuthGate({ children }: Props) {
  const [user, setUser]                         = useState<User | null>(null);
  const [loading, setLoading]                   = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  useEffect(() => {
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

    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const snap = await getDoc(doc(db, 'users', u.uid));
          if (snap.exists() && snap.data()?.mustChangePassword === true) {
            setMustChangePassword(true);
          } else {
            setMustChangePassword(false);
          }
        } catch {
          setMustChangePassword(false);
        }
      } else {
        setMustChangePassword(false);
      }
      setLoading(false);
    });

    return () => {
      unsub();
      window.fetch = originalFetch;
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-sidebar flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-brand animate-spin" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  if (mustChangePassword) {
    return <ChangePasswordForm onDone={() => setMustChangePassword(false)} />;
  }

  return <>{children}</>;
}
