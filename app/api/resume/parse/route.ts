import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import type { ChatCompletionMessage } from "openai/resources/chat/completions";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(supabaseUrl, serviceRoleKey);

const PROFILE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "roles",
    "skills",
    "seniority",
    "location_preference",
    "visa_or_work_auth",
    "remote_intent",
  ],
  properties: {
    roles: { type: "array", items: { type: "string" } },
    skills: { type: "array", items: { type: "string" } },
    seniority: { type: "string" },
    location_preference: { type: "string" },
    visa_or_work_auth: { type: "string" },
    remote_intent: { type: "string" },
  },
};

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Missing auth" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");

    const {
      data: { user },
      error: authError,
    } = await admin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { resumeId, text } = await req.json();

    if (!resumeId || !text) {
      return NextResponse.json({ error: "Missing input" }, { status: 400 });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You extract structured job candidate data. Return ONLY valid JSON.",
        },
        {
          role: "user",
          content: `
Parse this resume text into JSON with this schema:
${JSON.stringify(PROFILE_SCHEMA)}

Resume text:
"""
${text}
"""
`,
        },
      ],
    });

    const message = completion.choices[0]?.message as ChatCompletionMessage | undefined;
    const raw = message?.content;

    if (!raw) {
      return NextResponse.json({ error: "AI failed" }, { status: 500 });
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid JSON from AI" }, { status: 500 });
    }

    // Basic schema validation
    for (const key of PROFILE_SCHEMA.required) {
      if (!(key in parsed)) {
        return NextResponse.json(
          { error: `Missing field ${key}` },
          { status: 500 }
        );
      }
    }

    const { error: insertError } = await admin
      .from("resume_profiles")
      .insert({
        user_id: user.id,
        resume_id: resumeId,
        ...parsed,
      });

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      resumeId,
      profile: parsed,
    });
  } catch (e: unknown) {
  const message =
    e instanceof Error ? e.message : "Server error";

  return NextResponse.json(
    { error: message },
    { status: 500 }
  );
}
}
