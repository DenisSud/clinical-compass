import { useEffect, useState } from "react";
import type { HealthResponse } from "../../shared/contracts";

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then(setHealth)
      .catch((cause: unknown) => setError(String(cause)));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32, lineHeight: 1.6 }}>
      <h1>Клинический компас</h1>
      {error && <p>Сервер недоступен: {error}</p>}
      {!error && !health && <p>Проверяем связь с сервером…</p>}
      {health && (
        <p>
          API: {health.status}, база: {health.db}, время: {health.time}
        </p>
      )}
    </main>
  );
}
