import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("проверка здоровья через API", () => {
  it("сообщает, что api и база здоровы", async () => {
    const app = await buildApp({ dbPath: ":memory:", logger: false });

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", db: "ok" });
    await app.close();
  });

  it("создаёт три доменные таблицы при старте", async () => {
    const app = await buildApp({ dbPath: ":memory:", logger: false });

    const tables = app.conn.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual(expect.arrayContaining(["doctors", "patients", "sessions"]));
    await app.close();
  });
});
