import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

import { dedupeNormalizedJobs, normalizeJSearchJob } from "@/lib/jobs/normalize";

export const runtime = "nodejs";

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

type ResumeProfileRow = {
  roles: string[] | null;
  location_preference: string | null;
  remote_intent: string | null;
};

type JSearchResponse = {
  data?: unknown;
};

function pickRoles(raw: string[] | null): string[] {
  const roles = (raw ?? [])
    .map((r) => (typeof r === "string" ? r.trim() : ""))
    .filter((r) => r.length > 0);

  // keep it small to avoid rate limits + noise
  return roles.slice(0, 3);
}

function buildQuery(role: string, locationPref: string | null, remoteIntent: string | null): string {
  const loc = (locationPref ?? "").trim();

  const remote = (remoteIntent ?? "").toLowerCase();
  const wantsRemote = remote.includes("remote");

  // If user wants remote, add it to the query.
  // Still include location if it exists (some remote roles are location-tied).
  if (wantsRemote && loc) return `${role} remote in ${loc}`;
  if (wantsRemote) return `${role} remote`;
  if (loc) return `${role} in ${loc}`;
  return role;
}

async function fetchJSearchJobs(query: string): Promise<unknown[]> {
  const RAPIDAPI_KEY = getEnv("RAPIDAPI_KEY");
  const RAPIDAPI_HOST = getEnv("RAPIDAPI_HOST");

  const upstream = new URL("https://jsearch.p.rapidapi.com/search");
  upstream.searchParams.set("query", query);
  upstream.searchParams.set("page", "1");
  upstream.searchParams.set("num_pages", "1");

  const r = await fetch(upstream.toString(), {
    method: "GET",
    headers: {
      "x-rapidapi-key": RAPIDAPI_KEY,
      "x-rapidapi-host": RAPIDAPI_HOST,
    },
    cache: "no-store",
  });

  const text = await r.text();
  if (!r.ok) {
    throw new Error(`JSearch failed (${r.status}): ${text.slice(0, 300)}`);
  }

  const parsed: JSearchResponse = JSON.parse(text) as JSearchResponse;

  // JSearch payload commonly returns { data: [...] }
  const arr = (parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).data : null) as unknown;

  return Array.isArray(arr) ? arr : [];
}

export async function POST() {
  try {
    // 1) Get authed user (cookie-based)
    const cookieStore = await cookies();


    const supabaseAuth = createServerClient(
      getEnv("NEXT_PUBLIC_SUPABASE_URL"),
      getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      {
        cookies: {
  getAll() {
    return cookieStore.getAll();
  },
  setAll(_cookiesToSet) {
    // Route handlers can’t reliably set cookies here.
    // We only need reads for auth.
  },
},

      }
    );

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = userData.user.id;

    // 2) Service client for DB writes (bypasses RLS safely after we verify user)
    const supabaseAdmin = createClient(
      getEnv("NEXT_PUBLIC_SUPABASE_URL"),
      getEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    // 3) Load profile for this user
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("resume_profiles")
      .select("roles, location_preference, remote_intent")
      .eq("user_id", userId)
      .maybeSingle<ResumeProfileRow>();

    if (profileErr) {
      return NextResponse.json({ error: profileErr.message }, { status: 500 });
    }
    if (!profile) {
      return NextResponse.json({ error: "No resume profile found for user" }, { status: 404 });
    }

    const roles = pickRoles(profile.roles ?? []);
    if (roles.length === 0) {
      return NextResponse.json({ error: "Profile roles[] is empty" }, { status: 400 });
    }

    // 4) Fetch jobs for each role
    const rawItems: unknown[] = [];
    for (const role of roles) {
      const q = buildQuery(role, profile.location_preference, profile.remote_intent);
      const items = await fetchJSearchJobs(q);
      rawItems.push(...items);
    }

    // 5) Normalize + dedupe
    const normalized = rawItems
      .map((it) => normalizeJSearchJob(it))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    const deduped = dedupeNormalizedJobs(normalized);

    // 6) Insert (skip duplicates)
    let inserted = 0;
    let skippedDuplicates = 0;
    let failed = 0;

    for (const j of deduped) {
      const payload = {
        user_id: userId,

        source: j.source,
        external_job_id: j.external_job_id,
        apply_url: j.apply_url,

        title: j.title,
        company_name: j.company_name,
        company_website: j.company_website,

        location_text: j.location_text,
        country: j.country,
        city: j.city,
        region: j.region,

        is_remote: j.is_remote,
        remote_type: j.remote_type,
        employment_type: j.employment_type,

        description: j.description,
        posted_at: j.posted_at,

        salary_min: j.salary_min,
        salary_max: j.salary_max,
        salary_currency: j.salary_currency,
        salary_period: j.salary_period,

        raw: j.raw,
      };

      const { error } = await supabaseAdmin.from("jobs").insert(payload);

      if (!error) {
        inserted += 1;
        continue;
      }

      // Postgres unique violation
      const code = (error as unknown as { code?: string }).code;
      if (code === "23505") {
        skippedDuplicates += 1;
        continue;
      }

      failed += 1;
    }

    return NextResponse.json({
      ok: true,
      user_id: userId,
      roles_used: roles,
      fetched_items: rawItems.length,
      normalized_items: normalized.length,
      deduped_items: deduped.length,
      inserted,
      skipped_duplicates: skippedDuplicates,
      failed,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
