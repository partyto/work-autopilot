import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

const client = createClient({
  url: process.env.DATABASE_URL || "file:./data/autopilot.db",
});

export const db = drizzle(client, { schema });
export { schema };
