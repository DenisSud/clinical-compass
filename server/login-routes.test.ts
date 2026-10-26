import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("старый адрес входа", () => {
  it("ведёт на экран пациента, а не на общий экран выбора", async () => {
    const app = await buildApp({ dbPath: ":memory:", logger: false });

    const response = await app.inject({ method: "GET", url: "/login" });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/login/patient");
    await app.close();
  });
});
