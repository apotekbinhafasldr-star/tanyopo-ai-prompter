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
export type AiJobType =
  | "MARKETING_BLUEPRINT"
  | "CAMPAIGN_PROPOSAL"
  | "CONTENT_GENERATION"
  | "SEO_RECOMMENDATIONS"
  | "ANALYTICS_INSIGHT"
  | "OPTIMIZATION_RECOMMENDATION";
export type AiJobStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
export type AiErrorCategory =
  | "AUTH"
  | "RATE_LIMIT"
  | "CONNECTION"
  | "API"
  | "REFUSAL"
  | "INVALID_OUTPUT"
  | "CONFIG"
  | "UNKNOWN";
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
export type ApprovalType =
  | "CAMPAIGN_LAUNCH"
  | "BUDGET_CHANGE"
  | "CAMPAIGN_SCALE"
  | "CONTENT_PUBLISH"
  | "AUTOPILOT_ACTION";
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
export type ConversionEventType =
  | "LEAD"
  | "SIGNUP"
  | "ADD_TO_CART"
  | "CHECKOUT"
  | "PURCHASE"
  | "SUBSCRIPTION";
export type AttributionModel = "LAST_CLICK" | "FIRST_CLICK" | "MANUAL" | "UMKMPRO_VERIFIED";
export type SubscriptionPlan = "FREE" | "PRO" | "BUSINESS" | "GROWTH" | "AGENCY" | "UMKMPRO_BUNDLE";
export type SubscriptionStatus = "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED";
export type InvoiceStatus = "DRAFT" | "OPEN" | "PAID" | "VOID" | "UNCOLLECTIBLE";
export type JobType =
  | "AI_GENERATION"
  | "CONTENT_GENERATION"
  | "CAMPAIGN_EXECUTION"
  | "ANALYTICS_SYNC"
  | "WEBHOOK_PROCESSING"
  | "SEO_JOB"
  | "OPTIMIZATION_JOB"
  | "EXTERNAL_API_RETRY";
export type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
export type CapabilityStatus = "SUPPORTED" | "UNSUPPORTED" | "NOT_CONFIGURED" | "BLOCKED_EXTERNAL" | "REQUIRES_APPROVAL";
export type ComplianceFlagType =
  | "DATA_RESIDENCY"
  | "MARKETING_CONSENT"
  | "AGE_SENSITIVE_PRODUCT"
  | "REGULATED_PRODUCT"
  | "PLATFORM_AD_RESTRICTION"
  | "TERMS_PRIVACY_LINK";
export type ComplianceStatus = "COMPLIANCE_REVIEW_REQUIRED" | "SUPPORTED" | "RESTRICTED" | "NOT_CONFIGURED";
export type FeatureFlagKey =
  | "global_onboarding"
  | "multi_currency"
  | "market_targeting"
  | "english_ui"
  | "regional_capabilities"
  | "global_billing"
  | "global_analytics_dimensions";
export type HandoffStatus = "PENDING" | "CONSUMED" | "EXPIRED";
export type WebhookEventStatus = "RECEIVED" | "PROCESSED" | "FAILED" | "IGNORED";

/** Social platforms Growth tracks follower goals/history for — Channel minus SEO. */
export type GrowthPlatform = "FACEBOOK" | "INSTAGRAM" | "TIKTOK" | "X";
export type FollowerSnapshotSource = "manual";
export type SeoProjectStatus = "ACTIVE" | "PAUSED";

/** A single suggested action inside an optimization recommendation — never executed on its own, only ever proposed. */
export type OptimizationActionType = "INCREASE_BUDGET" | "DECREASE_BUDGET" | "PAUSE_CHANNEL" | "NO_ACTION";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type AutopilotPolicyType = "AUTO_PAUSE_UNDERPERFORMING" | "AUTO_PROPOSE_BUDGET_REALLOCATION";

/** Connector/OAuth provider — distinct from `Channel`, which names a content/campaign destination. */
export type ConnectorPlatform = "META" | "TIKTOK" | "X";
export type ConnectorCapability =
  | "CONNECT_ACCOUNT"
  | "READ_ANALYTICS"
  | "PUBLISH_CONTENT"
  | "CREATE_CAMPAIGN"
  | "CREATE_AD"
  | "UPDATE_BUDGET"
  | "PAUSE_CAMPAIGN";
