import { NextResponse } from "next/server";
import { headers, cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { extractPdfTextFromBuffer } from "@/lib/resume/extractPdfText";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeStoragePath(filePath: string) {
  return filePath.startsWith("resumes/") ? filePath.slice("resumes/".length) : filePath;
}

function getBearerTokenFromHeader(authHeader: string | null) {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

function getAccessTokenFromCookies(all: Array<{ name: string; value: string }>) {
  const direct = all.find((c) => c.name === "sb-access-token")?.value;
  if (direct) return direct;

  const authCookie = all.find((c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"))?.value;
  if (!authCookie) return null;

  try {
    const decoded = decodeURIComponent(authCookie);
    const parsed = JSON.parse(decoded) as { access_token?: string };
    return parsed.access_token ?? null;
  } catch {
    try {
      const parsed = JSON.parse(authCookie) as { access_token?: string };
      return parsed.access_token ?? null;
    } catch {
      return null;
    }
  }
}

export async function GET() {
  try {
    const h = await headers();
    const bearer = getBearerTokenFromHeader(h.get("authorization"));

    const cookieStore = await cookies();
    const all = cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
    const cookieToken = getAccessTokenFromCookies(all);

    const accessToken = bearer ?? cookieToken;
    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
    if (!anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");

    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: resume, error: resumeErr } = await supabase
      .from("resumes")
      .select("id, file_path, file_name, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (resumeErr) {
      return NextResponse.json({ error: resumeErr.message }, { status: 500 });
    }

    if (!resume) {
      return NextResponse.json({ error: "No resume found" }, { status: 404 });
    }

    const admin = createSupabaseAdmin();
    const pathInBucket = normalizeStoragePath(resume.file_path);

    const { data: file, error: dlErr } = await admin.storage
      .from("resumes")
      .download(pathInBucket);

    if (dlErr || !file) {
      return NextResponse.json(
        { error: dlErr?.message ?? "Failed to download resume", pathInBucket },
        { status: 500 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { text, pageCount } = await extractPdfTextFromBuffer(buffer);

    return NextResponse.json({
      resumeId: resume.id,
      fileName: resume.file_name,
      pageCount,
      text,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
