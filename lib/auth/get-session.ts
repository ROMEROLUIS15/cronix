import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function getSession() {
  const supabase = createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  // Fetch the public.users record to get business_id and role
  // We check 'users' table as it's the primary one used in the codebase,
  // but we ensure business_id is presence-checked.
  const { data: dbUser, error: dbError } = await supabase
    .from("users")
    .select("id, business_id, role, name, email")
    .eq("id", user.id)
    .single();

  if (dbError) {
    console.error("Error fetching dbUser:", dbError);
  }

  const businessId = dbUser?.business_id || null;

  return {
    authUser: user,
    dbUser,
    business_id: businessId,
  };
}

export async function requireAuth() {
  const session = await getSession();
  if (!session || !session.business_id) {
    redirect("/login");
  }
  return session;
}
