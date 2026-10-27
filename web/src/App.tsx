import { useCallback, useEffect, useState } from "react";
import type { MeResponse, Role } from "../../shared/contracts";
import { canonicalLoginPath, loginPath, roleFromLoginPath } from "../../shared/login-routes";
import { AuthScreen } from "./AuthScreen";
import { DoctorHome } from "./DoctorHome";
import { PatientHome } from "./PatientHome";
import { fetchMe, signOut } from "./api";
import { TopBar } from "./ui";

function roleOnScreen(): Role {
  return roleFromLoginPath(window.location.pathname) ?? "patient";
}

export function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginRole, setLoginRole] = useState<Role>(roleOnScreen);

  const refresh = useCallback(() => {
    fetchMe()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  // Старый общий адрес `/login` продолжает работать: он переписывается на экран
  // пациента, и туда же попадает любой адрес, который не называет роль.
  useEffect(() => {
    const path = canonicalLoginPath(window.location.pathname);
    if (window.location.pathname !== path) window.history.replaceState(null, "", path);
    setLoginRole(roleFromLoginPath(path) ?? "patient");
  }, []);

  useEffect(() => {
    const onPopState = () => setLoginRole(roleOnScreen());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // После того как сервер подтвердил роль, адресу уже не нужно её называть.
  useEffect(() => {
    if (me) window.history.replaceState(null, "", "/");
  }, [me]);

  const switchRole = useCallback((role: Role) => {
    window.history.pushState(null, "", loginPath(role));
    setLoginRole(role);
  }, []);

  const handleSignOut = useCallback(() => {
    const role = me?.role ?? loginRole;
    void signOut().finally(() => {
      window.history.replaceState(null, "", loginPath(role));
      setLoginRole(role);
      setMe(null);
    });
  }, [me, loginRole]);

  if (loading) {
    return <p style={{ fontFamily: "var(--font-sans)", padding: 32 }}>Загрузка…</p>;
  }

  if (!me)
    return (
      <AuthScreen
        key={loginRole}
        role={loginRole}
        onSwitchRole={switchRole}
        onAuthenticated={refresh}
      />
    );

  return (
    <div className="app">
      <TopBar email={me.profile.email} onSignOut={handleSignOut} />
      {me.role === "doctor" ? (
        <DoctorHome doctor={me.profile} />
      ) : (
        <PatientHome profile={me.profile} onChanged={refresh} />
      )}
    </div>
  );
}
