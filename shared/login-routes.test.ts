import { describe, expect, it } from "vitest";
import { LOGIN_PATH, canonicalLoginPath, loginPath, roleFromLoginPath } from "./login-routes.js";

describe("адреса экранов входа", () => {
  it("у каждой роли свой адрес", () => {
    expect(loginPath("patient")).toBe("/login/patient");
    expect(loginPath("doctor")).toBe("/login/doctor");
    expect(new Set(Object.values(LOGIN_PATH)).size).toBe(2);
  });

  it("роль читается из адреса", () => {
    expect(roleFromLoginPath("/login/patient")).toBe("patient");
    expect(roleFromLoginPath("/login/doctor")).toBe("doctor");
    expect(roleFromLoginPath("/login")).toBeNull();
  });

  it("старый общий адрес /login ведёт на экран пациента", () => {
    expect(canonicalLoginPath("/login")).toBe("/login/patient");
  });

  it("адрес, который не называет роль, не открывает экран выбора", () => {
    expect(canonicalLoginPath("/")).toBe("/login/patient");
    expect(canonicalLoginPath("/something-else")).toBe("/login/patient");
  });

  it("адрес, который уже называет роль, не переписывается", () => {
    expect(canonicalLoginPath("/login/doctor")).toBe("/login/doctor");
    expect(canonicalLoginPath("/login/patient")).toBe("/login/patient");
  });
});
