import { useCallback, useEffect, useState } from "react";
import type { MeResponse } from "../../shared/contracts";
import { AuthScreen } from "./AuthScreen";
import { DoctorHome } from "./DoctorHome";
import { PatientHome } from "./PatientHome";
import { fetchMe, signOut } from "./api";

export function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    fetchMe()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  const handleSignOut = useCallback(() => {
    void signOut().finally(() => setMe(null));
  }, []);

  if (loading) {
    return <p style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>Загрузка…</p>;
  }

  if (!me) return <AuthScreen onAuthenticated={refresh} />;

  return me.role === "doctor" ? (
    <DoctorHome profile={me.profile} onSignOut={handleSignOut} />
  ) : (
    <PatientHome profile={me.profile} onSignOut={handleSignOut} />
  );
}
