import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const app = await buildApp({ serveStatic: process.env.NODE_ENV === "production" });

// `HOST` нужен для развёртывания за обратным прокси: Caddy живёт на другой машине и
// доходит до этого процесса по локальной сети, поэтому по умолчанию остаётся loopback
// для локального запуска.
await app.listen({ port, host: process.env.HOST ?? "127.0.0.1" });
