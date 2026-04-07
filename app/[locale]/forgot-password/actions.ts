"use server";

import { createClient } from "@/lib/supabase/server";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import { headers } from "next/headers";

export async function forgotPassword(formData: FormData) {
  const email = formData.get("email") as string;

  const result = forgotPasswordSchema.safeParse({ email });
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Email inválido" };
  }

  const supabase = await createClient();
  const origin = (await headers()).get("origin");

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  if (error) {
    return { error: error.message };
  }

  // Mensaje intencionalmente ambiguo — no confirma si el email existe.
  // Mismo principio que GitHub/Notion: el atacante no sabe si la cuenta existe.
  return {
    success:
      "Si existe una cuenta con ese correo, recibirás un enlace para restablecer tu contraseña en los próximos minutos. Revisa también tu carpeta de spam.",
  };
}
