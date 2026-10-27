import type { Role } from "./contracts.js";

/** The address names the role; neither screen asks the visitor to choose one. */
export const LOGIN_PATH: Record<Role, string> = {
  patient: "/login/patient",
  doctor: "/login/doctor",
};

export function loginPath(role: Role): string {
  return LOGIN_PATH[role];
}

export function roleFromLoginPath(pathname: string): Role | null {
  if (pathname === LOGIN_PATH.doctor) return "doctor";
  if (pathname === LOGIN_PATH.patient) return "patient";
  return null;
}

/**
 * `/login` это общий адрес, который был у продукта до #55. Он продолжает работать и
 * ведёт на экран пациента, как и любой адрес, который не называет роль.
 */
export function canonicalLoginPath(pathname: string): string {
  return roleFromLoginPath(pathname) === null ? LOGIN_PATH.patient : pathname;
}
