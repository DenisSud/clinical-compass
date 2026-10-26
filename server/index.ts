import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const app = await buildApp({ serveStatic: process.env.NODE_ENV === "production" });

// `HOST` is for reverse-proxy deployments: Caddy lives on another box and reaches
// this process over the LAN, so the default stays loopback for local runs.
await app.listen({ port, host: process.env.HOST ?? "127.0.0.1" });
