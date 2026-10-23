import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("GET /api/health", () => {
  it("reports the api and the database as healthy", async () => {
    const app = await buildApp({ dbPath: ":memory:", logger: false });

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", db: "ok" });
    await app.close();
  });

  it("creates the three domain tables on startup", async () => {
    const app = await buildApp({ dbPath: ":memory:", logger: false });

    const tables = app.conn.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual(expect.arrayContaining(["doctors", "patients", "sessions"]));
    await app.close();
  });
});
