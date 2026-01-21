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

export default function DashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>("");

  const [userId, setUserId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string>("");
  const [lastUploaded, setLastUploaded] = useState<string>("");

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
    };

    run();
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function uploadResume() {
    setUploadMsg("");
    setLastUploaded("");
    setExtractErr("");
    setExtractData(null);
    setExpanded(false);

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
        } catch {
          // keep txt
        }
        setExtractErr(msg || "Failed to extract.");
        return;
      }

      const json = JSON.parse(txt) as ExtractResponse;
      setExtractData(json);
    } finally {
      setExtracting(false);
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

          {uploadMsg ? (
            <p className="text-sm text-gray-700">{uploadMsg}</p>
          ) : null}

          {lastUploaded ? (
            <p className="text-sm text-gray-700">File: {lastUploaded}</p>
          ) : null}
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

          {extractData ? (
            <p className="text-sm text-gray-700">
              {extractData.fileName} ({extractData.pageCount} page
              {extractData.pageCount === 1 ? "" : "s"})
            </p>
          ) : null}
        </div>

        {extractErr ? (
          <p className="mt-3 text-sm text-red-600">{extractErr}</p>
        ) : null}

        {extractData ? (
          <div className="mt-4 rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-800">
                Extracted text
              </p>
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
          </div>
        ) : null}
      </div>
    </main>
  );
}
