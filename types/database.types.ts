export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      ai_memories: {
        Row: {
          id: string
          business_id: string
          user_id: string
          content: string
          embedding: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          business_id: string
          user_id: string
          content: string
          embedding?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          business_id?: string
          user_id?: string
          content?: string
          embedding?: string | null
          metadata?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_memories_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_memories_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      businesses: {
        Row: {
          id: string
          name: string
          category: string | null
          settings: Json
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          category?: string | null
          settings?: Json
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          category?: string | null
          settings?: Json
          created_at?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          id: string
          name: string
          role: string
          business_id: string | null
          avatar_url: string | null
          color: string | null
          created_at: string
        }
        Insert: {
          id: string
          name: string
          role?: string
          business_id?: string | null
          avatar_url?: string | null
          color?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          role?: string
          business_id?: string | null
          avatar_url?: string | null
          color?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_memories: {
        Args: {
          query_embedding: string
          match_threshold: number
          match_count: number
          p_user_id: string
          p_business_id: string
        }
        Returns: {
          id: string
          content: string
          metadata: Json
          similarity: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
