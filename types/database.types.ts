export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_agent_alerts: {
        Row: {
          breakdown: Json
          created_at: string
          delivered: boolean
          error_rate: number
          error_turns: number
          id: string
          total_turns: number
          window_min: number
        }
        Insert: {
          breakdown?: Json
          created_at?: string
          delivered?: boolean
          error_rate: number
          error_turns: number
          id?: string
          total_turns: number
          window_min: number
        }
        Update: {
          breakdown?: Json
          created_at?: string
          delivered?: boolean
          error_rate?: number
          error_turns?: number
          id?: string
          total_turns?: number
          window_min?: number
        }
        Relationships: []
      }
      ai_memories: {
        Row: {
          business_id: string | null
          content: string | null
          created_at: string | null
          embedding: string | null
          id: string
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          business_id?: string | null
          content?: string | null
          created_at?: string | null
          embedding?: string | null
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          business_id?: string | null
          content?: string | null
          created_at?: string | null
          embedding?: string | null
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_memories_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_memories_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_memories_v2: {
        Row: {
          actor_key: string
          actor_kind: string
          business_id: string
          content: string
          created_at: string
          embedding: string
          expires_at: string | null
          id: string
          kind: string
          metadata: Json
        }
        Insert: {
          actor_key: string
          actor_kind: string
          business_id: string
          content: string
          created_at?: string
          embedding: string
          expires_at?: string | null
          id?: string
          kind: string
          metadata?: Json
        }
        Update: {
          actor_key?: string
          actor_kind?: string
          business_id?: string
          content?: string
          created_at?: string
          embedding?: string
          expires_at?: string | null
          id?: string
          kind?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ai_memories_v2_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_tool_audit_log: {
        Row: {
          args_fingerprint: string | null
          business_id: string
          created_at: string
          duration_ms: number | null
          id: string
          result_status: string
          tool_name: string
          user_id: string
        }
        Insert: {
          args_fingerprint?: string | null
          business_id: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          result_status: string
          tool_name: string
          user_id: string
        }
        Update: {
          args_fingerprint?: string | null
          business_id?: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          result_status?: string
          tool_name?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_traces: {
        Row: {
          actor_key: string
          actor_kind: string
          business_id: string
          channel: string
          created_at: string
          error_code: string | null
          final_text_sha: string | null
          id: string
          latency_ms: number
          llm_steps: Json
          metadata: Json
          outcome: string
          query_sha: string
          steps_count: number
          tool_calls: Json
          tools_count: number
          total_tokens: number
        }
        Insert: {
          actor_key: string
          actor_kind: string
          business_id: string
          channel: string
          created_at?: string
          error_code?: string | null
          final_text_sha?: string | null
          id?: string
          latency_ms?: number
          llm_steps?: Json
          metadata?: Json
          outcome: string
          query_sha: string
          steps_count?: number
          tool_calls?: Json
          tools_count?: number
          total_tokens?: number
        }
        Update: {
          actor_key?: string
          actor_kind?: string
          business_id?: string
          channel?: string
          created_at?: string
          error_code?: string | null
          final_text_sha?: string | null
          id?: string
          latency_ms?: number
          llm_steps?: Json
          metadata?: Json
          outcome?: string
          query_sha?: string
          steps_count?: number
          tool_calls?: Json
          tools_count?: number
          total_tokens?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_traces_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_training_exports: {
        Row: {
          business_id: string
          created_at: string
          id: string
          jsonl: Json
          range_end: string
          range_start: string
          sample_count: number
          schema_version: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          jsonl?: Json
          range_end: string
          range_start: string
          sample_count: number
          schema_version?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          jsonl?: Json
          range_end?: string
          range_start?: string
          sample_count?: number
          schema_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_training_exports_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_reminders: {
        Row: {
          appointment_id: string
          business_id: string
          channel: string
          created_at: string
          error_message: string | null
          id: string
          minutes_before: number
          remind_at: string
          sent_at: string | null
          status: string
        }
        Insert: {
          appointment_id: string
          business_id: string
          channel?: string
          created_at?: string
          error_message?: string | null
          id?: string
          minutes_before?: number
          remind_at: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          appointment_id?: string
          business_id?: string
          channel?: string
          created_at?: string
          error_message?: string | null
          id?: string
          minutes_before?: number
          remind_at?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_reminders_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reminders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_services: {
        Row: {
          appointment_id: string
          created_at: string | null
          id: string
          service_id: string
          sort_order: number
        }
        Insert: {
          appointment_id: string
          created_at?: string | null
          id?: string
          service_id: string
          sort_order?: number
        }
        Update: {
          appointment_id?: string
          created_at?: string | null
          id?: string
          service_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "appointment_services_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          assigned_user_id: string | null
          business_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          client_id: string
          created_at: string | null
          end_at: string
          id: string
          is_dual_booking: boolean | null
          notes: string | null
          service_id: string | null
          start_at: string
          status: Database["public"]["Enums"]["appointment_status"] | null
          updated_at: string | null
        }
        Insert: {
          assigned_user_id?: string | null
          business_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          client_id: string
          created_at?: string | null
          end_at: string
          id?: string
          is_dual_booking?: boolean | null
          notes?: string | null
          service_id?: string | null
          start_at: string
          status?: Database["public"]["Enums"]["appointment_status"] | null
          updated_at?: string | null
        }
        Update: {
          assigned_user_id?: string | null
          business_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          client_id?: string
          created_at?: string | null
          end_at?: string
          id?: string
          is_dual_booking?: boolean | null
          notes?: string | null
          service_id?: string | null
          start_at?: string
          status?: Database["public"]["Enums"]["appointment_status"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          address: string | null
          bonus_appointments_limit: number | null
          category: string
          created_at: string | null
          default_attendance_frequency_days: number
          id: string
          locale: string | null
          logo_url: string | null
          name: string
          owner_id: string
          phone: string | null
          phone_digits: string | null
          plan: Database["public"]["Enums"]["business_plan"] | null
          referral_code: string | null
          referred_by_id: string | null
          settings: Json | null
          slug: string | null
          subscription_ends_at: string | null
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          bonus_appointments_limit?: number | null
          category: string
          created_at?: string | null
          default_attendance_frequency_days?: number
          id?: string
          locale?: string | null
          logo_url?: string | null
          name: string
          owner_id: string
          phone?: string | null
          phone_digits?: string | null
          plan?: Database["public"]["Enums"]["business_plan"] | null
          referral_code?: string | null
          referred_by_id?: string | null
          settings?: Json | null
          slug?: string | null
          subscription_ends_at?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          bonus_appointments_limit?: number | null
          category?: string
          created_at?: string | null
          default_attendance_frequency_days?: number
          id?: string
          locale?: string | null
          logo_url?: string | null
          name?: string
          owner_id?: string
          phone?: string | null
          phone_digits?: string | null
          plan?: Database["public"]["Enums"]["business_plan"] | null
          referral_code?: string | null
          referred_by_id?: string | null
          settings?: Json | null
          slug?: string | null
          subscription_ends_at?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "businesses_referred_by_id_fkey"
            columns: ["referred_by_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          avatar_url: string | null
          birthday: string | null
          business_id: string
          created_at: string | null
          deleted_at: string | null
          email: string | null
          email_norm: string | null
          id: string
          last_reengaged_at: string | null
          last_visit_at: string | null
          name: string
          notes: string | null
          phone: string | null
          phone_digits: string | null
          retention_opted_out: boolean
          tags: string[] | null
          total_appointments: number | null
          total_spent: number | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          birthday?: string | null
          business_id: string
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          email_norm?: string | null
          id?: string
          last_reengaged_at?: string | null
          last_visit_at?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          phone_digits?: string | null
          retention_opted_out?: boolean
          tags?: string[] | null
          total_appointments?: number | null
          total_spent?: number | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          birthday?: string | null
          business_id?: string
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          email_norm?: string | null
          id?: string
          last_reengaged_at?: string | null
          last_visit_at?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          phone_digits?: string | null
          retention_opted_out?: boolean
          tags?: string[] | null
          total_appointments?: number | null
          total_spent?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_relationships: {
        Row: {
          business_id: string
          confidence: number
          created_at: string
          edge_type: Database["public"]["Enums"]["edge_type"]
          expires_at: string | null
          from_id: string
          from_kind: Database["public"]["Enums"]["entity_kind"]
          id: string
          metadata: Json
          to_id: string
          to_kind: Database["public"]["Enums"]["entity_kind"]
        }
        Insert: {
          business_id: string
          confidence?: number
          created_at?: string
          edge_type: Database["public"]["Enums"]["edge_type"]
          expires_at?: string | null
          from_id: string
          from_kind: Database["public"]["Enums"]["entity_kind"]
          id?: string
          metadata?: Json
          to_id: string
          to_kind: Database["public"]["Enums"]["entity_kind"]
        }
        Update: {
          business_id?: string
          confidence?: number
          created_at?: string
          edge_type?: Database["public"]["Enums"]["edge_type"]
          expires_at?: string | null
          from_id?: string
          from_kind?: Database["public"]["Enums"]["entity_kind"]
          id?: string
          metadata?: Json
          to_id?: string
          to_kind?: Database["public"]["Enums"]["entity_kind"]
        }
        Relationships: [
          {
            foreignKeyName: "entity_relationships_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          business_id: string
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string | null
          created_by: string | null
          description: string | null
          expense_date: string
          id: string
          receipt_url: string | null
        }
        Insert: {
          amount: number
          business_id: string
          category: Database["public"]["Enums"]["expense_category"]
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          expense_date: string
          id?: string
          receipt_url?: string | null
        }
        Update: {
          amount?: number
          business_id?: string
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          receipt_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      failed_password_attempts: {
        Row: {
          attempt_count: number
          business_id: string | null
          created_at: string
          email: string
          id: string
          last_attempt_at: string
          locked_until: string | null
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          business_id?: string | null
          created_at?: string
          email: string
          id?: string
          last_attempt_at?: string
          locked_until?: string | null
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          business_id?: string | null
          created_at?: string
          email?: string
          id?: string
          last_attempt_at?: string
          locked_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notification_subscriptions: {
        Row: {
          auth: string
          business_id: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          business_id: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          business_id?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          business_id: string
          content: string
          created_at: string | null
          event_id: string | null
          expires_at: string | null
          id: string
          is_read: boolean | null
          metadata: Json | null
          title: string
          type: string | null
          user_id: string | null
        }
        Insert: {
          business_id: string
          content: string
          created_at?: string | null
          event_id?: string | null
          expires_at?: string | null
          id?: string
          is_read?: boolean | null
          metadata?: Json | null
          title: string
          type?: string | null
          user_id?: string | null
        }
        Update: {
          business_id?: string
          content?: string
          created_at?: string | null
          event_id?: string | null
          expires_at?: string | null
          id?: string
          is_read?: boolean | null
          metadata?: Json | null
          title?: string
          type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      passkey_challenges: {
        Row: {
          challenge: string
          created_at: string
          id: string
          user_id: string | null
        }
        Insert: {
          challenge: string
          created_at?: string
          id?: string
          user_id?: string | null
        }
        Update: {
          challenge?: string
          created_at?: string
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      saas_invoices: {
        Row: {
          admin_notes: string | null
          amount_usd: number
          business_id: string
          created_at: string
          crypto_amount: number | null
          crypto_currency: string | null
          id: string
          np_invoice_id: string | null
          np_payment_id: string | null
          payment_method: string
          plan_purchased: Database["public"]["Enums"]["business_plan"]
          reference_number: string | null
          status: Database["public"]["Enums"]["saas_invoice_status"]
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          amount_usd: number
          business_id: string
          created_at?: string
          crypto_amount?: number | null
          crypto_currency?: string | null
          id?: string
          np_invoice_id?: string | null
          np_payment_id?: string | null
          payment_method?: string
          plan_purchased: Database["public"]["Enums"]["business_plan"]
          reference_number?: string | null
          status?: Database["public"]["Enums"]["saas_invoice_status"]
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          amount_usd?: number
          business_id?: string
          created_at?: string
          crypto_amount?: number | null
          crypto_currency?: string | null
          id?: string
          np_invoice_id?: string | null
          np_payment_id?: string | null
          payment_method?: string
          plan_purchased?: Database["public"]["Enums"]["business_plan"]
          reference_number?: string | null
          status?: Database["public"]["Enums"]["saas_invoice_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saas_invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      security_alerts: {
        Row: {
          alert_type: Database["public"]["Enums"]["security_alert_type"]
          business_id: string
          created_at: string
          id: string
          ip_address: unknown
          lockout_count_24h: number | null
          recommended_action: string | null
          resolution_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          severity: Database["public"]["Enums"]["alert_severity"]
          status: string | null
          updated_at: string
          user_agent: string | null
          user_email: string
        }
        Insert: {
          alert_type: Database["public"]["Enums"]["security_alert_type"]
          business_id: string
          created_at?: string
          id?: string
          ip_address?: unknown
          lockout_count_24h?: number | null
          recommended_action?: string | null
          resolution_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity: Database["public"]["Enums"]["alert_severity"]
          status?: string | null
          updated_at?: string
          user_agent?: string | null
          user_email: string
        }
        Update: {
          alert_type?: Database["public"]["Enums"]["security_alert_type"]
          business_id?: string
          created_at?: string
          id?: string
          ip_address?: unknown
          lockout_count_24h?: number | null
          recommended_action?: string | null
          resolution_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          status?: string | null
          updated_at?: string
          user_agent?: string | null
          user_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_alerts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_alerts_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      service_health: {
        Row: {
          failure_count: number
          last_failure: string | null
          service_name: string
          status: string
        }
        Insert: {
          failure_count?: number
          last_failure?: string | null
          service_name: string
          status?: string
        }
        Update: {
          failure_count?: number
          last_failure?: string | null
          service_name?: string
          status?: string
        }
        Relationships: []
      }
      services: {
        Row: {
          business_id: string
          category: string | null
          color: string | null
          created_at: string | null
          description: string | null
          duration_min: number
          id: string
          is_active: boolean | null
          name: string
          price: number
          updated_at: string | null
        }
        Insert: {
          business_id: string
          category?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          duration_min: number
          id?: string
          is_active?: boolean | null
          name: string
          price: number
          updated_at?: string | null
        }
        Update: {
          business_id?: string
          category?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          duration_min?: number
          id?: string
          is_active?: boolean | null
          name?: string
          price?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "services_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          appointment_id: string | null
          business_id: string
          client_id: string | null
          created_at: string | null
          discount: number | null
          id: string
          idempotency_key: string | null
          method: Database["public"]["Enums"]["payment_method"]
          net_amount: number
          notes: string | null
          paid_at: string | null
          tip: number | null
        }
        Insert: {
          amount: number
          appointment_id?: string | null
          business_id: string
          client_id?: string | null
          created_at?: string | null
          discount?: number | null
          id?: string
          idempotency_key?: string | null
          method: Database["public"]["Enums"]["payment_method"]
          net_amount: number
          notes?: string | null
          paid_at?: string | null
          tip?: number | null
        }
        Update: {
          amount?: number
          appointment_id?: string | null
          business_id?: string
          client_id?: string | null
          created_at?: string | null
          discount?: number | null
          id?: string
          idempotency_key?: string | null
          method?: Database["public"]["Enums"]["payment_method"]
          net_amount?: number
          notes?: string | null
          paid_at?: string | null
          tip?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      user_passkeys: {
        Row: {
          counter: number
          created_at: string
          credential_id: string
          device_name: string | null
          id: string
          public_key: string
          transports: string[] | null
          user_id: string
        }
        Insert: {
          counter?: number
          created_at?: string
          credential_id: string
          device_name?: string | null
          id?: string
          public_key: string
          transports?: string[] | null
          user_id: string
        }
        Update: {
          counter?: number
          created_at?: string
          credential_id?: string
          device_name?: string | null
          id?: string
          public_key?: string
          transports?: string[] | null
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          avatar_url: string | null
          business_id: string | null
          color: string | null
          created_at: string | null
          email: string | null
          id: string
          is_active: boolean | null
          name: string
          phone: string | null
          provider: Database["public"]["Enums"]["auth_provider"] | null
          role: Database["public"]["Enums"]["user_role"] | null
          status: Database["public"]["Enums"]["user_status"] | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          business_id?: string | null
          color?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          phone?: string | null
          provider?: Database["public"]["Enums"]["auth_provider"] | null
          role?: Database["public"]["Enums"]["user_role"] | null
          status?: Database["public"]["Enums"]["user_status"] | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          business_id?: string | null
          color?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          phone?: string | null
          provider?: Database["public"]["Enums"]["auth_provider"] | null
          role?: Database["public"]["Enums"]["user_role"] | null
          status?: Database["public"]["Enums"]["user_status"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_audit_logs: {
        Row: {
          ai_response: string | null
          business_id: string | null
          created_at: string | null
          id: string
          message_text: string | null
          sender_phone: string | null
          tool_calls: Json | null
        }
        Insert: {
          ai_response?: string | null
          business_id?: string | null
          created_at?: string | null
          id?: string
          message_text?: string | null
          sender_phone?: string | null
          tool_calls?: Json | null
        }
        Update: {
          ai_response?: string | null
          business_id?: string | null
          created_at?: string | null
          id?: string
          message_text?: string | null
          sender_phone?: string | null
          tool_calls?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_audit_logs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_booking_limits: {
        Row: {
          booking_count: number
          business_id: string
          sender_phone: string
          window_start: string
        }
        Insert: {
          booking_count?: number
          business_id: string
          sender_phone: string
          window_start?: string
        }
        Update: {
          booking_count?: number
          business_id?: string
          sender_phone?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_booking_limits_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_business_usage: {
        Row: {
          business_id: string
          message_count: number
          window_start: string
        }
        Insert: {
          business_id: string
          message_count?: number
          window_start?: string
        }
        Update: {
          business_id?: string
          message_count?: number
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_business_usage_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_dead_letter_queue: {
        Row: {
          created_at: string | null
          error: string | null
          id: string
          payload: Json | null
          retry_count: number | null
          service_type: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          error?: string | null
          id?: string
          payload?: Json | null
          retry_count?: number | null
          service_type?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          error?: string | null
          id?: string
          payload?: Json | null
          retry_count?: number | null
          service_type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      wa_rate_limits: {
        Row: {
          message_count: number
          sender_phone: string
          window_start: string
        }
        Insert: {
          message_count?: number
          sender_phone: string
          window_start?: string
        }
        Update: {
          message_count?: number
          sender_phone?: string
          window_start?: string
        }
        Relationships: []
      }
      wa_sessions: {
        Row: {
          business_id: string
          sender_phone: string
          updated_at: string | null
        }
        Insert: {
          business_id: string
          sender_phone: string
          updated_at?: string | null
        }
        Update: {
          business_id?: string
          sender_phone?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_sessions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_token_usage: {
        Row: {
          business_id: string
          total_tokens: number | null
          usage_date: string
        }
        Insert: {
          business_id: string
          total_tokens?: number | null
          usage_date?: string
        }
        Update: {
          business_id?: string
          total_tokens?: number | null
          usage_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_token_usage_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      web_rate_limits: {
        Row: {
          identifier: string
          request_count: number
          window_start: string
        }
        Insert: {
          identifier: string
          request_count?: number
          window_start?: string
        }
        Update: {
          identifier?: string
          request_count?: number
          window_start?: string
        }
        Relationships: []
      }
    }
    Views: {
      pg_all_foreign_keys: {
        Row: {
          fk_columns: unknown[] | null
          fk_constraint_name: unknown
          fk_schema_name: unknown
          fk_table_name: unknown
          fk_table_oid: unknown
          is_deferrable: boolean | null
          is_deferred: boolean | null
          match_type: string | null
          on_delete: string | null
          on_update: string | null
          pk_columns: unknown[] | null
          pk_constraint_name: unknown
          pk_index_name: unknown
          pk_schema_name: unknown
          pk_table_name: unknown
          pk_table_oid: unknown
        }
        Relationships: []
      }
      tap_funky: {
        Row: {
          args: string | null
          is_definer: boolean | null
          is_strict: boolean | null
          is_visible: boolean | null
          kind: unknown
          langoid: unknown
          name: unknown
          oid: unknown
          owner: unknown
          returns: string | null
          returns_set: boolean | null
          schema: unknown
          volatility: string | null
        }
        Relationships: []
      }
      v_web_suspicious_activity: {
        Row: {
          identifier: string | null
          is_active_window: boolean | null
          request_count: number | null
          status: string | null
          window_start: string | null
        }
        Insert: {
          identifier?: string | null
          is_active_window?: never
          request_count?: number | null
          status?: never
          window_start?: string | null
        }
        Update: {
          identifier?: string | null
          is_active_window?: never
          request_count?: number | null
          status?: never
          window_start?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _cleanup: { Args: never; Returns: boolean }
      _contract_on: { Args: { "": string }; Returns: unknown }
      _currtest: { Args: never; Returns: number }
      _db_privs: { Args: never; Returns: unknown[] }
      _extensions: { Args: never; Returns: unknown[] }
      _get: { Args: { "": string }; Returns: number }
      _get_latest: { Args: { "": string }; Returns: number[] }
      _get_note: { Args: { "": string }; Returns: string }
      _is_verbose: { Args: never; Returns: boolean }
      _prokind: { Args: { p_oid: unknown }; Returns: unknown }
      _query: { Args: { "": string }; Returns: string }
      _refine_vol: { Args: { "": string }; Returns: string }
      _retval: { Args: { "": string }; Returns: string }
      _table_privs: { Args: never; Returns: unknown[] }
      _temptypes: { Args: { "": string }; Returns: string }
      _todo: { Args: never; Returns: string }
      ai_traces_sample_window: {
        Args: {
          p_business_id: string
          p_limit?: number
          p_range_end: string
          p_range_start: string
        }
        Returns: {
          channel: string
          created_at: string
          error_code: string
          intent: string
          latency_ms: number
          outcome: string
          steps_count: number
          tool_sequence: string[]
          tools_count: number
          total_tokens: number
          trace_id: string
        }[]
      }
      ai_traces_summary_24h: { Args: { p_business_id: string }; Returns: Json }
      check_ai_agent_error_rate: { Args: never; Returns: undefined }
      col_is_null:
        | {
            Args: {
              column_name: unknown
              description?: string
              schema_name: unknown
              table_name: unknown
            }
            Returns: string
          }
        | {
            Args: {
              column_name: unknown
              description?: string
              table_name: unknown
            }
            Returns: string
          }
      col_not_null:
        | {
            Args: {
              column_name: unknown
              description?: string
              schema_name: unknown
              table_name: unknown
            }
            Returns: string
          }
        | {
            Args: {
              column_name: unknown
              description?: string
              table_name: unknown
            }
            Returns: string
          }
      current_business_id: { Args: never; Returns: string }
      diag:
        | {
            Args: { msg: unknown }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.diag(msg => text), public.diag(msg => anyelement). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { msg: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.diag(msg => text), public.diag(msg => anyelement). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
      diag_test_name: { Args: { "": string }; Returns: string }
      do_tap:
        | { Args: never; Returns: string[] }
        | { Args: { "": string }; Returns: string[] }
      fail:
        | { Args: never; Returns: string }
        | { Args: { "": string }; Returns: string }
      findfuncs: { Args: { "": string }; Returns: string[] }
      finish: { Args: { exception_on_failure?: boolean }; Returns: string[] }
      fn_apply_referral_bonus: {
        Args: { p_days?: number; p_referred_business_id: string }
        Returns: {
          applied: boolean
          referrer_id: string
        }[]
      }
      fn_batch_create_transactions: {
        Args: { p_business_id: string; p_transactions: Json }
        Returns: Json
      }
      fn_book_appointment_wa: {
        Args: {
          p_business_id: string
          p_client_name: string
          p_client_phone: string
          p_service_id: string
          p_start_at: string
        }
        Returns: Json
      }
      fn_check_password_attempts: {
        Args: {
          lockout_minutes?: number
          max_attempts?: number
          p_email: string
        }
        Returns: Json
      }
      fn_clean_phone: { Args: { p_phone: string }; Returns: string }
      fn_create_business_and_link_owner:
        | {
            Args: {
              p_category: string
              p_name: string
              p_owner_email: string
              p_owner_id: string
              p_owner_name: string
              p_plan: string
              p_timezone: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_category: string
              p_name: string
              p_owner_email: string
              p_owner_id: string
              p_owner_name: string
              p_plan: string
              p_referral_code?: string
              p_timezone: string
            }
            Returns: Json
          }
      fn_finalize_crypto_payment: {
        Args: {
          p_crypto_amount: number
          p_crypto_currency: string
          p_days?: number
          p_np_invoice_id: string
          p_np_payment_id: string
          p_status: string
        }
        Returns: {
          business_id: string
          invoice_id: string
          invoice_status: string
          plan_purchased: string
          referral_bonus_applied: boolean
          referrer_business_id: string
          result_status: string
        }[]
      }
      fn_finalize_paypal_payment: {
        Args: { p_captured_amount: number; p_days?: number; p_order_id: string }
        Returns: {
          business_id: string
          invoice_id: string
          plan_purchased: string
          referral_bonus_applied: boolean
          referrer_business_id: string
          result_status: string
        }[]
      }
      fn_find_client_by_phone: {
        Args: { p_business_id: string; p_phone: string }
        Returns: {
          client_avatar_url: string
          client_email: string
          client_id: string
          client_name: string
          client_phone: string
          match_type: string
        }[]
      }
      fn_get_available_slots:
        | {
            Args: {
              p_business_id: string
              p_date: string
              p_service_id: string
            }
            Returns: {
              slot_time: string
            }[]
          }
        | {
            Args: {
              p_business_id: string
              p_date: string
              p_service_id: string
              p_timezone?: string
            }
            Returns: {
              slot_time: string
            }[]
          }
      fn_get_business_by_phone: {
        Args: { p_wa_phone_id: string }
        Returns: {
          id: string
          name: string
          settings: Json
          timezone: string
        }[]
      }
      fn_get_businesses_at_hour: {
        Args: { p_hour: number }
        Returns: {
          id: string
          name: string
          phone: string
          settings: Json
          timezone: string
        }[]
      }
      fn_get_dashboard_stats: {
        Args: {
          p_business_id: string
          p_month_start: string
          p_today_end: string
          p_today_start: string
        }
        Returns: {
          month_revenue: number
          pending_count: number
          today_count: number
          total_clients: number
        }[]
      }
      fn_mark_all_notifications_as_read: {
        Args: { target_business_id: string }
        Returns: undefined
      }
      fn_record_failed_password_attempt: {
        Args: { p_business_id?: string; p_email: string }
        Returns: Json
      }
      fn_reschedule_appointment_wa: {
        Args: {
          p_appointment_id: string
          p_business_id: string
          p_new_start_at: string
        }
        Returns: Json
      }
      fn_reset_all_web_rate_limits: { Args: never; Returns: undefined }
      fn_reset_password_attempts: { Args: { p_email: string }; Returns: Json }
      fn_resolve_security_alert: {
        Args: { p_alert_id: string; p_notes?: string; p_status: string }
        Returns: Json
      }
      fn_upsert_reminder: {
        Args: {
          p_appointment_id: string
          p_business_id: string
          p_minutes_before: number
          p_remind_at: string
        }
        Returns: string
      }
      fn_wa_check_booking_limit: {
        Args: {
          p_business_id: string
          p_max_bookings?: number
          p_sender: string
          p_window_secs?: number
        }
        Returns: boolean
      }
      fn_wa_check_business_limit: {
        Args: {
          p_business_id: string
          p_max_msgs?: number
          p_window_secs?: number
        }
        Returns: boolean
      }
      fn_wa_check_circuit_breaker: {
        Args: { p_reset_mins?: number; p_service_name: string }
        Returns: boolean
      }
      fn_wa_check_rate_limit: {
        Args: { p_max_msgs?: number; p_sender: string; p_window_secs?: number }
        Returns: boolean
      }
      fn_wa_check_token_quota: {
        Args: { p_business_id: string; p_daily_limit?: number }
        Returns: boolean
      }
      fn_wa_gc_business_usage: { Args: never; Returns: undefined }
      fn_wa_gc_rate_limits: { Args: never; Returns: undefined }
      fn_wa_report_service_failure: {
        Args: { p_service_name: string; p_threshold?: number }
        Returns: undefined
      }
      fn_wa_report_service_success: {
        Args: { p_service_name: string }
        Returns: undefined
      }
      fn_wa_track_token_usage: {
        Args: { p_business_id: string; p_tokens: number }
        Returns: undefined
      }
      fn_web_check_rate_limit: {
        Args: {
          p_identifier: string
          p_max_req?: number
          p_window_secs?: number
        }
        Returns: boolean
      }
      fn_web_gc_rate_limits: { Args: never; Returns: undefined }
      format_type_string: { Args: { "": string }; Returns: string }
      get_clients_debts: {
        Args: { p_business_id: string }
        Returns: {
          client_id: string
          total_debt: number
        }[]
      }
      get_inactive_clients_rpc: {
        Args: { biz_id: string; sixty_days_ago: string }
        Returns: {
          id: string
          last_appt: string
          name: string
        }[]
      }
      get_reengageable_clients_rpc: {
        Args: { antispam_days: number; biz_id: string; frequency_days: number }
        Returns: {
          id: string
          last_completed_at: string
          last_visit_at: string
          name: string
          phone: string
        }[]
      }
      get_my_business_id: { Args: never; Returns: string }
      has_unique: { Args: { "": string }; Returns: string }
      in_todo: { Args: never; Returns: boolean }
      is_empty: { Args: { "": string }; Returns: string }
      isnt_empty: { Args: { "": string }; Returns: string }
      lives_ok: { Args: { "": string }; Returns: string }
      match_memories: {
        Args: {
          match_count: number
          match_threshold: number
          p_business_id: string
          p_user_id: string
          query_embedding: string
        }
        Returns: {
          content: string
          id: string
          metadata: Json
          similarity: number
        }[]
      }
      no_plan: { Args: never; Returns: boolean[] }
      num_failed: { Args: never; Returns: number }
      os_name: { Args: never; Returns: string }
      pass:
        | { Args: never; Returns: string }
        | { Args: { "": string }; Returns: string }
      pg_version: { Args: never; Returns: string }
      pg_version_num: { Args: never; Returns: number }
      pgtap_version: { Args: never; Returns: number }
      runtests:
        | { Args: never; Returns: string[] }
        | { Args: { "": string }; Returns: string[] }
      skip:
        | { Args: { "": string }; Returns: string }
        | { Args: { how_many: number; why: string }; Returns: string }
      throws_ok: { Args: { "": string }; Returns: string }
      todo:
        | { Args: { how_many: number }; Returns: boolean[] }
        | { Args: { how_many: number; why: string }; Returns: boolean[] }
        | { Args: { why: string }; Returns: boolean[] }
        | { Args: { how_many: number; why: string }; Returns: boolean[] }
      todo_end: { Args: never; Returns: boolean[] }
      todo_start:
        | { Args: never; Returns: boolean[] }
        | { Args: { "": string }; Returns: boolean[] }
    }
    Enums: {
      alert_severity: "none" | "warning" | "critical" | "immediate_review"
      appointment_status:
        | "pending"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "no_show"
      auth_provider: "email" | "google" | "hybrid"
      business_plan: "free" | "pro" | "enterprise"
      edge_type: "aliases_with" | "prefers_time_window"
      entity_kind: "client" | "service" | "staff" | "business" | "appointment"
      expense_category:
        | "supplies"
        | "rent"
        | "utilities"
        | "payroll"
        | "marketing"
        | "equipment"
        | "other"
      payment_method: "cash" | "card" | "transfer" | "qr" | "other"
      saas_invoice_status:
        | "waiting"
        | "confirming"
        | "finished"
        | "partially_paid"
        | "failed"
        | "expired"
        | "refunded"
      security_alert_type:
        | "password_lockout_threshold"
        | "suspicious_ip"
        | "suspicious_user_agent"
        | "credential_stuffing_detected"
        | "account_recovery_attempted"
        | "unusual_login_location"
      user_role: "owner" | "employee" | "platform_admin"
      user_status: "pending" | "active" | "rejected"
    }
    CompositeTypes: {
      _time_trial_type: {
        a_time: number | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      alert_severity: ["none", "warning", "critical", "immediate_review"],
      appointment_status: [
        "pending",
        "confirmed",
        "completed",
        "cancelled",
        "no_show",
      ],
      auth_provider: ["email", "google", "hybrid"],
      business_plan: ["free", "pro", "enterprise"],
      edge_type: ["aliases_with", "prefers_time_window"],
      entity_kind: ["client", "service", "staff", "business", "appointment"],
      expense_category: [
        "supplies",
        "rent",
        "utilities",
        "payroll",
        "marketing",
        "equipment",
        "other",
      ],
      payment_method: ["cash", "card", "transfer", "qr", "other"],
      saas_invoice_status: [
        "waiting",
        "confirming",
        "finished",
        "partially_paid",
        "failed",
        "expired",
        "refunded",
      ],
      security_alert_type: [
        "password_lockout_threshold",
        "suspicious_ip",
        "suspicious_user_agent",
        "credential_stuffing_detected",
        "account_recovery_attempted",
        "unusual_login_location",
      ],
      user_role: ["owner", "employee", "platform_admin"],
      user_status: ["pending", "active", "rejected"],
    },
  },
} as const

