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

/** Platforms with an OAuth connector. Mirrors the live CHECK constraint. */
export type ConnectorPlatform = "META" | "TIKTOK" | "X";
export type ConnectorCapability =
  | "CONNECT_ACCOUNT"
  | "READ_ANALYTICS"
  | "PUBLISH_CONTENT"
  | "CREATE_CAMPAIGN"
  | "CREATE_AD"
  | "UPDATE_BUDGET"
  | "PAUSE_CAMPAIGN";
/** Mirrors prompter_connected_accounts.status's live CHECK constraint. */
export type StoredConnectionStatus = "CONNECTED" | "EXPIRED" | "ACTION_REQUIRED" | "DISCONNECTED";
export type WebhookEventStatus = "RECEIVED" | "PROCESSED" | "FAILED" | "IGNORED";
export type PromotionHandoffStatus = "PENDING" | "CONSUMED" | "EXPIRED";
export type ConversionEventType =
  | "LEAD"
  | "SIGNUP"
  | "ADD_TO_CART"
  | "CHECKOUT"
  | "PURCHASE"
  | "SUBSCRIPTION";

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
      prompter_conversions: {
        Row: {
          id: string;
          tenant_id: string;
          master_campaign_id: string | null;
          channel_campaign_id: string | null;
          customer_reference: string | null;
          order_reference: string | null;
          source: string;
          event_type: ConversionEventType;
          value: number | null;
          currency: string;
          occurred_at: string;
          metadata: Json;
          external_event_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          master_campaign_id?: string | null;
          channel_campaign_id?: string | null;
          customer_reference?: string | null;
          order_reference?: string | null;
          source?: string;
          event_type: ConversionEventType;
          value?: number | null;
          currency?: string;
          occurred_at?: string;
          metadata?: Json;
          external_event_id?: string | null;
        };
        Update: never; // conversions are recorded once, never edited
        Relationships: [];
      };
      prompter_platform_capabilities: {
        Row: {
          platform: ConnectorPlatform;
          capability: ConnectorCapability;
          enabled: boolean;
          requires_oauth: boolean;
          requires_approval: boolean;
          api_version: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never; // global registry, seeded by migrations only — see docs/DATABASE.md
        Update: never;
        Relationships: [];
      };
      prompter_connected_accounts: {
        Row: {
          id: string;
          tenant_id: string;
          platform: ConnectorPlatform;
          external_account_id: string;
          external_account_name: string | null;
          status: StoredConnectionStatus;
          scopes: string[];
          expires_at: string | null;
          refreshable: boolean;
          last_refreshed_at: string | null;
          connected_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          platform: ConnectorPlatform;
          external_account_id: string;
          external_account_name?: string | null;
          status?: StoredConnectionStatus;
          scopes?: string[];
          expires_at?: string | null;
          refreshable?: boolean;
          last_refreshed_at?: string | null;
          connected_by?: string | null;
        };
        Update: Partial<
          Omit<
            Database["public"]["Tables"]["prompter_connected_accounts"]["Insert"],
            "tenant_id" | "platform"
          >
        >;
        Relationships: [];
      };
      prompter_oauth_credentials: {
        Row: {
          id: string;
          tenant_id: string;
          connected_account_id: string;
          encrypted_access_token: string;
          encrypted_refresh_token: string | null;
          created_at: string;
          updated_at: string;
        };
        // Zero RLS policy on this table (service-role only) — see
        // supabase/migrations/20260829102304_prompter_phase3_schema.sql.
        // Only lib/supabase/admin.ts's createAdminClient() may touch it.
        Insert: {
          id?: string;
          tenant_id: string;
          connected_account_id: string;
          encrypted_access_token: string;
          encrypted_refresh_token?: string | null;
        };
        Update: Partial<
          Omit<
            Database["public"]["Tables"]["prompter_oauth_credentials"]["Insert"],
            "tenant_id" | "connected_account_id"
          >
        >;
        Relationships: [];
      };
      prompter_product_snapshots: {
        Row: {
          id: string;
          tenant_id: string;
          source_system: string;
          source_product_id: string;
          linked_product_id: string | null;
          name: string;
          description: string | null;
          price: number | null;
          currency: string;
          stock: number | null;
          hpp: number | null;
          category: string | null;
          images: Json;
          snapshot_at: string;
          source_updated_at: string | null;
          created_at: string;
        };
        // Append-only, written only by the service-role client — see
        // supabase/migrations/20260829104743_prompter_phase4_schema.sql.
        Insert: {
          id?: string;
          tenant_id: string;
          source_system?: string;
          source_product_id: string;
          linked_product_id?: string | null;
          name: string;
          description?: string | null;
          price?: number | null;
          currency?: string;
          stock?: number | null;
          hpp?: number | null;
          category?: string | null;
          images?: Json;
          snapshot_at?: string;
          source_updated_at?: string | null;
        };
        // The row's business data is append-only, but linked_product_id
        // is deliberately set in a second write right after insert (see
        // lib/umkmpro/handoff.ts#recordProductSnapshot) once the mirrored
        // prompter_products row's id is known.
        Update: {
          linked_product_id?: string | null;
        };
        Relationships: [];
      };
      prompter_promotion_handoffs: {
        Row: {
          id: string;
          tenant_id: string;
          snapshot_id: string | null;
          product_id: string | null;
          source_system: string;
          external_user_reference: string | null;
          status: PromotionHandoffStatus;
          idempotency_key: string | null;
          expires_at: string;
          consumed_at: string | null;
          created_at: string;
        };
        // Written only by the service-role client from a signed UMKMpro
        // request; the app's own users may only mark one CONSUMED.
        Insert: {
          id?: string;
          tenant_id: string;
          snapshot_id?: string | null;
          product_id?: string | null;
          source_system?: string;
          external_user_reference?: string | null;
          status?: PromotionHandoffStatus;
          idempotency_key?: string | null;
          expires_at?: string;
        };
        Update: {
          status?: PromotionHandoffStatus;
          consumed_at?: string | null;
        };
        Relationships: [];
      };
      prompter_webhook_events: {
        Row: {
          id: string;
          tenant_id: string | null;
          source_system: string;
          external_event_id: string;
          event_type: string;
          payload: Json;
          status: WebhookEventStatus;
          error: string | null;
          received_at: string;
          processed_at: string | null;
        };
        // Idempotent receipt log, written only by the service-role client.
        Insert: {
          id?: string;
          tenant_id?: string | null;
          source_system?: string;
          external_event_id: string;
          event_type: string;
          payload?: Json;
          status?: WebhookEventStatus;
          error?: string | null;
          processed_at?: string | null;
        };
        Update: {
          status?: WebhookEventStatus;
          error?: string | null;
          processed_at?: string | null;
        };
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
