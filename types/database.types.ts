export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      ai_memories: {
        Row: {
          business_id: string
          content: string
          created_at: string | null
          embedding: string | null
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          business_id: string
          content: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          business_id?: string
          content?: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          metadata?: Json | null
          user_id?: string
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
          category: string
          created_at: string | null
          id: string
          locale: string | null
          logo_url: string | null
          name: string
          owner_id: string
          phone: string | null
          plan: Database["public"]["Enums"]["business_plan"] | null
          settings: Json | null
          slug: string | null
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          category: string
          created_at?: string | null
          id?: string
          locale?: string | null
          logo_url?: string | null
          name: string
          owner_id: string
          phone?: string | null
          plan?: Database["public"]["Enums"]["business_plan"] | null
          settings?: Json | null
          slug?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          category?: string
          created_at?: string | null
          id?: string
          locale?: string | null
          logo_url?: string | null
          name?: string
          owner_id?: string
          phone?: string | null
          plan?: Database["public"]["Enums"]["business_plan"] | null
          settings?: Json | null
          slug?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          avatar_url: string | null
          birthday: string | null
          business_id: string
          created_at: string | null
          deleted_at: string | null
          email: string | null
          id: string
          last_visit_at: string | null
          name: string
          notes: string | null
          phone: string | null
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
          id?: string
          last_visit_at?: string | null
          name: string
          notes?: string | null
          phone?: string | null
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
          id?: string
          last_visit_at?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
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
          payload: Json
          retry_count: number | null
          service_type: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          error?: string | null
          id?: string
          payload: Json
          retry_count?: number | null
          service_type?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          error?: string | null
          id?: string
          payload?: Json
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
          created_at: string | null
          sender_phone: string
          updated_at: string | null
        }
        Insert: {
          business_id: string
          created_at?: string | null
          sender_phone: string
          updated_at?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string | null
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
          total_tokens: number
          usage_date: string
        }
        Insert: {
          business_id: string
          total_tokens?: number
          usage_date?: string
        }
        Update: {
          business_id?: string
          total_tokens?: number
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
      fn_batch_create_transactions: {
        Args: {
          p_business_id: string
          p_transactions: Json
        }
        Returns: Json
      }
      fn_create_business_and_link_owner: {
        Args: {
          p_owner_id: string
          p_owner_name: string
          p_owner_email: string
          p_name: string
          p_category: string
          p_timezone: string
          p_plan: string
        }
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
      fn_clean_phone: { Args: { p_phone: string }; Returns: string }
      fn_find_client_by_phone: {
        Args: { p_business_id: string; p_phone_digits: string }
        Returns: {
          id: string
          name: string
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
      fn_get_dashboard_stats: {
        Args: {
          p_business_id: string
          p_today_start: string
          p_today_end: string
          p_month_start: string
        }
        Returns: {
          today_count: number
          total_clients: number
          month_revenue: number
          pending_count: number
        }[]
      }
      fn_mark_all_notifications_as_read: {
        Args: { target_business_id: string }
        Returns: undefined
      }
      fn_reset_all_web_rate_limits: { Args: never; Returns: undefined }
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
      get_inactive_clients_rpc: {
        Args: { biz_id: string; sixty_days_ago: string }
        Returns: {
          id: string
          last_appt: string
          name: string
        }[]
      }
      get_my_business_id: { Args: never; Returns: string }
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
    }
    Enums: {
      appointment_status:
        | "pending"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "no_show"
      auth_provider: "email" | "google" | "hybrid"
      business_plan: "free" | "pro" | "enterprise"
      expense_category:
        | "supplies"
        | "rent"
        | "utilities"
        | "payroll"
        | "marketing"
        | "equipment"
        | "other"
      payment_method: "cash" | "card" | "transfer" | "qr" | "other"
      user_role: "owner" | "employee" | "platform_admin"
      user_status: "pending" | "active" | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
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
  public: {
    Enums: {
      appointment_status: [
        "pending",
        "confirmed",
        "completed",
        "cancelled",
        "no_show",
      ],
      auth_provider: ["email", "google", "hybrid"],
      business_plan: ["free", "pro", "enterprise"],
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
      user_role: ["owner", "employee", "platform_admin"],
      user_status: ["pending", "active", "rejected"],
    },
  },
} as const
