import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const app = await buildApp({ serveStatic: process.env.NODE_ENV === "production" });

await app.listen({ port, host: "127.0.0.1" });
