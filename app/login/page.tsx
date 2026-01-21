"use client";
import { supabase } from "@/lib/supabase/client";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");

  async function onSubmit(e: React.FormEvent) {
  e.preventDefault();
  console.log("login submit fired", email);
  setMsg("Sending magic link...");
  setMsg("");

  const emailTrimmed = email.trim().toLowerCase();

  const { error } = await supabase.auth.signInWithOtp({
    email: emailTrimmed,
    options: {
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  });

  if (error) {
    setMsg(error.message);
    return;
  }

  setMsg("Check your email for the magic link.");
}


  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4">
        <h1 className="text-3xl font-bold">Login</h1>
        <p className="text-gray-600">Get a magic link in your email.</p>

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-md border p-3"
          />

          <button
            type="submit"
            className="w-full rounded-md bg-black text-white p-3"
          >
            Send magic link
          </button>
        </form>

        {msg ? <p className="text-sm text-gray-700">{msg}</p> : null}
      </div>
    </main>
  );
}
