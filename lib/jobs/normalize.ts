export type NormalizedJobInsert = {
  source: "jsearch";
  external_job_id: string | null;
  apply_url: string | null;

  title: string;
  company_name: string | null;
  company_website: string | null;

  location_text: string | null;
  country: string | null;
  city: string | null;
  region: string | null;

  is_remote: boolean;
  remote_type: string | null; // "remote" | "hybrid" | "onsite" (best effort)
  employment_type: string | null;

  description: string | null;
  posted_at: string | null; // ISO string

  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;

  raw: Record<string, unknown>;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object") return null;
  return v as Record<string, unknown>;
}

function getString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function getNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toIsoOrNull(v: unknown): string | null {
  const s = getString(v);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function inferRemoteType(isRemote: boolean, locationText: string | null): string | null {
  if (isRemote) return "remote";
  const t = (locationText ?? "").toLowerCase();
  if (!t) return null;
  if (t.includes("hybrid")) return "hybrid";
  if (t.includes("on-site") || t.includes("onsite") || t.includes("on site")) return "onsite";
  return null;
}

/**
 * Normalize one JSearch result item to match public.jobs columns.
 * Keeps the full raw payload in `raw` for debugging.
 */
export function normalizeJSearchJob(item: unknown): NormalizedJobInsert | null {
  const r = asRecord(item);
  if (!r) return null;

  const title = getString(r.job_title);
  if (!title) return null;

  const externalJobId =
    getString(r.job_id) ??
    getString(r.id) ??
    getString(r.job_google_link); // fallback (not ideal, but better than null)

  const applyUrl =
    getString(r.job_apply_link) ??
    getString(r.job_apply_link_direct) ??
    getString(r.job_google_link);

  const locationText =
    getString(r.job_location) ??
    getString(r.job_city) ??
    getString(r.job_country);

  const isRemoteRaw =
    (typeof r.job_is_remote === "boolean" && r.job_is_remote) ||
    (typeof r.job_is_remote === "string" && r.job_is_remote.toLowerCase() === "true");

  const isRemote =
    Boolean(isRemoteRaw) ||
    (locationText ? locationText.toLowerCase().includes("remote") : false);

  const city = getString(r.job_city);
  const region = getString(r.job_state) ?? getString(r.job_region);
  const country = getString(r.job_country);

  const description = getString(r.job_description);

  const postedAt =
    toIsoOrNull(r.job_posted_at_datetime_utc) ??
    toIsoOrNull(r.job_posted_at_datetime) ??
    toIsoOrNull(r.job_posted_at);

  const salaryMin = getNumber(r.job_min_salary);
  const salaryMax = getNumber(r.job_max_salary);

  const salaryCurrency = getString(r.job_salary_currency);
  const salaryPeriod = getString(r.job_salary_period);

  const employmentType =
    getString(r.job_employment_type) ??
    getString(r.job_employment_types);

  const companyName =
    getString(r.employer_name) ??
    getString(r.company_name);

  const companyWebsite =
    getString(r.employer_website) ??
    getString(r.company_website);

  return {
    source: "jsearch",
    external_job_id: externalJobId,
    apply_url: applyUrl,

    title,
    company_name: companyName,
    company_website: companyWebsite,

    location_text: locationText,
    country,
    city,
    region,

    is_remote: isRemote,
    remote_type: inferRemoteType(isRemote, locationText),
    employment_type: employmentType,

    description,
    posted_at: postedAt,

    salary_min: salaryMin,
    salary_max: salaryMax,
    salary_currency: salaryCurrency,
    salary_period: salaryPeriod,

    raw: r,
  };
}

/**
 * Dedupe key preference:
 * 1) source + external_job_id
 * 2) source + apply_url
 * Returns null if neither exists (rare).
 */
export function getJobDedupeKey(job: NormalizedJobInsert): string | null {
  if (job.external_job_id) return `${job.source}::id::${job.external_job_id}`;
  if (job.apply_url) return `${job.source}::url::${job.apply_url}`;
  return null;
}

/**
 * Remove duplicates from a normalized job list (keeps first occurrence).
 */
export function dedupeNormalizedJobs(jobs: NormalizedJobInsert[]): NormalizedJobInsert[] {
  const seen = new Set<string>();
  const out: NormalizedJobInsert[] = [];

  for (const j of jobs) {
    const key = getJobDedupeKey(j);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(j);
  }

  return out;
}
