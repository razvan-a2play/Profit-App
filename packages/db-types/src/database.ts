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
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      allowlist_emails: {
        Row: {
          active: boolean
          created_at: string
          email: string
          id: string
          note: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
          id?: string
          note?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          id?: string
          note?: string | null
        }
        Relationships: []
      }
      "Product Information": {
        Row: {
          ASIN: string | null
          "Carton Height": number | null
          "Carton Length": string | null
          "Carton weight": number | null
          "Carton Width": number | null
          Category: string | null
          "Product box Height": number | null
          "Product box Length": string | null
          "Product box weight (kg)": number | null
          "Product box Width": number | null
          "Product Name": string | null
          SKU: string
          Supplier: string | null
          "Units/carton": number | null
        }
        Insert: {
          ASIN?: string | null
          "Carton Height"?: number | null
          "Carton Length"?: string | null
          "Carton weight"?: number | null
          "Carton Width"?: number | null
          Category?: string | null
          "Product box Height"?: number | null
          "Product box Length"?: string | null
          "Product box weight (kg)"?: number | null
          "Product box Width"?: number | null
          "Product Name"?: string | null
          SKU: string
          Supplier?: string | null
          "Units/carton"?: number | null
        }
        Update: {
          ASIN?: string | null
          "Carton Height"?: number | null
          "Carton Length"?: string | null
          "Carton weight"?: number | null
          "Carton Width"?: number | null
          Category?: string | null
          "Product box Height"?: number | null
          "Product box Length"?: string | null
          "Product box weight (kg)"?: number | null
          "Product box Width"?: number | null
          "Product Name"?: string | null
          SKU?: string
          Supplier?: string | null
          "Units/carton"?: number | null
        }
        Relationships: []
      }
      product_templates: {
        Row: {
          created_at: string
          factory_price_inputs: number | null
          height: number | null
          id: string
          length: number | null
          master_carton_height: number | null
          master_carton_length: number | null
          master_carton_units: number | null
          master_carton_weight: number | null
          master_carton_width: number | null
          name: string
          sku: string
          updated_at: string
          weight: number | null
          width: number | null
        }
        Insert: {
          created_at?: string
          factory_price_inputs?: number | null
          height?: number | null
          id?: string
          length?: number | null
          master_carton_height?: number | null
          master_carton_length?: number | null
          master_carton_units?: number | null
          master_carton_weight?: number | null
          master_carton_width?: number | null
          name: string
          sku: string
          updated_at?: string
          weight?: number | null
          width?: number | null
        }
        Update: {
          created_at?: string
          factory_price_inputs?: number | null
          height?: number | null
          id?: string
          length?: number | null
          master_carton_height?: number | null
          master_carton_length?: number | null
          master_carton_units?: number | null
          master_carton_weight?: number | null
          master_carton_width?: number | null
          name?: string
          sku?: string
          updated_at?: string
          weight?: number | null
          width?: number | null
        }
        Relationships: []
      }
      product_versions: {
        Row: {
          bucket: Database["public"]["Enums"]["bucket_type"] | null
          created_at: string
          creator_email: string | null
          deleted_at: string | null
          id: string
          product_id: number
          updated_at: string
          user_id: string | null
          version_data: Json
          version_name: string
        }
        Insert: {
          bucket?: Database["public"]["Enums"]["bucket_type"] | null
          created_at?: string
          creator_email?: string | null
          deleted_at?: string | null
          id?: string
          product_id: number
          updated_at?: string
          user_id?: string | null
          version_data: Json
          version_name: string
        }
        Update: {
          bucket?: Database["public"]["Enums"]["bucket_type"] | null
          created_at?: string
          creator_email?: string | null
          deleted_at?: string | null
          id?: string
          product_id?: number
          updated_at?: string
          user_id?: string | null
          version_data?: Json
          version_name?: string
        }
        Relationships: []
      }
      version_history: {
        Row: {
          action_type: string
          change_description: string | null
          changed_fields: Json | null
          created_at: string
          id: string
          product_id: number
          user_email: string | null
          user_id: string | null
          version_id: string
        }
        Insert: {
          action_type: string
          change_description?: string | null
          changed_fields?: Json | null
          created_at?: string
          id?: string
          product_id: number
          user_email?: string | null
          user_id?: string | null
          version_id: string
        }
        Update: {
          action_type?: string
          change_description?: string | null
          changed_fields?: Json | null
          created_at?: string
          id?: string
          product_id?: number
          user_email?: string | null
          user_id?: string | null
          version_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_allowlisted_user: { Args: never; Returns: boolean }
    }
    Enums: {
      bucket_type: "live" | "rd"
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
      bucket_type: ["live", "rd"],
    },
  },
} as const