export type StoredConnectionStatus = "CONNECTED" | "EXPIRED" | "ACTION_REQUIRED" | "DISCONNECTED";

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
          country_code: string | null;
          region: string | null;
          billing_country: string | null;
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
          country_code?: string | null;
          region?: string | null;
          billing_country?: string | null;
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
          target_countries: Json;
          language: string | null;
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
          source_system?: "promoter" | "umkmpro";
          source_product_id?: string | null;
          target_countries?: Json;
          language?: string | null;
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
          actor_user_id: string | null;
          job_type: AiJobType;
          status: AiJobStatus;
          provider: string | null;
          model: string | null;
          fallback_provider: string | null;
          error_category: AiErrorCategory | null;
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
          actor_user_id?: string | null;
          job_type: AiJobType;
          status?: AiJobStatus;
          provider?: string | null;
          model?: string | null;
          fallback_provider?: string | null;
          error_category?: AiErrorCategory | null;
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
          target_language: string | null;
          target_currency: string | null;
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
          target_language?: string | null;
          target_currency?: string | null;
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
          scheduled_at: string | null;
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
          scheduled_at?: string | null;
        };
        Update: Partial<
          Omit<Database["public"]["Tables"]["prompter_content_items"]["Insert"], "tenant_id">
        >;
        Relationships: [];
      };
      prompter_budget_policies: {
        Row: {
          tenant_id: string;
          daily_limit: number | null;
          monthly_limit: number | null;
          campaign_limit: number | null;
          currency: string;
          require_approval_above: number | null;
          autopilot_limit: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          tenant_id: string;
          daily_limit?: number | null;
          monthly_limit?: number | null;
          campaign_limit?: number | null;
          currency?: string;
          require_approval_above?: number | null;
          autopilot_limit?: number | null;
        };
        Update: Partial<
          Omit<Database["public"]["Tables"]["prompter_budget_policies"]["Insert"], "tenant_id">
        >;
        Relationships: [];
      };
      prompter_subscriptions: {
        Row: {
          tenant_id: string;
          plan: SubscriptionPlan;
          status: SubscriptionStatus;
          billing_provider: string | null;
          success_fee_rate_bps: number | null;
          current_period_start: string | null;
          current_period_end: string | null;
          billing_country: string | null;
          invoice_currency: string | null;
          payment_provider_customer_reference: string | null;
          tax_metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          tenant_id: string;
          plan?: SubscriptionPlan;
          status?: SubscriptionStatus;
          billing_provider?: string | null;
          success_fee_rate_bps?: number | null;
          current_period_start?: string | null;
          current_period_end?: string | null;
          billing_country?: string | null;
          invoice_currency?: string | null;
          payment_provider_customer_reference?: string | null;
          tax_metadata?: Json;
        };
        Update: Partial<
          Omit<Database["public"]["Tables"]["prompter_subscriptions"]["Insert"], "tenant_id">
        >;
        Relationships: [];
      };
      prompter_invoices: {
        Row: {
          id: string;
          tenant_id: string;
          provider: string | null;
          external_invoice_id: string | null;
          status: InvoiceStatus;
          amount: number | null;
          currency: string;
          description: string | null;
          period_start: string | null;
          period_end: string | null;
          issued_at: string | null;
          paid_at: string | null;
          billing_country: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          provider?: string | null;
          external_invoice_id?: string | null;
          status?: InvoiceStatus;
          amount?: number | null;
          currency?: string;
          billing_country?: string | null;
          description?: string | null;
          period_start?: string | null;
          period_end?: string | null;
          issued_at?: string | null;
          paid_at?: string | null;
        };
        Update: Partial<Omit<Database["public"]["Tables"]["prompter_invoices"]["Insert"], "tenant_id">>;
        Relationships: [];
      };
      prompter_compliance_flags: {
        Row: {
          id: string;
          tenant_id: string;
          market_country_code: string | null;
          flag_type: ComplianceFlagType;
          status: ComplianceStatus;
          notes: string | null;
          url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          market_country_code?: string | null;
          flag_type: ComplianceFlagType;
          status?: ComplianceStatus;
          notes?: string | null;
          url?: string | null;
        };
        Update: Partial<
          Omit<Database["public"]["Tables"]["prompter_compliance_flags"]["Insert"], "tenant_id">
        >;
        Relationships: [];
      };
      prompter_feature_flags: {
        Row: {
          tenant_id: string;
          flag_key: FeatureFlagKey;
          enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          tenant_id: string;
          flag_key: FeatureFlagKey;
          enabled?: boolean;
        };
        Update: Partial<
          Omit<Database["public"]["Tables"]["prompter_feature_flags"]["Insert"], "tenant_id" | "flag_key">
        >;
        Relationships: [];
      };
      prompter_jobs: {
        Row: {
          id: string;
          tenant_id: string;
          job_type: JobType;
          status: JobStatus;
          payload: Json;
          result: Json | null;
          error: string | null;
          attempts: number;
          max_attempts: number;
          idempotency_key: string | null;
          created_by: string | null;
          run_at: string;
          started_at: string | null;
          finished_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          job_type: JobType;
          status?: JobStatus;
          payload?: Json;
          result?: Json | null;
          error?: string | null;
          attempts?: number;
          max_attempts?: number;
          idempotency_key?: string | null;
          created_by?: string | null;
          run_at?: string;
          started_at?: string | null;
          finished_at?: string | null;
        };
        Update: Partial<Omit<Database["public"]["Tables"]["prompter_jobs"]["Insert"], "tenant_id" | "job_type">>;
        Relationships: [];
      };
      prompter_channel_campaigns: {
        Row: {
          id: string;
          tenant_id: string;
          master_campaign_id: string;
          channel: Channel;
          status: CampaignStatus;
          budget_percentage: number | null;
          external_campaign_id: string | null;
          error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          master_campaign_id: string;
          channel: Channel;
          status?: CampaignStatus;
          budget_percentage?: number | null;
          external_campaign_id?: string | null;
          error?: string | null;
        };
        Update: Partial<
          Omit<
            Database["public"]["Tables"]["prompter_channel_campaigns"]["Insert"],
            "tenant_id" | "master_campaign_id"
          >
        >;
        Relationships: [];
      };
      prompter_approvals: {
        Row: {
          id: string;
          tenant_id: string;
          approval_type: ApprovalType;
          status: ApprovalStatus;
          resource_type: string;
          resource_id: string;
          requested_by: string | null;
          decided_by: string | null;
          decided_at: string | null;
          reason: string | null;
          context: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          approval_type: ApprovalType;
          status?: ApprovalStatus;
          resource_type: string;
          resource_id: string;
          requested_by?: string | null;
          context?: Json;
        };
        Update: {
          status?: ApprovalStatus;
          decided_by?: string | null;
          decided_at?: string | null;
          reason?: string | null;
        };
        Relationships: [];
      };
      prompter_marketing_metrics: {
        Row: {
          id: string;
          tenant_id: string;
          master_campaign_id: string | null;
          channel_campaign_id: string | null;
          platform: Channel;
          date: string;
          spend: number;
          impressions: number;
          reach: number;
          clicks: number;
          engagements: number;
          leads: number;
          conversions: number;
          revenue: number;
          followers_acquired: number;
          raw_data: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          master_campaign_id?: string | null;
          channel_campaign_id?: string | null;
          platform: Channel;
          date: string;
          spend?: number;
          impressions?: number;
          reach?: number;
          clicks?: number;
          engagements?: number;
          leads?: number;
          conversions?: number;
          revenue?: number;
          followers_acquired?: number;
          raw_data?: Json;
        };
        Update: Partial<
          Omit<Database["public"]["Tables"]["prompter_marketing_metrics"]["Insert"], "tenant_id">
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
        Update: Partial<
          Omit<Database["public"]["Tables"]["prompter_conversions"]["Insert"], "tenant_id">
        >;
        Relationships: [];
      };
      prompter_attributions: {
        Row: {
          id: string;
          tenant_id: string;
          conversion_id: string;
          master_campaign_id: string | null;
          channel_campaign_id: string | null;
          touchpoint_type: string | null;
          attribution_model: AttributionModel;
          weight: number;
          attributed_value: number | null;
          currency: string | null;
          confidence: number | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          conversion_id: string;
          master_campaign_id?: string | null;
          channel_campaign_id?: string | null;
          touchpoint_type?: string | null;
          attribution_model?: AttributionModel;
          weight?: number;
          attributed_value?: number | null;
          currency?: string | null;
          confidence?: number | null;
          metadata?: Json;
        };
        Update: Partial<
          Omit<
            Database["public"]["Tables"]["prompter_attributions"]["Insert"],
            "tenant_id" | "conversion_id"
          >
        >;
        Relationships: [];
      };
      prompter_platform_capabilities: {
        Row: {
          platform: ConnectorPlatform;
          capability: ConnectorCapability;
          country_code: string;
          enabled: boolean;
          status: CapabilityStatus;
          requires_oauth: boolean;
          requires_approval: boolean;
          api_version: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never; // seeded by migration only — no INSERT policy exists
        Update: never; // no UPDATE policy exists — capability changes are migrations
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
          Omit<Database["public"]["Tables"]["prompter_connected_accounts"]["Insert"], "tenant_id">
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
        Update: never; // append-only — see migration comment on this table
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
          status: HandoffStatus;
          idempotency_key: string | null;
          expires_at: string;
          consumed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          snapshot_id?: string | null;
          product_id?: string | null;
          source_system?: string;
          external_user_reference?: string | null;
          status?: HandoffStatus;
          idempotency_key?: string | null;
          expires_at?: string;
        };
        Update: {
          status?: HandoffStatus;
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
        Update: never; // written only by the service-role client
        Relationships: [];
      };
      prompter_growth_goals: {
        Row: {
          id: string;
          tenant_id: string;
          platform: GrowthPlatform;
          target_followers: number;
          target_date: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          platform: GrowthPlatform;
          target_followers: number;
          target_date?: string | null;
          notes?: string | null;
        };
        Update: Partial<
          Omit<Database["public"]["Tables"]["prompter_growth_goals"]["Insert"], "tenant_id" | "platform">
        >;
        Relationships: [];
      };
      prompter_follower_snapshots: {
        Row: {
          id: string;
          tenant_id: string;
          platform: GrowthPlatform;
          follower_count: number;
          recorded_at: string;
          source: FollowerSnapshotSource;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          platform: GrowthPlatform;
          follower_count: number;
          recorded_at?: string;
          source?: FollowerSnapshotSource;
        };
        Update: never; // corrections go through upsert (onConflict tenant_id,platform,recorded_at), not edit-in-place
        Relationships: [];
      };
      prompter_seo_projects: {
        Row: {
          id: string;
          tenant_id: string;
          website_url: string;
          target_keywords: Json;
          status: SeoProjectStatus;
          country_code: string | null;
          language: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          website_url: string;
          target_keywords?: Json;
          status?: SeoProjectStatus;
          country_code?: string | null;
          language?: string | null;
        };
        Update: Partial<
          Omit<Database["public"]["Tables"]["prompter_seo_projects"]["Insert"], "tenant_id">
        >;
        Relationships: [];
      };
      prompter_seo_recommendations: {
        Row: {
          id: string;
          tenant_id: string;
          project_id: string;
          summary: string | null;
          target_keywords: Json;
          on_page_recommendations: Json;
          content_plan: Json;
          ai_job_id: string | null;
          model: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          project_id: string;
          summary?: string | null;
          target_keywords?: Json;
          on_page_recommendations?: Json;
          content_plan?: Json;
          ai_job_id?: string | null;
          model?: string | null;
        };
        Update: Partial<
          Omit<
            Database["public"]["Tables"]["prompter_seo_recommendations"]["Insert"],
            "tenant_id" | "project_id"
          >
        >;
        Relationships: [];
      };
      prompter_analytics_insights: {
        Row: {
          tenant_id: string;
          summary: string | null;
          trends: Json;
          top_channel: string | null;
          underperforming_channels: Json;
          risks: Json;
          ai_job_id: string | null;
          model: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          tenant_id: string;
          summary?: string | null;
          trends?: Json;
          top_channel?: string | null;
          underperforming_channels?: Json;
          risks?: Json;
          ai_job_id?: string | null;
          model?: string | null;
        };
        Update: Partial<
          Omit<Database["public"]["Tables"]["prompter_analytics_insights"]["Insert"], "tenant_id">
        >;
        Relationships: [];
      };
      prompter_optimization_recommendations: {
        Row: {
          id: string;
          tenant_id: string;
          master_campaign_id: string;
          summary: string | null;
          recommendations: Json;
          ai_job_id: string | null;
          model: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          master_campaign_id: string;
          summary?: string | null;
          recommendations?: Json;
          ai_job_id?: string | null;
          model?: string | null;
        };
        Update: Partial<
          Omit<
            Database["public"]["Tables"]["prompter_optimization_recommendations"]["Insert"],
            "tenant_id" | "master_campaign_id"
          >
        >;
        Relationships: [];
      };
      prompter_autopilot_policies: {
        Row: {
          id: string;
          tenant_id: string;
          policy_type: AutopilotPolicyType;
          enabled: boolean;
          threshold_config: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          policy_type: AutopilotPolicyType;
          enabled?: boolean;
          threshold_config?: Json;
        };
        Update: Partial<
          Omit<
            Database["public"]["Tables"]["prompter_autopilot_policies"]["Insert"],
            "tenant_id" | "policy_type"
          >
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
      prompter_claim_next_job: {
        Args: { p_job_types: JobType[] | null };
        Returns: Database["public"]["Tables"]["prompter_jobs"]["Row"] | null;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
