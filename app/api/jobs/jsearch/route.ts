import { NextResponse } from "next/server";

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

/**
 * Test endpoint to verify JSearch integration.
 *
 * Usage:
 *   GET /api/jobs/jsearch?query=software%20engineer&location=Austin%2C%20TX&page=1&num_pages=1
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const query = (url.searchParams.get("query") ?? "").trim();
    const location = (url.searchParams.get("location") ?? "").trim();

    const page = Number(url.searchParams.get("page") ?? "1");
    const numPages = Number(url.searchParams.get("num_pages") ?? "1");

    if (!query) {
      return NextResponse.json(
        { error: "Missing required param: query" },
        { status: 400 }
      );
    }

    const RAPIDAPI_KEY = getEnv("RAPIDAPI_KEY");
    const RAPIDAPI_HOST = getEnv("RAPIDAPI_HOST");

    const upstream = new URL("https://jsearch.p.rapidapi.com/search");
    upstream.searchParams.set("query", location ? `${query} in ${location}` : query);
    upstream.searchParams.set(
      "page",
      String(Number.isFinite(page) && page > 0 ? page : 1)
    );
    upstream.searchParams.set(
      "num_pages",
      String(Number.isFinite(numPages) && numPages > 0 ? Math.min(numPages, 5) : 1)
    );

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
      return NextResponse.json(
        {
          error: "JSearch request failed",
          status: r.status,
          body: text.slice(0, 2000),
        },
        { status: 502 }
      );
    }

    const data: unknown = JSON.parse(text);
    return NextResponse.json({ ok: true, data });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(err) },
      { status: 500 }
    );
  }
}
