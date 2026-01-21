"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    const run = async () => {
      const { data } = await supabase.auth.getSession();

      if (!data.session) {
        router.replace("/login");
        return;
      }

      setEmail(data.session.user.email ?? "");
      setLoading(false);
    };

    run();
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

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
    </main>
  );
}
