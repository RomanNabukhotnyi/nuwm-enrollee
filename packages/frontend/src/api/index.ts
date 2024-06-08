// client.ts
import { treaty } from "@elysiajs/eden";
import type { App } from "backend/index";

const api = treaty<App>("localhost:3000");

export default api;
