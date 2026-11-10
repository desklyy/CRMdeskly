export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "admin" | "sales";
export type LeadStatus =
  | "Nuevo"
  | "Contactado"
  | "En Conversación"
  | "Finalizado"
  | "Negocio Abierto"
  | "Sin Calificar";
export type EntityType = "company" | "contact" | "deal";
export type CustomFieldType =
  | "text"
  | "number"
  | "currency"
  | "select"
  | "multi_select"
  | "date"
  | "boolean"
  | "url";
export type DealStatus = "open" | "won" | "lost";
export type DealPriority = "low" | "medium" | "high" | "urgent";
export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";
export type EmailDirection = "inbound" | "outbound";
export type ActorType = "user" | "ai_agent" | "webhook" | "system";
export type ActivityEntityType = "company" | "contact" | "deal" | "quote" | "calendar_event";
export type ApiKeyPermission = "read" | "read_write";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          first_name: string | null;
          last_name: string | null;
          full_name: string;
          avatar_initials: string;
          role: UserRole;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          first_name?: string | null;
          last_name?: string | null;
          full_name: string;
          avatar_initials: string;
          role?: UserRole;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          first_name?: string | null;
          last_name?: string | null;
          full_name?: string;
          avatar_initials?: string;
          role?: UserRole;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      custom_field_definitions: {
        Row: {
          id: string;
          entity_type: EntityType;
          key: string;
          label: string;
          description: string | null;
          section: string;
          field_type: CustomFieldType;
          options: Json;
          default_value: Json | null;
          is_required: boolean;
          is_active: boolean;
          field_order: number;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          entity_type: EntityType;
          key: string;
          label: string;
          description?: string | null;
          section?: string;
          field_type: CustomFieldType;
          options?: Json;
          default_value?: Json | null;
          is_required?: boolean;
          is_active?: boolean;
          field_order?: number;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          entity_type?: EntityType;
          key?: string;
          label?: string;
          description?: string | null;
          section?: string;
          field_type?: CustomFieldType;
          options?: Json;
          default_value?: Json | null;
          is_required?: boolean;
          is_active?: boolean;
          field_order?: number;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      companies: {
        Row: {
          id: string;
          name: string;
          domain: string | null;
          website: string | null;
          tax_id: string | null;
          billing_address: string | null;
          billing_city: string | null;
          billing_postal_code: string | null;
          country: string | null;
          industry: string | null;
          company_size: string | null;
          linkedin_url: string | null;
          owner_id: string | null;
          custom_fields: Record<string, Json>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          domain?: string | null;
          website?: string | null;
          tax_id?: string | null;
          billing_address?: string | null;
          billing_city?: string | null;
          billing_postal_code?: string | null;
          country?: string | null;
          industry?: string | null;
          company_size?: string | null;
          linkedin_url?: string | null;
          owner_id?: string | null;
          custom_fields?: Record<string, Json>;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          domain?: string | null;
          website?: string | null;
          tax_id?: string | null;
          billing_address?: string | null;
          billing_city?: string | null;
          billing_postal_code?: string | null;
          country?: string | null;
          industry?: string | null;
          company_size?: string | null;
          linkedin_url?: string | null;
          owner_id?: string | null;
          custom_fields?: Record<string, Json>;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      contacts: {
        Row: {
          id: string;
          company_id: string | null;
          first_name: string;
          last_name: string | null;
          email: string | null;
          phone: string | null;
          job_title: string | null;
          department: string | null;
          lead_status: LeadStatus;
          linkedin_url: string | null;
          lead_source: string | null;
          owner_id: string | null;
          custom_fields: Record<string, Json>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string | null;
          first_name: string;
          last_name?: string | null;
          email?: string | null;
          phone?: string | null;
          job_title?: string | null;
          department?: string | null;
          lead_status?: LeadStatus;
          linkedin_url?: string | null;
          lead_source?: string | null;
          owner_id?: string | null;
          custom_fields?: Record<string, Json>;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string | null;
          first_name?: string;
          last_name?: string | null;
          email?: string | null;
          phone?: string | null;
          job_title?: string | null;
          department?: string | null;
          lead_status?: LeadStatus;
          linkedin_url?: string | null;
          lead_source?: string | null;
          owner_id?: string | null;
          custom_fields?: Record<string, Json>;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pipelines: {
        Row: {
          id: string;
          name: string;
          is_default: boolean;
          is_active: boolean;
          stale_days_default: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          is_default?: boolean;
          is_active?: boolean;
          stale_days_default?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          is_default?: boolean;
          is_active?: boolean;
          stale_days_default?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      pipeline_stages: {
        Row: {
          id: string;
          pipeline_id: string;
          name: string;
          stage_order: number;
          color_code: string;
          stale_days_override: number | null;
          probability: number;
          is_won_stage: boolean;
          is_lost_stage: boolean;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          pipeline_id: string;
          name: string;
          stage_order: number;
          color_code?: string;
          stale_days_override?: number | null;
          probability?: number;
          is_won_stage?: boolean;
          is_lost_stage?: boolean;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          pipeline_id?: string;
          name?: string;
          stage_order?: number;
          color_code?: string;
          stale_days_override?: number | null;
          probability?: number;
          is_won_stage?: boolean;
          is_lost_stage?: boolean;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      deals: {
        Row: {
          id: string;
          title: string;
          amount: number;
          currency: string;
          pipeline_id: string;
          stage_id: string;
          position: number;
          company_id: string | null;
          primary_contact_id: string | null;
          owner_id: string | null;
          status: DealStatus;
          priority: DealPriority;
          lead_source: string | null;
          probability: number | null;
          expected_close_date: string | null;
          lost_reason: string | null;
          next_action: string | null;
          next_action_date: string | null;
          stage_changed_at: string;
          last_activity_at: string;
          closed_at: string | null;
          custom_fields: Record<string, Json>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          amount?: number;
          currency?: string;
          pipeline_id: string;
          stage_id: string;
          position?: number;
          company_id?: string | null;
          primary_contact_id?: string | null;
          owner_id?: string | null;
          status?: DealStatus;
          priority?: DealPriority;
          lead_source?: string | null;
          probability?: number | null;
          expected_close_date?: string | null;
          lost_reason?: string | null;
          next_action?: string | null;
          next_action_date?: string | null;
          stage_changed_at?: string;
          last_activity_at?: string;
          closed_at?: string | null;
          custom_fields?: Record<string, Json>;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          amount?: number;
          currency?: string;
          pipeline_id?: string;
          stage_id?: string;
          position?: number;
          company_id?: string | null;
          primary_contact_id?: string | null;
          owner_id?: string | null;
          status?: DealStatus;
          priority?: DealPriority;
          lead_source?: string | null;
          probability?: number | null;
          expected_close_date?: string | null;
          lost_reason?: string | null;
          next_action?: string | null;
          next_action_date?: string | null;
          stage_changed_at?: string;
          last_activity_at?: string;
          closed_at?: string | null;
          custom_fields?: Record<string, Json>;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      deal_contacts: {
        Row: {
          deal_id: string;
          contact_id: string;
          role_in_deal: string | null;
        };
        Insert: {
          deal_id: string;
          contact_id: string;
          role_in_deal?: string | null;
        };
        Update: {
          deal_id?: string;
          contact_id?: string;
          role_in_deal?: string | null;
        };
        Relationships: [];
      };
      quotes: {
        Row: {
          id: string;
          quote_number: string;
          deal_id: string;
          company_id: string | null;
          contact_id: string | null;
          created_by: string | null;
          status: QuoteStatus;
          subtotal: number;
          discount_total: number;
          tax_total: number;
          total_amount: number;
          valid_until: string | null;
          terms: string | null;
          billing_snapshot: Json | null;
          sent_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          quote_number: string;
          deal_id: string;
          company_id?: string | null;
          contact_id?: string | null;
          created_by?: string | null;
          status?: QuoteStatus;
          subtotal?: number;
          discount_total?: number;
          tax_total?: number;
          total_amount?: number;
          valid_until?: string | null;
          terms?: string | null;
          billing_snapshot?: Json | null;
          sent_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          quote_number?: string;
          deal_id?: string;
          company_id?: string | null;
          contact_id?: string | null;
          created_by?: string | null;
          status?: QuoteStatus;
          subtotal?: number;
          discount_total?: number;
          tax_total?: number;
          total_amount?: number;
          valid_until?: string | null;
          terms?: string | null;
          billing_snapshot?: Json | null;
          sent_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      quote_items: {
        Row: {
          id: string;
          quote_id: string;
          item_order: number;
          concept: string;
          description: string | null;
          quantity: number;
          unit_price: number;
          discount_percent: number;
          tax_rate: number;
          line_total: number;
        };
        Insert: {
          id?: string;
          quote_id: string;
          item_order?: number;
          concept: string;
          description?: string | null;
          quantity?: number;
          unit_price?: number;
          discount_percent?: number;
          tax_rate?: number;
          line_total?: number;
        };
        Update: {
          id?: string;
          quote_id?: string;
          item_order?: number;
          concept?: string;
          description?: string | null;
          quantity?: number;
          unit_price?: number;
          discount_percent?: number;
          tax_rate?: number;
          line_total?: number;
        };
        Relationships: [];
      };
      oauth_connections: {
        Row: {
          id: string;
          user_id: string;
          provider: string;
          microsoft_email: string;
          access_token_encrypted: string;
          refresh_token_encrypted: string;
          expires_at: string;
          graph_subscription_id: string | null;
          subscription_expires_at: string | null;
          calendar_subscription_id: string | null;
          calendar_subscription_expires_at: string | null;
          is_auth_invalid: boolean;
          last_auth_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          provider?: string;
          microsoft_email: string;
          access_token_encrypted: string;
          refresh_token_encrypted: string;
          expires_at: string;
          graph_subscription_id?: string | null;
          subscription_expires_at?: string | null;
          calendar_subscription_id?: string | null;
          calendar_subscription_expires_at?: string | null;
          is_auth_invalid?: boolean;
          last_auth_error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          provider?: string;
          microsoft_email?: string;
          access_token_encrypted?: string;
          refresh_token_encrypted?: string;
          expires_at?: string;
          graph_subscription_id?: string | null;
          subscription_expires_at?: string | null;
          calendar_subscription_id?: string | null;
          calendar_subscription_expires_at?: string | null;
          is_auth_invalid?: boolean;
          last_auth_error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      emails: {
        Row: {
          id: string;
          ms_graph_id: string;
          internet_message_id: string | null;
          ms_conversation_id: string | null;
          user_id: string | null;
          contact_id: string;
          deal_id: string | null;
          quote_id: string | null;
          from_email: string;
          to_emails: Json;
          subject: string | null;
          body_preview: string | null;
          direction: EmailDirection;
          has_attachments: boolean;
          sent_at: string;
        };
        Insert: {
          id?: string;
          ms_graph_id: string;
          internet_message_id?: string | null;
          ms_conversation_id?: string | null;
          user_id?: string | null;
          contact_id: string;
          deal_id?: string | null;
          quote_id?: string | null;
          from_email: string;
          to_emails?: Json;
          subject?: string | null;
          body_preview?: string | null;
          direction: EmailDirection;
          has_attachments?: boolean;
          sent_at: string;
        };
        Update: {
          id?: string;
          ms_graph_id?: string;
          internet_message_id?: string | null;
          ms_conversation_id?: string | null;
          user_id?: string | null;
          contact_id?: string;
          deal_id?: string | null;
          quote_id?: string | null;
          from_email?: string;
          to_emails?: Json;
          subject?: string | null;
          body_preview?: string | null;
          direction?: EmailDirection;
          has_attachments?: boolean;
          sent_at?: string;
        };
        Relationships: [];
      };
      calendar_event_links: {
        Row: {
          id: string;
          ms_event_id: string;
          ical_uid: string | null;
          user_id: string;
          deal_id: string | null;
          company_id: string | null;
          contact_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          ms_event_id: string;
          ical_uid?: string | null;
          user_id: string;
          deal_id?: string | null;
          company_id?: string | null;
          contact_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          ms_event_id?: string;
          ical_uid?: string | null;
          user_id?: string;
          deal_id?: string | null;
          company_id?: string | null;
          contact_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      activities: {
        Row: {
          id: string;
          actor_type: ActorType;
          actor_id: string | null;
          entity_type: ActivityEntityType;
          entity_id: string;
          company_id: string | null;
          contact_id: string | null;
          deal_id: string | null;
          event_type: string;
          metadata: Record<string, Json>;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_type: ActorType;
          actor_id?: string | null;
          entity_type: ActivityEntityType;
          entity_id: string;
          company_id?: string | null;
          contact_id?: string | null;
          deal_id?: string | null;
          event_type: string;
          metadata?: Record<string, Json>;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor_type?: ActorType;
          actor_id?: string | null;
          entity_type?: ActivityEntityType;
          entity_id?: string;
          company_id?: string | null;
          contact_id?: string | null;
          deal_id?: string | null;
          event_type?: string;
          metadata?: Record<string, Json>;
          created_at?: string;
        };
        Relationships: [];
      };
      api_keys: {
        Row: {
          id: string;
          name: string;
          key_prefix: string;
          key_hash: string;
          permissions: ApiKeyPermission;
          created_by: string | null;
          last_used_at: string | null;
          is_active: boolean;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          key_prefix: string;
          key_hash: string;
          permissions?: ApiKeyPermission;
          created_by?: string | null;
          last_used_at?: string | null;
          is_active?: boolean;
          revoked_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          key_prefix?: string;
          key_hash?: string;
          permissions?: ApiKeyPermission;
          created_by?: string | null;
          last_used_at?: string | null;
          is_active?: boolean;
          revoked_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      append_custom_field_option: {
        Args: {
          p_field_id: string;
          p_new_option: Json;
        };
        Returns: Database["public"]["Tables"]["custom_field_definitions"]["Row"];
      };
      ingest_new_lead: {
        Args: {
          payload: Json;
        };
        Returns: Json;
      };
      current_user_is_active: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      current_user_role: {
        Args: Record<string, never>;
        Returns: string | null;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

