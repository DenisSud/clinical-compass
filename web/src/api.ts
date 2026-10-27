import type {
  AssessmentSubmit,
  Credentials,
  DiaryEntry,
  DoctorSignal,
  Message,
  PlanItem,
  TherapyCard,
  PatientCheckins,
  DoctorAdherence,
  WatchItem,
  Signal,
  DoctorAssessment,
  InstrumentView,
  PatientInstrumentView,
  PatientAssessment,
  HealthResponse,
  BindingCodeResponse,
  MeResponse,
  PatientListResponse,
  PatientFactsUpdate,
  PatientFactsView,
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
  // Тело есть — значит есть и тип тела. Пустой POST без тела не должен объявлять
  // себя JSON: Fastify отвечает на такую ложь 400, и действие врача падает в 500.
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(url, { ...init, headers });

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

export function fetchPatientStatuses(): Promise<{ statuses: { id: string; label: string }[] }> {
  return request<{ statuses: { id: string; label: string }[] }>("/api/patient-statuses");
}

export function setPatientStatus(id: string, status: string): Promise<{ patient: PatientSummary }> {
  return request<{ patient: PatientSummary }>(`/api/patients/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

/**
 * Факты, блокирующие решение: одни и те же у пациента и у врача. PUT отправляет
 * только изменённое, поэтому непереданные поля остаются как были (частичное сохранение).
 */
export function fetchMyFacts(): Promise<PatientFactsView> {
  return request<PatientFactsView>("/api/facts");
}

export function saveMyFacts(patch: PatientFactsUpdate): Promise<PatientFactsView> {
  return request<PatientFactsView>("/api/facts", { method: "PUT", body: JSON.stringify(patch) });
}

export function fetchPatientFacts(id: string): Promise<PatientFactsView> {
  return request<PatientFactsView>(`/api/patients/${id}/facts`);
}

export function unbindPatient(id: string): Promise<void> {
  return request<void>(`/api/patients/${id}/unbind`, { method: "POST" });
}

export function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/api/health");
}

/** Что назначено этому пациенту и когда это можно пройти. Набор решает статус (#68). */
export function fetchMyInstruments(): Promise<{ instruments: PatientInstrumentView[] }> {
  return request<{ instruments: PatientInstrumentView[] }>("/api/instruments");
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

export function fetchMyAssessments(): Promise<{
  assessments: PatientAssessment[];
  nextAllowedAt: string | null;
}> {
  return request<{ assessments: PatientAssessment[]; nextAllowedAt: string | null }>("/api/assessments");
}

export function fetchPatientAssessments(id: string): Promise<{ assessments: DoctorAssessment[] }> {
  return request<{ assessments: DoctorAssessment[] }>(`/api/patients/${id}/assessments`);
}

export function submitDiary(payload: {
  submissionId: string;
  value: number;
  comment?: string;
  entryDate?: string;
}): Promise<{ entry: DiaryEntry }> {
  return request<{ entry: DiaryEntry }>("/api/diary", { method: "POST", body: JSON.stringify(payload) });
}

export function fetchMyDiary(): Promise<{ entries: DiaryEntry[] }> {
  return request<{ entries: DiaryEntry[] }>("/api/diary");
}

export function fetchPatientDiary(id: string): Promise<{ entries: DiaryEntry[] }> {
  return request<{ entries: DiaryEntry[] }>(`/api/patients/${id}/diary`);
}

export function fetchSignals(): Promise<{ signals: DoctorSignal[] }> {
  return request<{ signals: DoctorSignal[] }>("/api/signals");
}

export function fetchPatientSignals(id: string): Promise<{ signals: Signal[] }> {
  return request<{ signals: Signal[] }>(`/api/patients/${id}/signals`);
}

export function takeSignal(id: string): Promise<{ signal: Signal }> {
  return request<{ signal: Signal }>(`/api/signals/${id}/take`, { method: "POST" });
}

export function closeSignal(id: string, outcome: string): Promise<{ signal: Signal }> {
  return request<{ signal: Signal }>(`/api/signals/${id}/close`, {
    method: "POST",
    body: JSON.stringify({ outcome }),
  });
}

export function fetchMyPlan(): Promise<{ items: PlanItem[] }> {
  return request<{ items: PlanItem[] }>("/api/plan");
}

export function fetchPatientPlan(id: string): Promise<{ items: PlanItem[] }> {
  return request<{ items: PlanItem[] }>(`/api/patients/${id}/plan`);
}

export function createPlanItem(
  patientId: string,
  payload: { kind: PlanItem["kind"]; title: string; details?: string },
): Promise<{ item: PlanItem }> {
  return request<{ item: PlanItem }>(`/api/patients/${patientId}/plan`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function confirmPlanItem(id: string): Promise<{ item: PlanItem }> {
  return request<{ item: PlanItem }>(`/api/plan/${id}/confirm`, { method: "POST" });
}

export function archivePlanItem(id: string): Promise<{ item: PlanItem }> {
  return request<{ item: PlanItem }>(`/api/plan/${id}/archive`, { method: "POST" });
}

export function fetchMyMessages(): Promise<{ messages: Message[] }> {
  return request<{ messages: Message[] }>("/api/messages");
}

export function sendMessage(body: string): Promise<{ message: Message }> {
  return request<{ message: Message }>("/api/messages", {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function fetchPatientMessages(id: string): Promise<{ messages: Message[] }> {
  return request<{ messages: Message[] }>(`/api/patients/${id}/messages`);
}

export function sendPatientMessage(id: string, body: string): Promise<{ message: Message }> {
  return request<{ message: Message }>(`/api/patients/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function fetchRecommendations(
  patientId: string,
): Promise<{ cards: TherapyCard[]; missing: string[] }> {
  return request<{ cards: TherapyCard[]; missing: string[] }>(
    `/api/patients/${patientId}/recommendations`,
  );
}

export function fetchCheckins(): Promise<PatientCheckins> {
  return request<PatientCheckins>("/api/checkins");
}

export function submitCheckin(input: {
  planItemId: string;
  status: "done" | "skipped";
  reason?: string;
}): Promise<{ checkin: { planItemId: string; status: string } }> {
  return request("/api/checkins", { method: "POST", body: JSON.stringify(input) });
}

export function fetchPatientCheckins(patientId: string, days = 14): Promise<DoctorAdherence> {
  return request<DoctorAdherence>(`/api/patients/${patientId}/checkins?days=${days}`);
}

export function fetchWatchItems(patientId: string): Promise<{ items: WatchItem[] }> {
  return request<{ items: WatchItem[] }>(`/api/patients/${patientId}/watch`);
}

export function createWatchItem(
  patientId: string,
  payload: Record<string, unknown>,
): Promise<{ item: WatchItem }> {
  return request(`/api/patients/${patientId}/watch`, { method: "POST", body: JSON.stringify(payload) });
}

export function setWatchStatus(id: string, action: "pause" | "resume"): Promise<{ item: WatchItem }> {
  return request(`/api/watch/${id}/${action}`, { method: "POST" });
}
