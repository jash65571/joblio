"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type ExtractResponse = {
  resumeId: string;
  fileName: string;
  pageCount: number;
  text: string;
};

type ResumeProfile = {
  roles: string[];
  skills: string[];
  seniority: string;
  location_preference: string;
  visa_or_work_auth: string;
  remote_intent: string;
};

type JobRow = {
  id: string;
  title: string;
  company_name: string | null;
  location_text: string | null;
  is_remote: boolean;
  created_at: string;
  apply_url: string | null;
};

export default function DashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>("");

  const [userId, setUserId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string>("");
  const [lastUploaded, setLastUploaded] = useState<string>("");

  const [profile, setProfile] = useState<ResumeProfile | null>(null);
  const [parsing, setParsing] = useState(false);

  // Jobs (Day 5)
  const [syncing, setSyncing] = useState(false);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobsMsg, setJobsMsg] = useState<string>("");

  // Extract preview state
  const [extracting, setExtracting] = useState(false);
  const [extractErr, setExtractErr] = useState<string>("");
  const [extractData, setExtractData] = useState<ExtractResponse | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const run = async () => {
      const { data } = await supabase.auth.getSession();

      if (!data.session) {
        router.replace("/login");
        return;
      }

      setEmail(data.session.user.email ?? "");
      setUserId(data.session.user.id);
      setLoading(false);

      // Load jobs list on dashboard open
      await loadJobs();
    };

    run();
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function loadJobs() {
    const { data, error } = await supabase
      .from("jobs")
      .select("id,title,company_name,location_text,is_remote,created_at,apply_url")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      setJobsMsg(error.message);
      setJobs([]);
      return;
    }

    setJobsMsg("");
    setJobs((data ?? []) as JobRow[]);
  }

  async function syncJobs() {
    setJobsMsg("");
    setSyncing(true);

    try {
      const r = await fetch("/api/jobs/sync", { method: "POST" });
      const json = (await r.json()) as { error?: string; inserted?: number };

      if (!r.ok) {
        setJobsMsg(json.error ?? "Job sync failed.");
        return;
      }

      const inserted = typeof json.inserted === "number" ? json.inserted : 0;
      setJobsMsg(inserted > 0 ? `Synced ${inserted} new jobs.` : "No new jobs found.");

      await loadJobs();
    } finally {
      setSyncing(false);
    }
  }

  async function uploadResume() {
    setUploadMsg("");
    setLastUploaded("");
    setExtractErr("");
    setExtractData(null);
    setExpanded(false);
    setProfile(null);

    if (!userId) {
      setUploadMsg("Not logged in.");
      return;
    }

    if (!file) {
      setUploadMsg("Please pick a PDF first.");
      return;
    }

    if (file.type !== "application/pdf") {
      setUploadMsg("PDF only.");
      return;
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `${userId}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("resumes")
      .upload(filePath, file, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      setUploadMsg(uploadError.message);
      return;
    }

    const { error: dbError } = await supabase.from("resumes").insert({
      user_id: userId,
      file_path: filePath,
      file_name: file.name,
    });

    if (dbError) {
      setUploadMsg(dbError.message);
      return;
    }

    setLastUploaded(file.name);
    setUploadMsg("Uploaded!");
    setFile(null);
  }

  async function extractResumeText() {
    setExtractErr("");
    setExtractData(null);
    setExpanded(false);
    setExtracting(true);
    setProfile(null);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        setExtractErr("Not logged in.");
        return;
      }

      const res = await fetch("/api/resume/extract", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const txt = await res.text();

      if (!res.ok) {
        let msg = txt;
        try {
          const j = JSON.parse(txt) as { error?: string };
          msg = j.error ?? txt;
        } catch {}
        setExtractErr(msg || "Failed to extract.");
        return;
      }

      const json = JSON.parse(txt) as ExtractResponse;
      setExtractData(json);
    } finally {
      setExtracting(false);
    }
  }

  async function parseProfile() {
    if (!extractData) return;

    setParsing(true);
    setProfile(null);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        alert("Not logged in.");
        return;
      }

      const res = await fetch("/api/resume/parse", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resumeId: extractData.resumeId,
          text: extractData.text,
        }),
      });

      const json = (await res.json()) as { error?: string; profile?: ResumeProfile };

      if (!res.ok) {
        alert(json.error ?? "Parse failed");
        return;
      }

      setProfile((json.profile ?? null) as ResumeProfile | null);
    } finally {
      setParsing(false);
    }
  }

  const previewText = useMemo(() => {
    const t = extractData?.text ?? "";
    if (expanded) return t;
    return t.length > 900 ? t.slice(0, 900) + "…" : t;
  }, [extractData, expanded]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <p className="text-gray-700">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <p className="text-gray-600 mt-2">Signed in as {email}</p>

      <button
        onClick={logout}
        className="mt-6 rounded-md bg-black text-white px-4 py-2"
      >
        Logout
      </button>

      {/* Day 5: Jobs */}
      <div className="mt-10 max-w-3xl">
        <h2 className="text-xl font-semibold">Jobs</h2>
        <p className="text-gray-600 mt-1">
          Pull jobs from JSearch using your parsed profile.
        </p>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={syncJobs}
            disabled={syncing}
            className="rounded-md bg-black text-white px-4 py-2 disabled:opacity-60"
          >
            {syncing ? "Syncing jobs..." : "Sync jobs"}
          </button>

          <button
            onClick={loadJobs}
            className="rounded-md border px-4 py-2"
          >
            Refresh list
          </button>
        </div>

        {jobsMsg && <p className="mt-3 text-sm text-gray-700">{jobsMsg}</p>}

        <div className="mt-6 space-y-3">
          {jobs.map((j) => (
            <div key={j.id} className="rounded border p-3">
              <div className="font-medium">{j.title}</div>
              <div className="text-sm text-gray-600">
                {j.company_name ?? "Unknown company"} ·{" "}
                {j.location_text ?? "Unknown location"}
                {j.is_remote ? " · Remote" : ""}
              </div>

              {j.apply_url && (
                <a
                  href={j.apply_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-sm text-blue-600 underline"
                >
                  Apply link
                </a>
              )}
            </div>
          ))}

          {jobs.length === 0 && (
            <p className="text-sm text-gray-600">No jobs saved yet.</p>
          )}
        </div>
      </div>

      {/* Resume Upload */}
      <div className="mt-10 max-w-xl">
        <h2 className="text-xl font-semibold">Upload resume</h2>
        <p className="text-gray-600 mt-1">PDF only for now.</p>

        <div className="mt-4 space-y-3">
          <input
            type="file"
            accept="application/pdf"
            className="block w-full"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />

          <button
            type="button"
            className="rounded-md bg-black text-white px-4 py-2"
            onClick={uploadResume}
          >
            Upload
          </button>

          {uploadMsg && <p className="text-sm text-gray-700">{uploadMsg}</p>}

          {lastUploaded && (
            <p className="text-sm text-gray-700">File: {lastUploaded}</p>
          )}
        </div>
      </div>

      {/* Extract + Preview */}
      <div className="mt-10 max-w-3xl">
        <h2 className="text-xl font-semibold">Resume text preview</h2>
        <p className="text-gray-600 mt-1">
          Extract text on the server, then preview it here.
        </p>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            className="rounded-md bg-black text-white px-4 py-2 disabled:opacity-60"
            onClick={extractResumeText}
            disabled={extracting}
          >
            {extracting ? "Extracting..." : "Extract text"}
          </button>

          {extractData && (
            <p className="text-sm text-gray-700">
              {extractData.fileName} ({extractData.pageCount} page
              {extractData.pageCount === 1 ? "" : "s"})
            </p>
          )}
        </div>

        {extractErr && <p className="mt-3 text-sm text-red-600">{extractErr}</p>}

        {extractData && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-800">Extracted text</p>
              <button
                type="button"
                className="text-sm text-black underline"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? "Collapse" : "Expand"}
              </button>
            </div>

            <pre className="whitespace-pre-wrap text-sm text-gray-800 p-4 max-h-[420px] overflow-auto">
              {previewText}
            </pre>

            <div className="px-4 py-3 border-t border-gray-100">
              <button
                onClick={parseProfile}
                disabled={parsing}
                className="rounded-md bg-black text-white px-4 py-2 disabled:opacity-60"
              >
                {parsing ? "Parsing..." : "Parse profile"}
              </button>
            </div>
          </div>
        )}

        {profile && (
          <details className="mt-4 rounded border p-3">
            <summary className="cursor-pointer font-medium">
              Structured profile
            </summary>
            <pre className="mt-2 whitespace-pre-wrap text-sm">
              {JSON.stringify(profile, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </main>
  );
}
