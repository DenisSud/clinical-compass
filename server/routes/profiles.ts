import type { DoctorProfile, PatientProfile, PatientSummary } from "../../shared/contracts.js";
import type { doctors, patients } from "../db/schema.js";
import { statusLabel } from "../instruments/statuses.js";

type DoctorRow = typeof doctors.$inferSelect;
type PatientRow = typeof patients.$inferSelect;

export function toDoctorProfile(row: DoctorRow): DoctorProfile {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    specialty: row.specialty,
    bindingCode: row.bindingCode,
    bindingCodeExpiresAt: row.bindingCodeExpiresAt,
  };
}

export function toPatientProfile(row: PatientRow, doctor: DoctorRow | undefined): PatientProfile {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    doctor: doctor ? { id: doctor.id, email: doctor.email, name: doctor.name } : null,
    boundAt: row.boundAt,
    remindByEmail: row.remindByEmail,
  };
}

/** Взгляд врача на пациента: статус это рабочая метка, а сама метка приходит из файла статусов. */
export function toPatientSummary(row: PatientRow): PatientSummary {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    boundAt: row.boundAt,
    status: row.status,
    statusLabel: statusLabel(row.status),
  };
}
