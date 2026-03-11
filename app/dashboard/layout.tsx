"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Tables } from "@/types/database.types";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

type UserProfile = Pick<
  Tables<"users">,
  "name" | "role" | "business_id" | "avatar_url" | "color"
>;
type BusinessProfile = Pick<Tables<"businesses">, "name" | "category">;

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    async function loadSession() {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (!authUser) {
        router.push("/login");
        return;
      }

      const { data: dbUser } = await supabase
        .from("users")
        .select("name, role, business_id, avatar_url, color")
        .eq("id", authUser.id)
        .single();

      if (dbUser) {
        setUser(dbUser as UserProfile);
        if (dbUser.business_id) {
          const { data: biz } = await supabase
            .from("businesses")
            .select("name, category")
            .eq("id", dbUser.business_id)
            .single();
          if (biz) setBusiness(biz as BusinessProfile);
        }
      }
    }

    loadSession();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => loadSession());
    return () => subscription.unsubscribe();
  }, []);

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ backgroundColor: "#0F0F12" }}
    >
      {/* Sidebar — hidden on mobile, visible on lg+ */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        <Sidebar open={true} user={user} business={business} />
      </div>

      {/* Mobile sidebar overlay */}
      <div className="lg:hidden">
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          user={user}
          business={business}
        />
      </div>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <Topbar
          title="Dashboard"
          onMenuClick={() => setSidebarOpen((prev) => !prev)}
          user={user}
        />
        <main
          className="flex-1 overflow-y-auto"
          style={{ backgroundColor: "#0F0F12" }}
        >
          {/* Responsive padding: tight on mobile, comfortable on desktop */}
          <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
