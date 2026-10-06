import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { api, UNAUTHORIZED_EVENT } from "@/lib/api";
import { PageMessage, Spinner } from "@/components/common";

const AuthContext = createContext({ user: null, setUser: () => {}, logout: async () => {}, googleEnabled: false });

/** Holds the signed-in user. `undefined` while the first /auth/me request is in flight. */
export function AuthProvider({ children, initialUser }) {
  const [user, setUser] = useState(initialUser);
  // Whether the server has Google sign-in configured (from /auth/me).
  const [googleEnabled, setGoogleEnabled] = useState(false);

  // On first load, ask the server who we are. Tests pass initialUser to skip this.
  useEffect(() => {
    if (initialUser !== undefined) return;
    api("/auth/me").then(
      (d) => {
        setUser(d.user);
        setGoogleEnabled(Boolean(d.googleEnabled));
      },
      () => setUser(null),
    );
  }, [initialUser]);

  // If any API call comes back 401, treat it as logged out. RequireAuth then sends the user to /login.
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const value = useMemo(
    () => ({
      user,
      setUser,
      googleEnabled,
      logout: async () => {
        await api("/auth/logout", { method: "POST" }).catch(() => {});
        setUser(null);
        await api("/auth/me").catch(() => {}); // fresh CSRF token for the anonymous session
      },
    }),
    [user, googleEnabled],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}

// Shorthand for reading the auth context in components.
export const useAuth = () => useContext(AuthContext);

/** Route guard (4.1.8): anonymous visitors go to /login; wrong roles see a permission message. */
export function RequireAuth({ roles }) {
  const { user } = useAuth();
  const location = useLocation();
  // Still waiting on /auth/me, so don't bounce anyone to /login yet.
  if (user === undefined) return <Spinner label="Checking your session" />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (roles && !roles.includes(user.role)) {
    return <PageMessage title="Permission needed" body="Your account doesn't have access to this page." />;
  }
  return <Outlet />;
}
