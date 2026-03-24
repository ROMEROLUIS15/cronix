


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "postgres";


CREATE TYPE "public"."appointment_status" AS ENUM (
    'pending',
    'confirmed',
    'completed',
    'cancelled',
    'no_show'
);


ALTER TYPE "public"."appointment_status" OWNER TO "postgres";


CREATE TYPE "public"."auth_provider" AS ENUM (
    'email',
    'google',
    'hybrid'
);


ALTER TYPE "public"."auth_provider" OWNER TO "postgres";


CREATE TYPE "public"."business_plan" AS ENUM (
    'free',
    'pro',
    'enterprise'
);


ALTER TYPE "public"."business_plan" OWNER TO "postgres";


CREATE TYPE "public"."expense_category" AS ENUM (
    'supplies',
    'rent',
    'utilities',
    'payroll',
    'marketing',
    'equipment',
    'other'
);


ALTER TYPE "public"."expense_category" OWNER TO "postgres";


CREATE TYPE "public"."payment_method" AS ENUM (
    'cash',
    'card',
    'transfer',
    'qr',
    'other'
);


ALTER TYPE "public"."payment_method" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'owner',
    'employee',
    'platform_admin'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE TYPE "public"."user_status" AS ENUM (
    'pending',
    'active',
    'rejected'
);


ALTER TYPE "public"."user_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.users (id, email, name, role, status, provider)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1),
      'Usuario'
    ),
    'owner',
    'pending',
    CASE
      WHEN NEW.raw_app_meta_data->>'provider' = 'google' THEN 'google'::auth_provider
      ELSE 'email'::auth_provider
    END
  )
  ON CONFLICT (id) DO UPDATE SET
    provider = CASE
      WHEN public.users.provider = 'email'  AND EXCLUDED.provider = 'google' THEN 'hybrid'::auth_provider
      WHEN public.users.provider = 'google' AND EXCLUDED.provider = 'email'  THEN 'hybrid'::auth_provider
      ELSE public.users.provider
    END;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."on_auth_user_created"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  _provider public.auth_provider;
  _name     text;
BEGIN
  -- Determine provider
  IF NEW.raw_app_meta_data->>'provider' = 'google' THEN
    _provider := 'google';
  ELSE
    _provider := 'email';
  END IF;

  -- Determine display name
  _name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1),
    'Usuario'
  );

  INSERT INTO public.users (id, email, name, role, status, provider, business_id)
  VALUES (NEW.id, COALESCE(NEW.email, ''), _name, 'owner', 'pending', _provider, NULL)
  ON CONFLICT (id) DO UPDATE SET
    email    = EXCLUDED.email,
    provider = CASE
      WHEN users.provider = 'email' AND EXCLUDED.provider = 'google' THEN 'hybrid'::public.auth_provider
      ELSE users.provider
    END;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."on_auth_user_created"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."appointment_reminders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "appointment_id" "uuid" NOT NULL,
    "business_id" "uuid" NOT NULL,
    "remind_at" timestamp with time zone NOT NULL,
    "minutes_before" integer DEFAULT 60 NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "channel" "text" DEFAULT 'whatsapp'::"text" NOT NULL,
    "error_message" "text",
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "appointment_reminders_channel_check" CHECK (("channel" = 'whatsapp'::"text")),
    CONSTRAINT "appointment_reminders_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."appointment_reminders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appointments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "service_id" "uuid" NOT NULL,
    "assigned_user_id" "uuid",
    "start_at" timestamp with time zone NOT NULL,
    "end_at" timestamp with time zone NOT NULL,
    "status" "public"."appointment_status" DEFAULT 'pending'::"public"."appointment_status",
    "notes" "text",
    "cancel_reason" "text",
    "cancelled_at" timestamp with time zone,
    "is_dual_booking" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."appointments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."businesses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "address" "text",
    "phone" "text",
    "logo_url" "text",
    "slug" "text",
    "locale" "text",
    "timezone" "text",
    "settings" "jsonb",
    "plan" "public"."business_plan" DEFAULT 'free'::"public"."business_plan",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."businesses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "avatar_url" "text",
    "birthday" "date",
    "notes" "text",
    "tags" "text"[],
    "total_appointments" integer DEFAULT 0,
    "total_spent" numeric DEFAULT 0,
    "last_visit_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "amount" numeric NOT NULL,
    "category" "public"."expense_category" NOT NULL,
    "description" "text",
    "receipt_url" "text",
    "expense_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."passkey_challenges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "challenge" "text" NOT NULL,
    "user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."passkey_challenges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "category" "text",
    "color" "text",
    "duration_min" integer NOT NULL,
    "price" numeric NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "appointment_id" "uuid",
    "amount" numeric NOT NULL,
    "net_amount" numeric NOT NULL,
    "discount" numeric,
    "tip" numeric,
    "method" "public"."payment_method" NOT NULL,
    "notes" "text",
    "paid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_passkeys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "credential_id" "text" NOT NULL,
    "public_key" "text" NOT NULL,
    "counter" bigint DEFAULT 0 NOT NULL,
    "device_name" "text",
    "transports" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_passkeys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid",
    "name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "avatar_url" "text",
    "color" "text",
    "role" "public"."user_role" DEFAULT 'employee'::"public"."user_role",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "status" "public"."user_status" DEFAULT 'pending'::"public"."user_status",
    "provider" "public"."auth_provider" DEFAULT 'email'::"public"."auth_provider"
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."appointment_reminders"
    ADD CONSTRAINT "appointment_reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."businesses"
    ADD CONSTRAINT "businesses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."passkey_challenges"
    ADD CONSTRAINT "passkey_challenges_challenge_key" UNIQUE ("challenge");



