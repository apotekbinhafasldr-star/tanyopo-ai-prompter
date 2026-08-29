/**
 * Hand-scoped Supabase database types for Tanyopo AI Promoter.
 *
 * The Promoter app shares a Supabase *project* with UMKMpro AI (see
 * docs/DATABASE.md) but owns only the `prompter_*` tables plus read access
 * to a few pre-existing identity tables (`tenants`, `user_profiles`). That
 * project's full generated schema is hundreds of UMKMpro-specific tables
 * this app never queries, so rather than importing all of it we hand-author
 * types for the slice Promoter actually uses. This keeps the type surface
 * honest about what this codebase is allowed to touch.
 *
 * Regenerate/extend this file whenever a migration changes a table shape
 * Promoter depends on. If a future feature needs a broader read of the
 * UMKMpro schema, prefer adding the specific table here over switching to
 * the full generated file.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type BusinessCategory =
  | "PHYSICAL_PRODUCT"
  | "SERVICE"
  | "APPLICATION"
  | "SUBSCRIPTION"
  | "DIGITAL_PRODUCT";

export type PrimaryGoal =
  | "INCREASE_SALES"
  | "GET_LEADS"
  | "INCREASE_FOLLOWERS"
  | "BRAND_AWARENESS"
  | "WEBSITE_TRAFFIC"
  | "PROMOTE_APP";

export type AutomationMode = "manual" | "ai_assist" | "autopilot";

export type ProductStatus = "ACTIVE" | "DRAFT" | "ARCHIVED";
export type MediaType = "IMAGE" | "VIDEO";
export type AiJobType = "MARKETING_BLUEPRINT" | "CAMPAIGN_PROPOSAL" | "CONTENT_GENERATION";
export type AiJobStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
export type CampaignStatus =
  | "DRAFT"
  | "AWAITING_APPROVAL"
  | "SCHEDULED"
  | "ACTIVE"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED";
export type Channel = "FACEBOOK" | "INSTAGRAM" | "TIKTOK" | "X" | "SEO";
export type ContentPlatform = "FACEBOOK" | "INSTAGRAM" | "TIKTOK" | "X" | "WEBSITE";
export type ContentType = "CAPTION" | "AD_COPY" | "BLOG" | "VIDEO_SCRIPT";
export type ContentStatus = "DRAFT" | "APPROVED" | "SCHEDULED" | "PUBLISHED" | "FAILED";

/** Mirrors the existing UMKMpro `user_profiles.role` CHECK constraint. */
export type TenantRole =
  | "owner"
  | "apoteker"
  | "kasir"
  | "admin_gudang"
  | "hr"
  | "marketing";

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string;
          nama_usaha: string;
          jenis_usaha: string;
          email: string | null;
          logo_url: string | null;
          created_at: string;
        };
        Insert: never; // provisioned only via the shared handle_new_user trigger
        Update: {
          nama_usaha?: string;
          email?: string | null;
          logo_url?: string | null;
        };
        Relationships: [];
      };
      user_profiles: {
        Row: {
          id: string;
          tenant_id: string;
          nama: string;
          role: TenantRole;
          created_at: string;
        };
        Insert: never; // provisioned only via the shared handle_new_user trigger
        Update: {
          nama?: string;
        };
        Relationships: [];
      };
      prompter_brand_profiles: {
        Row: {
          tenant_id: string;
          brand_name: string | null;
          business_description: string | null;
          what_do_you_sell: string | null;
          business_category: BusinessCategory | null;
          primary_goal: PrimaryGoal | null;
          tone_of_voice: string | null;
          target_market: string | null;
          prohibited_claims: string | null;
          default_language: "id" | "en";
          default_location: string | null;
          default_currency: string;
          default_timezone: string;
          logo_url: string | null;
          website_url: string | null;
          onboarding_completed: boolean;
          onboarding_step: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          tenant_id: string;
          brand_name?: string | null;
          business_description?: string | null;
          what_do_you_sell?: string | null;
          business_category?: BusinessCategory | null;
          primary_goal?: PrimaryGoal | null;
          tone_of_voice?: string | null;
          target_market?: string | null;
          prohibited_claims?: string | null;
          default_language?: "id" | "en";
          default_location?: string | null;
          default_currency?: string;
          default_timezone?: string;
          logo_url?: string | null;
          website_url?: string | null;
          onboarding_completed?: boolean;
          onboarding_step?: number;
        };
        Update: Partial<
          Omit<
            Database["public"]["Tables"]["prompter_brand_profiles"]["Insert"],
            "tenant_id"
          >
        >;
        Relationships: [];
      };
      prompter_automation_settings: {
        Row: {
          tenant_id: string;
          automation_mode: AutomationMode;
          autopilot_daily_limit: number | null;
          emergency_stop_active: boolean;
          emergency_stop_activated_at: string | null;
          emergency_stop_activated_by: string | null;
          emergency_stop_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          tenant_id: string;
          automation_mode?: AutomationMode;
          autopilot_daily_limit?: number | null;
          emergency_stop_active?: boolean;
          emergency_stop_activated_at?: string | null;
          emergency_stop_activated_by?: string | null;
          emergency_stop_reason?: string | null;
        };
        Update: Partial<
          Omit<
            Database["public"]["Tables"]["prompter_automation_settings"]["Insert"],
            "tenant_id"
          >
        >;
        Relationships: [];
      };
      prompter_audit_logs: {
        Row: {
          id: string;
          tenant_id: string;
          actor_user_id: string | null;
          action: string;
          resource_type: string;
          resource_id: string | null;
          before_data: Json | null;
          after_data: Json | null;
          context: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          actor_user_id?: string | null;
          action: string;
          resource_type: string;
          resource_id?: string | null;
          before_data?: Json | null;
          after_data?: Json | null;
          context?: Json;
        };
        Update: never; // audit logs are append-only, see migration comment
        Relationships: [];
      };
      prompter_products: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          description: string | null;
          product_type: BusinessCategory;
          category: string | null;
          price: number | null;
          currency: string;
          stock: number | null;
          hpp: number | null;
          website_url: string | null;
          status: ProductStatus;
          source_system: "promoter" | "umkmpro";
          source_product_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          description?: string | null;
          product_type: BusinessCategory;
          category?: string | null;
          price?: number | null;
          currency?: string;
          stock?: number | null;
          hpp?: number | null;
          website_url?: string | null;
          status?: ProductStatus;
        };
        Update: Partial<
          Omit<Database["public"]["Tables"]["prompter_products"]["Insert"], "tenant_id">
        >;
        Relationships: [];
      };
      prompter_product_media: {
        Row: {
          id: string;
          tenant_id: string;
          product_id: string;
          storage_path: string;
          media_type: MediaType;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          product_id: string;
          storage_path: string;
          media_type: MediaType;
          position?: number;
        };
        Update: never; // media rows are replaced by delete+insert, not edited in place
        Relationships: [];
      };
      prompter_ai_jobs: {
        Row: {
          id: string;
          tenant_id: string;
          job_type: AiJobType;
          status: AiJobStatus;
          model: string | null;
          input_reference: Json;
          output_reference: Json | null;
          tokens_input: number | null;
          tokens_output: number | null;
          estimated_cost: number | null;
          error: string | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          job_type: AiJobType;
          status?: AiJobStatus;
          model?: string | null;
          input_reference?: Json;
          output_reference?: Json | null;
          tokens_input?: number | null;
          tokens_output?: number | null;
          estimated_cost?: number | null;
          error?: string | null;
          completed_at?: string | null;
        };
        Update: Partial<
          Omit<Database["public"]["Tables"]["prompter_ai_jobs"]["Insert"], "tenant_id" | "job_type">
        >;
        Relationships: [];
      };
      prompter_marketing_blueprints: {
        Row: {
          id: string;
          tenant_id: string;
          product_id: string;
          summary: string | null;
          usp: string | null;
          benefits: Json;
          pain_points: Json;
          target_personas: Json;
          positioning: string | null;
          marketing_angles: Json;
          recommended_channels: Json;
          content_ideas: Json;
          risks: Json;
          disclaimers: string | null;
          ai_job_id: string | null;
          model: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          product_id: string;
          summary?: string | null;
          usp?: string | null;
          benefits?: Json;
          pain_points?: Json;
          target_personas?: Json;
          positioning?: string | null;
          marketing_angles?: Json;
          recommended_channels?: Json;
          content_ideas?: Json;
          risks?: Json;
          disclaimers?: string | null;
          ai_job_id?: string | null;
          model?: string | null;
        };
        Update: Partial<
          Omit<
            Database["public"]["Tables"]["prompter_marketing_blueprints"]["Insert"],
            "tenant_id" | "product_id"
          >
        >;
        Relationships: [];
      };
      prompter_master_campaigns: {
        Row: {
          id: string;
          tenant_id: string;
          product_id: string | null;
          name: string;
          objective: PrimaryGoal;
          channels: Channel[];
          status: CampaignStatus;
          target_country: string | null;
          target_region: string | null;
          target_city: string | null;
          audience_notes: string | null;
          daily_budget: number | null;
          total_budget: number | null;
          currency: string;
          duration_days: number | null;
          start_date: string | null;
          ai_proposal: Json | null;
          ai_job_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          product_id?: string | null;
          name: string;
          objective: PrimaryGoal;
          channels?: Channel[];
          status?: CampaignStatus;
          target_country?: string | null;
          target_region?: string | null;
          target_city?: string | null;
          audience_notes?: string | null;
          daily_budget?: number | null;
          total_budget?: number | null;
          currency?: string;
          duration_days?: number | null;
          start_date?: string | null;
          ai_proposal?: Json | null;
          ai_job_id?: string | null;
        };
        Update: Partial<
          Omit<Database["public"]["Tables"]["prompter_master_campaigns"]["Insert"], "tenant_id">
        >;
        Relationships: [];
      };
      prompter_content_items: {
        Row: {
          id: string;
          tenant_id: string;
          product_id: string | null;
          platform: ContentPlatform;
          content_type: ContentType;
          goal: PrimaryGoal | null;
          tone: string | null;
          language: "id" | "en";
          body: Json;
          status: ContentStatus;
          ai_job_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          product_id?: string | null;
          platform: ContentPlatform;
          content_type: ContentType;
          goal?: PrimaryGoal | null;
          tone?: string | null;
          language?: "id" | "en";
          body?: Json;
          status?: ContentStatus;
          ai_job_id?: string | null;
        };
        Update: Partial<
          Omit<Database["public"]["Tables"]["prompter_content_items"]["Insert"], "tenant_id">
        >;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      fn_current_tenant_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      fn_current_role: {
        Args: Record<string, never>;
        Returns: TenantRole;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
