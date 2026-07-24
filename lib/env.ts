import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SESSION_SECRET: z.string().min(32),
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  RESEND_FROM: z.string().default("Juliet & Juan <onboarding@resend.dev>"),
  /** Where guest replies go. Guests do reply to invitations; without this they'd
   *  bounce to the unmonitored send address. Set to the couple's inbox. */
  RESEND_REPLY_TO: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

let cached: z.infer<typeof schema> | null = null;

/** Lazily-validated env. Throws with a readable message on first server use. */
export function env(): z.infer<typeof schema> {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Missing/invalid environment variables: ${missing}`);
  }
  cached = parsed.data;
  return cached;
}