ALTER TABLE ONLY "public"."passkey_challenges"
    ADD CONSTRAINT "passkey_challenges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_passkeys"
    ADD CONSTRAINT "user_passkeys_credential_id_key" UNIQUE ("credential_id");



ALTER TABLE ONLY "public"."user_passkeys"
    ADD CONSTRAINT "user_passkeys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_appointments_business_date" ON "public"."appointments" USING "btree" ("business_id", "start_at");



CREATE INDEX "idx_appointments_business_id" ON "public"."appointments" USING "btree" ("business_id");



CREATE INDEX "idx_appointments_client" ON "public"."appointments" USING "btree" ("client_id");



CREATE INDEX "idx_appointments_client_id" ON "public"."appointments" USING "btree" ("client_id");



CREATE INDEX "idx_appointments_service_id" ON "public"."appointments" USING "btree" ("service_id");



CREATE INDEX "idx_appointments_start_at" ON "public"."appointments" USING "btree" ("start_at");



CREATE INDEX "idx_appointments_status" ON "public"."appointments" USING "btree" ("business_id", "status");



CREATE INDEX "idx_clients_business" ON "public"."clients" USING "btree" ("business_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_clients_business_id" ON "public"."clients" USING "btree" ("business_id");



CREATE INDEX "idx_clients_name" ON "public"."clients" USING "btree" ("business_id", "name");



CREATE INDEX "idx_expenses_business_date" ON "public"."expenses" USING "btree" ("business_id", "expense_date");



CREATE INDEX "idx_expenses_business_id" ON "public"."expenses" USING "btree" ("business_id");



CREATE INDEX "idx_reminders_appointment" ON "public"."appointment_reminders" USING "btree" ("appointment_id", "status");



CREATE INDEX "idx_reminders_cron" ON "public"."appointment_reminders" USING "btree" ("status", "remind_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_services_business_active" ON "public"."services" USING "btree" ("business_id", "is_active");



CREATE INDEX "idx_services_business_id" ON "public"."services" USING "btree" ("business_id");



CREATE INDEX "idx_transactions_business_date" ON "public"."transactions" USING "btree" ("business_id", "paid_at");



CREATE INDEX "idx_transactions_business_id" ON "public"."transactions" USING "btree" ("business_id");



CREATE INDEX "idx_users_business" ON "public"."users" USING "btree" ("business_id");



CREATE INDEX "idx_users_business_id" ON "public"."users" USING "btree" ("business_id");



ALTER TABLE ONLY "public"."appointment_reminders"
    ADD CONSTRAINT "appointment_reminders_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointment_reminders"
    ADD CONSTRAINT "appointment_reminders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."passkey_challenges"
    ADD CONSTRAINT "passkey_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id");



ALTER TABLE ONLY "public"."user_passkeys"
    ADD CONSTRAINT "user_passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id");



