import type {
  AssessmentSubmit,
  Credentials,
  DiaryEntry,
  DoctorAssessment,
  InstrumentView,
  PatientAssessment,
  HealthResponse,
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

export function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/api/health");
}

export function fetchInstrument(id: string): Promise<{ instrument: InstrumentView }> {
  return request<{ instrument: InstrumentView }>(`/api/instruments/${id}`);
}

export function submitAssessment(
  instrumentId: string,
  payload: AssessmentSubmit,
): Promise<{ assessment: PatientAssessment }> {
  return request<{ assessment: PatientAssessment }>(`/api/assessments/${instrumentId}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchMyAssessments(): Promise<{ assessments: PatientAssessment[] }> {
  return request<{ assessments: PatientAssessment[] }>("/api/assessments");
}

export function fetchPatientAssessments(id: string): Promise<{ assessments: DoctorAssessment[] }> {
  return request<{ assessments: DoctorAssessment[] }>(`/api/patients/${id}/assessments`);
}

export function submitDiary(payload: {
  submissionId: string;
  value: number;
  comment?: string;
}): Promise<{ entry: DiaryEntry }> {
  return request<{ entry: DiaryEntry }>("/api/diary", { method: "POST", body: JSON.stringify(payload) });
}

export function fetchMyDiary(): Promise<{ entries: DiaryEntry[] }> {
  return request<{ entries: DiaryEntry[] }>("/api/diary");
}

export function fetchPatientDiary(id: string): Promise<{ entries: DiaryEntry[] }> {
  return request<{ entries: DiaryEntry[] }>(`/api/patients/${id}/diary`);
}
