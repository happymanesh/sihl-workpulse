"use client";

import { createClient } from "@supabase/supabase-js";

// Browser-side client for chat-hub's Supabase project, Realtime only - never used for
// direct reads/writes (those go through /api/backend/chat-hub/* -> the NestJS API's
// ChatHubClientService). See apps/web/.env.local's comment for why this talks to
// chat-hub's Supabase project directly instead of through chat-hub's own API.
export const chatHubSupabase = createClient(
  process.env.NEXT_PUBLIC_CHAT_HUB_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_CHAT_HUB_SUPABASE_ANON_KEY!,
);