CREATE POLICY "Users manage own passkeys" ON "public"."user_passkeys" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."appointment_reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."appointments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appointments_all" ON "public"."appointments" TO "authenticated" USING (("business_id" IN ( SELECT "users"."business_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))) WITH CHECK (("business_id" IN ( SELECT "users"."business_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."businesses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "businesses_insert" ON "public"."businesses" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "businesses_select" ON "public"."businesses" FOR SELECT TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR ("id" IN ( SELECT "users"."business_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "businesses_update" ON "public"."businesses" FOR UPDATE TO "authenticated" USING (("owner_id" = "auth"."uid"()));



ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients_all" ON "public"."clients" TO "authenticated" USING (("business_id" IN ( SELECT "users"."business_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))) WITH CHECK (("business_id" IN ( SELECT "users"."business_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "expenses_all" ON "public"."expenses" TO "authenticated" USING (("business_id" IN ( SELECT "users"."business_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))) WITH CHECK (("business_id" IN ( SELECT "users"."business_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "reminders_delete_own_business" ON "public"."appointment_reminders" FOR DELETE USING (("business_id" IN ( SELECT "users"."business_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "reminders_insert_own_business" ON "public"."appointment_reminders" FOR INSERT WITH CHECK (("business_id" IN ( SELECT "users"."business_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "reminders_select_own_business" ON "public"."appointment_reminders" FOR SELECT USING (("business_id" IN ( SELECT "users"."business_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "reminders_update_own_business" ON "public"."appointment_reminders" FOR UPDATE USING (("business_id" IN ( SELECT "users"."business_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "services_all" ON "public"."services" TO "authenticated" USING (("business_id" IN ( SELECT "users"."business_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))) WITH CHECK (("business_id" IN ( SELECT "users"."business_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transactions_all" ON "public"."transactions" TO "authenticated" USING (("business_id" IN ( SELECT "users"."business_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))) WITH CHECK (("business_id" IN ( SELECT "users"."business_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."user_passkeys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_insert" ON "public"."users" FOR INSERT TO "authenticated" WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "users_select" ON "public"."users" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "users_self_select" ON "public"."users" FOR SELECT USING (("id" = "auth"."uid"()));



CREATE POLICY "users_update" ON "public"."users" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"()));



REVOKE USAGE ON SCHEMA "public" FROM PUBLIC;
GRANT ALL ON SCHEMA "public" TO "anon";
GRANT ALL ON SCHEMA "public" TO "authenticated";
GRANT ALL ON SCHEMA "public" TO "service_role";



GRANT ALL ON TABLE "public"."appointment_reminders" TO "anon";
GRANT ALL ON TABLE "public"."appointment_reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."appointment_reminders" TO "service_role";



GRANT ALL ON TABLE "public"."appointments" TO "anon";
GRANT ALL ON TABLE "public"."appointments" TO "authenticated";
GRANT ALL ON TABLE "public"."appointments" TO "service_role";



GRANT ALL ON TABLE "public"."businesses" TO "anon";
GRANT ALL ON TABLE "public"."businesses" TO "authenticated";
GRANT ALL ON TABLE "public"."businesses" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."expenses" TO "anon";
GRANT ALL ON TABLE "public"."expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."expenses" TO "service_role";



GRANT ALL ON TABLE "public"."passkey_challenges" TO "anon";
GRANT ALL ON TABLE "public"."passkey_challenges" TO "authenticated";
GRANT ALL ON TABLE "public"."passkey_challenges" TO "service_role";



GRANT ALL ON TABLE "public"."services" TO "anon";
GRANT ALL ON TABLE "public"."services" TO "authenticated";
GRANT ALL ON TABLE "public"."services" TO "service_role";



GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";



GRANT ALL ON TABLE "public"."user_passkeys" TO "anon";
GRANT ALL ON TABLE "public"."user_passkeys" TO "authenticated";
GRANT ALL ON TABLE "public"."user_passkeys" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";




