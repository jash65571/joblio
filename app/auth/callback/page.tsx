"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("Signing you in...");

  useEffect(() => {
    const run = async () => {
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        setMsg(error.message);
        return;
      }

      if (data.session) {
        router.replace("/dashboard");
        return;
      }

      setMsg("No session found. Try logging in again.");
    };

    run();
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <p className="text-gray-700">{msg}</p>
    </main>
  );
}
