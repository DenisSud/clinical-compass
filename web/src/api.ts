import type {
  Credentials,
  BindingCodeResponse,
  MeResponse,
  PatientListResponse,
  PatientSummary,
  Role,
} from "../../shared/contracts";

export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });

  if (response.status === 204) return undefined as T;

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body as { code?: string; message?: string } | null;
    throw new ApiRequestError(error?.code ?? "unknown", error?.message ?? "Не удалось выполнить запрос");
  }
  return body as T;
}

export async function fetchMe(): Promise<MeResponse | null> {
  const response = await fetch("/api/me");
  if (response.status === 401) return null;
  if (!response.ok) throw new ApiRequestError("unknown", "Сервер недоступен");
  return (await response.json()) as MeResponse;
}

export function signUp(role: Role, credentials: Credentials): Promise<MeResponse> {
  return request<MeResponse>(`/api/auth/${role}/signup`, {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

export function signIn(role: Role, credentials: Credentials): Promise<MeResponse> {
  return request<MeResponse>(`/api/auth/${role}/signin`, {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

export function signOut(): Promise<void> {
  return request<void>("/api/auth/signout", { method: "POST" });
}

export function fetchPatients(): Promise<PatientListResponse> {
  return request<PatientListResponse>("/api/patients");
}

export function fetchBindingCode(): Promise<BindingCodeResponse> {
  return request<BindingCodeResponse>("/api/binding-code");
}

export function rotateBindingCode(): Promise<BindingCodeResponse> {
  return request<BindingCodeResponse>("/api/binding-code/rotate", { method: "POST" });
}

export function bindToDoctor(code: string): Promise<{ doctorId: string; boundAt: string }> {
  return request<{ doctorId: string; boundAt: string }>("/api/bind", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function fetchPatient(id: string): Promise<{ patient: PatientSummary }> {
  return request<{ patient: PatientSummary }>(`/api/patients/${id}`);
}

export function unbindPatient(id: string): Promise<void> {
  return request<void>(`/api/patients/${id}/unbind`, { method: "POST" });
}
