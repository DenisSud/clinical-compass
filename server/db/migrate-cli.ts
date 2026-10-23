import { createDb } from "./client.js";

const path = process.env.SQLITE_DB ?? "var/app.db";
const { sqlite } = createDb(path);
console.log(`migrations applied to ${path}`);
sqlite.close();
