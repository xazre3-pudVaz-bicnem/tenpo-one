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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      accounting_periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          id: string
          month: string
          organization_id: string
          reopened_at: string | null
          reopened_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          month: string
          organization_id: string
          reopened_at?: string | null
          reopened_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          month?: string
          organization_id?: string
          reopened_at?: string | null
          reopened_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_periods_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_periods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_periods_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          category: string
          code: string
          created_at: string
          created_by: string | null
          default_tax_treatment: string
          id: string
          is_system: boolean
          name: string
          organization_id: string
          sort_order: number
          status: string
          sub_type: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          created_by?: string | null
          default_tax_treatment?: string
          id?: string
          is_system?: boolean
          name: string
          organization_id: string
          sort_order?: number
          status?: string
          sub_type?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          created_by?: string | null
          default_tax_treatment?: string
          id?: string
          is_system?: boolean
          name?: string
          organization_id?: string
          sort_order?: number
          status?: string
          sub_type?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_rules: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          organization_id: string
          rule_key: string
          store_id: string | null
          threshold: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          organization_id: string
          rule_key: string
          store_id?: string | null
          threshold: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          organization_id?: string
          rule_key?: string
          store_id?: string | null
          threshold?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_rules_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_reads: {
        Row: {
          announcement_id: string
          id: string
          profile_id: string
          read_at: string
        }
        Insert: {
          announcement_id: string
          id?: string
          profile_id: string
          read_at?: string
        }
        Update: {
          announcement_id?: string
          id?: string
          profile_id?: string
          read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_reads_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_reads_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          is_important: boolean
          organization_id: string
          publish_from: string | null
          publish_to: string | null
          store_id: string | null
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_important?: boolean
          organization_id: string
          publish_from?: string | null
          publish_to?: string | null
          store_id?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_important?: boolean
          organization_id?: string
          publish_from?: string | null
          publish_to?: string | null
          store_id?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "announcements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_rules: {
        Row: {
          allow_self_approve: boolean
          approver_role: string
          created_at: string
          created_by: string | null
          id: string
          max_amount: number | null
          min_amount: number
          organization_id: string
          target: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allow_self_approve?: boolean
          approver_role: string
          created_at?: string
          created_by?: string | null
          id?: string
          max_amount?: number | null
          min_amount?: number
          organization_id: string
          target: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allow_self_approve?: boolean
          approver_role?: string
          created_at?: string
          created_by?: string | null
          id?: string
          max_amount?: number | null
          min_amount?: number
          organization_id?: string
          target?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_correction_requests: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          profile_id: string
          reason: string
          requested_changes: Json
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          store_id: string
          time_entry_id: string | null
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          profile_id: string
          reason: string
          requested_changes: Json
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          store_id: string
          time_entry_id?: string | null
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          profile_id?: string
          reason?: string
          requested_changes?: Json
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          store_id?: string
          time_entry_id?: string | null
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_correction_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_correction_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_correction_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_correction_requests_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_correction_requests_time_entry_id_fkey"
            columns: ["time_entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_requests: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          profile_id: string
          reason: string
          request_type: string
          requested_changes: Json
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          store_id: string
          time_entry_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          profile_id: string
          reason: string
          request_type?: string
          requested_changes?: Json
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          store_id: string
          time_entry_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          profile_id?: string
          reason?: string
          request_type?: string
          requested_changes?: Json
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          store_id?: string
          time_entry_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_requests_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_requests_time_entry_id_fkey"
            columns: ["time_entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          id: string
          ip: string | null
          note: string | null
          organization_id: string | null
          store_id: string | null
          target_id: string | null
          target_table: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: string
          ip?: string | null
          note?: string | null
          organization_id?: string | null
          store_id?: string | null
          target_id?: string | null
          target_table?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: string
          ip?: string | null
          note?: string | null
          organization_id?: string | null
          store_id?: string | null
          target_id?: string | null
          target_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account_id: string | null
          account_last4: string | null
          account_type: string
          bank_name: string
          branch_name: string | null
          created_at: string
          created_by: string | null
          holder_name: string | null
          id: string
          organization_id: string
          status: string
          store_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id?: string | null
          account_last4?: string | null
          account_type?: string
          bank_name: string
          branch_name?: string | null
          created_at?: string
          created_by?: string | null
          holder_name?: string | null
          id?: string
          organization_id: string
          status?: string
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string | null
          account_last4?: string | null
          account_type?: string
          bank_name?: string
          branch_name?: string | null
          created_at?: string
          created_by?: string | null
          holder_name?: string | null
          id?: string
          organization_id?: string
          status?: string
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transactions: {
        Row: {
          bank_account_id: string
          created_at: string
          created_by: string | null
          deposit: number
          description: string
          id: string
          import_hash: string | null
          journal_entry_id: string | null
          organization_id: string
          transacted_on: string
          withdrawal: number
        }
        Insert: {
          bank_account_id: string
          created_at?: string
          created_by?: string | null
          deposit?: number
          description: string
          id?: string
          import_hash?: string | null
          journal_entry_id?: string | null
          organization_id: string
          transacted_on: string
          withdrawal?: number
        }
        Update: {
          bank_account_id?: string
          created_at?: string
          created_by?: string | null
          deposit?: number
          description?: string
          id?: string
          import_hash?: string | null
          journal_entry_id?: string | null
          organization_id?: string
          transacted_on?: string
          withdrawal?: number
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_request_logs: {
        Row: {
          created_at: string
          id: string
          ip: string | null
          phone: string | null
          store_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip?: string | null
          phone?: string | null
          store_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip?: string | null
          phone?: string | null
          store_id?: string | null
        }
        Relationships: []
      }
      budgets: {
        Row: {
          avg_spend_target: number | null
          cost_rate_target: number | null
          created_at: string
          created_by: string | null
          guests_target: number | null
          id: string
          labor_rate_target: number | null
          month: string
          note: string | null
          organization_id: string
          profit_target: number | null
          sales_budget: number
          store_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          avg_spend_target?: number | null
          cost_rate_target?: number | null
          created_at?: string
          created_by?: string | null
          guests_target?: number | null
          id?: string
          labor_rate_target?: number | null
          month: string
          note?: string | null
          organization_id: string
          profit_target?: number | null
          sales_budget?: number
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          avg_spend_target?: number | null
          cost_rate_target?: number | null
          created_at?: string
          created_by?: string | null
          guests_target?: number | null
          id?: string
          labor_rate_target?: number | null
          month?: string
          note?: string | null
          organization_id?: string
          profit_target?: number | null
          sales_budget?: number
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budgets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      business_hours: {
        Row: {
          close_time: string | null
          created_at: string
          created_by: string | null
          day_of_week: number
          id: string
          is_closed: boolean
          last_entry_time: string | null
          open_time: string | null
          organization_id: string
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          close_time?: string | null
          created_at?: string
          created_by?: string | null
          day_of_week: number
          id?: string
          is_closed?: boolean
          last_entry_time?: string | null
          open_time?: string | null
          organization_id: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          close_time?: string | null
          created_at?: string
          created_by?: string | null
          day_of_week?: number
          id?: string
          is_closed?: boolean
          last_entry_time?: string | null
          open_time?: string | null
          organization_id?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_hours_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_hours_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_transactions: {
        Row: {
          amount: number
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          business_date: string
          created_at: string
          created_by: string | null
          expense_account_id: string | null
          id: string
          kind: string
          occurred_at: string
          order_id: string | null
          organization_id: string
          purpose: string | null
          receipt_document_id: string | null
          refund_id: string | null
          register_session_id: string | null
          status: string
          store_id: string
          updated_at: string
          updated_by: string | null
          void_reason: string | null
        }
        Insert: {
          amount: number
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          business_date?: string
          created_at?: string
          created_by?: string | null
          expense_account_id?: string | null
          id?: string
          kind: string
          occurred_at?: string
          order_id?: string | null
          organization_id: string
          purpose?: string | null
          receipt_document_id?: string | null
          refund_id?: string | null
          register_session_id?: string | null
          status?: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
          void_reason?: string | null
        }
        Update: {
          amount?: number
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          business_date?: string
          created_at?: string
          created_by?: string | null
          expense_account_id?: string | null
          id?: string
          kind?: string
          occurred_at?: string
          order_id?: string | null
          organization_id?: string
          purpose?: string | null
          receipt_document_id?: string | null
          refund_id?: string | null
          register_session_id?: string | null
          status?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_transactions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_transactions_expense_account_id_fkey"
            columns: ["expense_account_id"]
            isOneToOne: false
            referencedRelation: "expense_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_transactions_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_transactions_register_session_id_fkey"
            columns: ["register_session_id"]
            isOneToOne: false
            referencedRelation: "register_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_transactions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cash_tx_receipt_document"
            columns: ["receipt_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_rules: {
        Row: {
          basis: string
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          fixed_amount: number | null
          id: string
          max_amount: number | null
          method: string
          min_amount: number | null
          name: string
          organization_id: string
          profile_id: string | null
          rate: number | null
          status: string
          store_id: string | null
          target_id: string | null
          target_type: string
          tiers: Json | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          basis?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          fixed_amount?: number | null
          id?: string
          max_amount?: number | null
          method?: string
          min_amount?: number | null
          name: string
          organization_id: string
          profile_id?: string | null
          rate?: number | null
          status?: string
          store_id?: string | null
          target_id?: string | null
          target_type: string
          tiers?: Json | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          basis?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          fixed_amount?: number | null
          id?: string
          max_amount?: number | null
          method?: string
          min_amount?: number | null
          name?: string
          organization_id?: string
          profile_id?: string | null
          rate?: number | null
          status?: string
          store_id?: string | null
          target_id?: string | null
          target_type?: string
          tiers?: Json | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_rules_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_rules_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      consumption_tax_rates: {
        Row: {
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          note: string | null
          rate: number
          treatment: string
          version: string
        }
        Insert: {
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          note?: string | null
          rate: number
          treatment: string
          version: string
        }
        Update: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          note?: string | null
          rate?: number
          treatment?: string
          version?: string
        }
        Relationships: []
      }
      contact_requests: {
        Row: {
          company_name: string | null
          contact_name: string
          created_at: string
          current_tools: string | null
          email: string
          id: string
          message: string | null
          phone: string | null
          source: string
          status: string
          store_count: string | null
          store_name: string | null
        }
        Insert: {
          company_name?: string | null
          contact_name: string
          created_at?: string
          current_tools?: string | null
          email: string
          id?: string
          message?: string | null
          phone?: string | null
          source?: string
          status?: string
          store_count?: string | null
          store_name?: string | null
        }
        Update: {
          company_name?: string | null
          contact_name?: string
          created_at?: string
          current_tools?: string | null
          email?: string
          id?: string
          message?: string | null
          phone?: string | null
          source?: string
          status?: string
          store_count?: string | null
          store_name?: string | null
        }
        Relationships: []
      }
      coupon_redemptions: {
        Row: {
          coupon_id: string
          created_at: string
          customer_id: string | null
          discount_amount: number
          id: string
          order_id: string
          organization_id: string
        }
        Insert: {
          coupon_id: string
          created_at?: string
          customer_id?: string | null
          discount_amount: number
          id?: string
          order_id: string
          organization_id: string
        }
        Update: {
          coupon_id?: string
          created_at?: string
          customer_id?: string | null
          discount_amount?: number
          id?: string
          order_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          ends_at: string | null
          first_visit_only: boolean
          id: string
          kind: string
          max_uses: number | null
          min_total: number
          name: string
          organization_id: string
          per_customer_limit: number | null
          stackable: boolean
          starts_at: string | null
          status: string
          store_id: string | null
          target_category_id: string | null
          target_menu_item_id: string | null
          time_from: string | null
          time_to: string | null
          updated_at: string
          updated_by: string | null
          value: number
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          first_visit_only?: boolean
          id?: string
          kind: string
          max_uses?: number | null
          min_total?: number
          name: string
          organization_id: string
          per_customer_limit?: number | null
          stackable?: boolean
          starts_at?: string | null
          status?: string
          store_id?: string | null
          target_category_id?: string | null
          target_menu_item_id?: string | null
          time_from?: string | null
          time_to?: string | null
          updated_at?: string
          updated_by?: string | null
          value: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          first_visit_only?: boolean
          id?: string
          kind?: string
          max_uses?: number | null
          min_total?: number
          name?: string
          organization_id?: string
          per_customer_limit?: number | null
          stackable?: boolean
          starts_at?: string | null
          status?: string
          store_id?: string | null
          target_category_id?: string | null
          target_menu_item_id?: string | null
          time_from?: string | null
          time_to?: string | null
          updated_at?: string
          updated_by?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "coupons_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupons_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupons_target_category_id_fkey"
            columns: ["target_category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupons_target_menu_item_id_fkey"
            columns: ["target_menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_consents: {
        Row: {
          consent_type: string
          created_at: string
          customer_id: string
          granted: boolean
          granted_at: string | null
          id: string
          organization_id: string
          source: string | null
          updated_at: string
        }
        Insert: {
          consent_type: string
          created_at?: string
          customer_id: string
          granted?: boolean
          granted_at?: string | null
          id?: string
          organization_id: string
          source?: string | null
          updated_at?: string
        }
        Update: {
          consent_type?: string
          created_at?: string
          customer_id?: string
          granted?: boolean
          granted_at?: string | null
          id?: string
          organization_id?: string
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_consents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_consents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_notes: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          organization_id: string
          store_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          organization_id: string
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          organization_id?: string
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_notes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_tag_links: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          tag_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_tag_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_tag_links_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "customer_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_tags: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          allergy_note: string | null
          anniversary_note: string | null
          anonymized_at: string | null
          birthday: string | null
          cancel_count: number
          created_at: string
          created_by: string | null
          dislike_note: string | null
          email: string | null
          first_visit_at: string | null
          gender: string | null
          id: string
          last_visit_at: string | null
          member_no: string | null
          member_rank: string
          name: string
          name_kana: string | null
          no_show_count: number
          organization_id: string
          phone: string | null
          point_balance: number
          postal_code: string | null
          preference_note: string | null
          primary_store_id: string | null
          seat_preference: string | null
          service_note: string | null
          status: string
          total_spent: number
          updated_at: string
          updated_by: string | null
          visit_count: number
        }
        Insert: {
          address?: string | null
          allergy_note?: string | null
          anniversary_note?: string | null
          anonymized_at?: string | null
          birthday?: string | null
          cancel_count?: number
          created_at?: string
          created_by?: string | null
          dislike_note?: string | null
          email?: string | null
          first_visit_at?: string | null
          gender?: string | null
          id?: string
          last_visit_at?: string | null
          member_no?: string | null
          member_rank?: string
          name: string
          name_kana?: string | null
          no_show_count?: number
          organization_id: string
          phone?: string | null
          point_balance?: number
          postal_code?: string | null
          preference_note?: string | null
          primary_store_id?: string | null
          seat_preference?: string | null
          service_note?: string | null
          status?: string
          total_spent?: number
          updated_at?: string
          updated_by?: string | null
          visit_count?: number
        }
        Update: {
          address?: string | null
          allergy_note?: string | null
          anniversary_note?: string | null
          anonymized_at?: string | null
          birthday?: string | null
          cancel_count?: number
          created_at?: string
          created_by?: string | null
          dislike_note?: string | null
          email?: string | null
          first_visit_at?: string | null
          gender?: string | null
          id?: string
          last_visit_at?: string | null
          member_no?: string | null
          member_rank?: string
          name?: string
          name_kana?: string | null
          no_show_count?: number
          organization_id?: string
          phone?: string | null
          point_balance?: number
          postal_code?: string | null
          preference_note?: string | null
          primary_store_id?: string | null
          seat_preference?: string | null
          service_note?: string | null
          status?: string
          total_spent?: number
          updated_at?: string
          updated_by?: string | null
          visit_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_primary_store_id_fkey"
            columns: ["primary_store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_closings: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          business_date: string
          cash_difference: number
          closed_by: string | null
          counted_cash: number | null
          created_at: string
          created_by: string | null
          discount_total: number
          expected_cash: number | null
          guests_count: number
          id: string
          net_sales: number
          note: string | null
          orders_count: number
          organization_id: string
          payment_breakdown: Json
          petty_in_total: number
          petty_out_total: number
          refund_breakdown: Json
          refund_total: number
          register_breakdown: Json
          register_session_id: string | null
          sales_total: number
          sessions_count: number
          status: string
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          business_date: string
          cash_difference?: number
          closed_by?: string | null
          counted_cash?: number | null
          created_at?: string
          created_by?: string | null
          discount_total?: number
          expected_cash?: number | null
          guests_count?: number
          id?: string
          net_sales?: number
          note?: string | null
          orders_count?: number
          organization_id: string
          payment_breakdown?: Json
          petty_in_total?: number
          petty_out_total?: number
          refund_breakdown?: Json
          refund_total?: number
          register_breakdown?: Json
          register_session_id?: string | null
          sales_total?: number
          sessions_count?: number
          status?: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          business_date?: string
          cash_difference?: number
          closed_by?: string | null
          counted_cash?: number | null
          created_at?: string
          created_by?: string | null
          discount_total?: number
          expected_cash?: number | null
          guests_count?: number
          id?: string
          net_sales?: number
          note?: string | null
          orders_count?: number
          organization_id?: string
          payment_breakdown?: Json
          petty_in_total?: number
          petty_out_total?: number
          refund_breakdown?: Json
          refund_total?: number
          register_breakdown?: Json
          register_session_id?: string | null
          sales_total?: number
          sessions_count?: number
          status?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_closings_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_closings_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_closings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_closings_register_session_id_fkey"
            columns: ["register_session_id"]
            isOneToOne: false
            referencedRelation: "register_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_closings_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_reports: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          business_date: string
          comment: string | null
          created_at: string
          created_by: string | null
          id: string
          metrics: Json
          organization_id: string
          status: string
          store_id: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          business_date: string
          comment?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          metrics?: Json
          organization_id: string
          status?: string
          store_id: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          business_date?: string
          comment?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          metrics?: Json
          organization_id?: string
          status?: string
          store_id?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_reports_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reports_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reports_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      document_comments: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          document_id: string
          id: string
          organization_id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          document_id: string
          id?: string
          organization_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          document_id?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_comments_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          amount: number | null
          content_hash: string | null
          created_at: string
          created_by: string | null
          doc_date: string | null
          doc_type: string
          file_name: string
          file_path: string
          id: string
          journal_entry_id: string | null
          memo: string | null
          mime_type: string
          ocr_payload: Json | null
          ocr_status: string
          organization_id: string
          size_bytes: number
          status: string
          store_id: string | null
          tax_amount: number | null
          title: string | null
          updated_at: string
          updated_by: string | null
          vendor_id: string | null
          year_month: string | null
        }
        Insert: {
          amount?: number | null
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          doc_date?: string | null
          doc_type?: string
          file_name: string
          file_path: string
          id?: string
          journal_entry_id?: string | null
          memo?: string | null
          mime_type: string
          ocr_payload?: Json | null
          ocr_status?: string
          organization_id: string
          size_bytes?: number
          status?: string
          store_id?: string | null
          tax_amount?: number | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string | null
          year_month?: string | null
        }
        Update: {
          amount?: number | null
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          doc_date?: string | null
          doc_type?: string
          file_name?: string
          file_path?: string
          id?: string
          journal_entry_id?: string | null
          memo?: string | null
          mime_type?: string
          ocr_payload?: Json | null
          ocr_status?: string
          organization_id?: string
          size_bytes?: number
          status?: string
          store_id?: string | null
          tax_amount?: number | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string | null
          year_month?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_confidential: {
        Row: {
          bank_transfer_info: Json | null
          emergency_contact: Json | null
          employee_id: string
          organization_id: string
          profile_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bank_transfer_info?: Json | null
          emergency_contact?: Json | null
          employee_id: string
          organization_id: string
          profile_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bank_transfer_info?: Json | null
          emergency_contact?: Json | null
          employee_id?: string
          organization_id?: string
          profile_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_confidential_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_confidential_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_insurance: {
        Row: {
          acquired_on: string | null
          care_insurance: boolean
          created_at: string
          created_by: string | null
          employee_id: string
          employment_insurance: boolean
          health_insurance: boolean
          id: string
          lost_on: string | null
          note: string | null
          organization_id: string
          pension: boolean
          region: string | null
          standard_monthly_remuneration: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          acquired_on?: string | null
          care_insurance?: boolean
          created_at?: string
          created_by?: string | null
          employee_id: string
          employment_insurance?: boolean
          health_insurance?: boolean
          id?: string
          lost_on?: string | null
          note?: string | null
          organization_id: string
          pension?: boolean
          region?: string | null
          standard_monthly_remuneration?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          acquired_on?: string | null
          care_insurance?: boolean
          created_at?: string
          created_by?: string | null
          employee_id?: string
          employment_insurance?: boolean
          health_insurance?: boolean
          id?: string
          lost_on?: string | null
          note?: string | null
          organization_id?: string
          pension?: boolean
          region?: string | null
          standard_monthly_remuneration?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_insurance_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_insurance_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          address: string | null
          birth_date: string | null
          created_at: string
          created_by: string | null
          employee_no: string | null
          employment_type: string
          hired_on: string | null
          id: string
          legal_name: string | null
          legal_name_kana: string | null
          note: string | null
          organization_id: string
          position: string | null
          postal_code: string | null
          primary_store_id: string | null
          profile_id: string
          status: string
          terminated_on: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          birth_date?: string | null
          created_at?: string
          created_by?: string | null
          employee_no?: string | null
          employment_type?: string
          hired_on?: string | null
          id?: string
          legal_name?: string | null
          legal_name_kana?: string | null
          note?: string | null
          organization_id: string
          position?: string | null
          postal_code?: string | null
          primary_store_id?: string | null
          profile_id: string
          status?: string
          terminated_on?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          birth_date?: string | null
          created_at?: string
          created_by?: string | null
          employee_no?: string | null
          employment_type?: string
          hired_on?: string | null
          id?: string
          legal_name?: string | null
          legal_name_kana?: string | null
          note?: string | null
          organization_id?: string
          position?: string | null
          postal_code?: string | null
          primary_store_id?: string | null
          profile_id?: string
          status?: string
          terminated_on?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_primary_store_id_fkey"
            columns: ["primary_store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_accounts: {
        Row: {
          account_id: string | null
          code: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          sort_order: number
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          sort_order?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          business_date: string
          cash_transaction_id: string | null
          created_at: string
          created_by: string | null
          expense_account_id: string | null
          id: string
          memo: string | null
          organization_id: string
          paid_via: string
          receipt_document_id: string | null
          status: string
          store_id: string
          tax_amount: number
          updated_at: string
          updated_by: string | null
          vendor_name: string | null
        }
        Insert: {
          amount: number
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          business_date?: string
          cash_transaction_id?: string | null
          created_at?: string
          created_by?: string | null
          expense_account_id?: string | null
          id?: string
          memo?: string | null
          organization_id: string
          paid_via?: string
          receipt_document_id?: string | null
          status?: string
          store_id: string
          tax_amount?: number
          updated_at?: string
          updated_by?: string | null
          vendor_name?: string | null
        }
        Update: {
          amount?: number
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          business_date?: string
          cash_transaction_id?: string | null
          created_at?: string
          created_by?: string | null
          expense_account_id?: string | null
          id?: string
          memo?: string | null
          organization_id?: string
          paid_via?: string
          receipt_document_id?: string | null
          status?: string
          store_id?: string
          tax_amount?: number
          updated_at?: string
          updated_by?: string | null
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_cash_transaction_id_fkey"
            columns: ["cash_transaction_id"]
            isOneToOne: false
            referencedRelation: "cash_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_expense_account_id_fkey"
            columns: ["expense_account_id"]
            isOneToOne: false
            referencedRelation: "expense_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_receipt_document_id_fkey"
            columns: ["receipt_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          flag_key: string
          id: string
          note: string | null
          organization_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          flag_key: string
          id?: string
          note?: string | null
          organization_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          flag_key?: string
          id?: string
          note?: string | null
          organization_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_flags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_assets: {
        Row: {
          acquired_on: string
          acquisition_cost: number
          created_at: string
          created_by: string | null
          depreciation_method: string
          depreciation_rule_version: string | null
          disposed_on: string | null
          id: string
          name: string
          note: string | null
          organization_id: string
          status: string
          store_id: string | null
          updated_at: string
          updated_by: string | null
          useful_life_years: number | null
        }
        Insert: {
          acquired_on: string
          acquisition_cost: number
          created_at?: string
          created_by?: string | null
          depreciation_method?: string
          depreciation_rule_version?: string | null
          disposed_on?: string | null
          id?: string
          name: string
          note?: string | null
          organization_id: string
          status?: string
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
          useful_life_years?: number | null
        }
        Update: {
          acquired_on?: string
          acquisition_cost?: number
          created_at?: string
          created_by?: string | null
          depreciation_method?: string
          depreciation_rule_version?: string | null
          disposed_on?: string | null
          id?: string
          name?: string
          note?: string | null
          organization_id?: string
          status?: string
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
          useful_life_years?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fixed_assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      floors: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          sort_order: number
          status: string
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          sort_order?: number
          status?: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number
          status?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "floors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floors_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          created_at: string
          created_by: string | null
          holiday_date: string
          id: string
          is_temporary: boolean
          name: string | null
          organization_id: string
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          holiday_date: string
          id?: string
          is_temporary?: boolean
          name?: string | null
          organization_id: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          holiday_date?: string
          id?: string
          is_temporary?: boolean
          name?: string | null
          organization_id?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "holidays_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holidays_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          avg_cost: number | null
          category: string | null
          created_at: string
          created_by: string | null
          current_quantity: number
          id: string
          item_kind: string
          last_purchase_cost: number | null
          menu_item_id: string | null
          min_quantity: number | null
          name: string
          optimal_quantity: number | null
          organization_id: string
          purchase_to_stock_factor: number
          purchase_unit: string | null
          reorder_point: number | null
          status: string
          store_id: string
          unit: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          avg_cost?: number | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          current_quantity?: number
          id?: string
          item_kind?: string
          last_purchase_cost?: number | null
          menu_item_id?: string | null
          min_quantity?: number | null
          name: string
          optimal_quantity?: number | null
          organization_id: string
          purchase_to_stock_factor?: number
          purchase_unit?: string | null
          reorder_point?: number | null
          status?: string
          store_id: string
          unit?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          avg_cost?: number | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          current_quantity?: number
          id?: string
          item_kind?: string
          last_purchase_cost?: number | null
          menu_item_id?: string | null
          min_quantity?: number | null
          name?: string
          optimal_quantity?: number | null
          organization_id?: string
          purchase_to_stock_factor?: number
          purchase_unit?: string | null
          reorder_point?: number | null
          status?: string
          store_id?: string
          unit?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          assignee_id: string | null
          created_at: string
          created_by: string | null
          document_id: string | null
          due_date: string | null
          expense_account_id: string | null
          id: string
          invoice_no: string | null
          issue_date: string | null
          note: string | null
          organization_id: string
          paid_at: string | null
          payment_method: string | null
          registration_number: string | null
          status: string
          store_id: string | null
          tax_amount: number
          updated_at: string
          updated_by: string | null
          vendor_id: string | null
          vendor_name: string
        }
        Insert: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          due_date?: string | null
          expense_account_id?: string | null
          id?: string
          invoice_no?: string | null
          issue_date?: string | null
          note?: string | null
          organization_id: string
          paid_at?: string | null
          payment_method?: string | null
          registration_number?: string | null
          status?: string
          store_id?: string | null
          tax_amount?: number
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string | null
          vendor_name: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          due_date?: string | null
          expense_account_id?: string | null
          id?: string
          invoice_no?: string | null
          issue_date?: string | null
          note?: string | null
          organization_id?: string
          paid_at?: string | null
          payment_method?: string | null
          registration_number?: string | null
          status?: string
          store_id?: string | null
          tax_amount?: number
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string | null
          vendor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_expense_account_id_fkey"
            columns: ["expense_account_id"]
            isOneToOne: false
            referencedRelation: "expense_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          correction_of: string | null
          created_at: string
          created_by: string | null
          description: string
          entry_date: string
          entry_no: number
          id: string
          organization_id: string
          posted_at: string | null
          posted_by: string | null
          source_id: string | null
          source_type: string
          status: string
          store_id: string | null
          updated_at: string
          updated_by: string | null
          void_reason: string | null
        }
        Insert: {
          correction_of?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          entry_date: string
          entry_no?: number
          id?: string
          organization_id: string
          posted_at?: string | null
          posted_by?: string | null
          source_id?: string | null
          source_type?: string
          status?: string
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
          void_reason?: string | null
        }
        Update: {
          correction_of?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          entry_date?: string
          entry_no?: number
          id?: string
          organization_id?: string
          posted_at?: string | null
          posted_by?: string | null
          source_id?: string | null
          source_type?: string
          status?: string
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_correction_of_fkey"
            columns: ["correction_of"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entry_lines: {
        Row: {
          account_id: string
          amount: number
          created_at: string
          entry_id: string
          id: string
          line_no: number
          memo: string | null
          organization_id: string
          side: string
          store_id: string | null
          tax_amount: number
          tax_treatment: string
          vendor_id: string | null
        }
        Insert: {
          account_id: string
          amount: number
          created_at?: string
          entry_id: string
          id?: string
          line_no?: number
          memo?: string | null
          organization_id: string
          side: string
          store_id?: string | null
          tax_amount?: number
          tax_treatment?: string
          vendor_id?: string | null
        }
        Update: {
          account_id?: string
          amount?: number
          created_at?: string
          entry_id?: string
          id?: string
          line_no?: number
          memo?: string | null
          organization_id?: string
          side?: string
          store_id?: string | null
          tax_amount?: number
          tax_treatment?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entry_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_grants: {
        Row: {
          created_at: string
          created_by: string | null
          days: number
          expires_on: string
          granted_on: string
          id: string
          note: string | null
          organization_id: string
          profile_id: string
          reason: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          days: number
          expires_on: string
          granted_on: string
          id?: string
          note?: string | null
          organization_id: string
          profile_id: string
          reason?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          days?: number
          expires_on?: string
          granted_on?: string
          id?: string
          note?: string | null
          organization_id?: string
          profile_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_grants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          created_at: string
          fraction: number
          hours: number | null
          id: string
          leave_date: string
          organization_id: string
          profile_id: string
          reason: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          store_id: string
          time_entry_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          fraction?: number
          hours?: number | null
          id?: string
          leave_date: string
          organization_id: string
          profile_id: string
          reason?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          store_id: string
          time_entry_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          fraction?: number
          hours?: number | null
          id?: string
          leave_date?: string
          organization_id?: string
          profile_id?: string
          reason?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          store_id?: string
          time_entry_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_time_entry_id_fkey"
            columns: ["time_entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_rule_versions: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          basis: string | null
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          note: string | null
          parameters: Json
          region: string | null
          reviewed_at: string | null
          reviewed_by_name: string | null
          rule_type: string
          status: string
          updated_at: string
          version: string
          year: number
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          basis?: string | null
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          note?: string | null
          parameters?: Json
          region?: string | null
          reviewed_at?: string | null
          reviewed_by_name?: string | null
          rule_type: string
          status?: string
          updated_at?: string
          version: string
          year: number
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          basis?: string | null
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          note?: string | null
          parameters?: Json
          region?: string | null
          reviewed_at?: string | null
          reviewed_by_name?: string | null
          rule_type?: string
          status?: string
          updated_at?: string
          version?: string
          year?: number
        }
        Relationships: []
      }
      loyalty_settings: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          expiry_months: number | null
          id: string
          organization_id: string
          point_value: number
          updated_at: string
          updated_by: string | null
          yen_per_point: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          expiry_months?: number | null
          id?: string
          organization_id: string
          point_value?: number
          updated_at?: string
          updated_by?: string | null
          yen_per_point?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          expiry_months?: number | null
          id?: string
          organization_id?: string
          point_value?: number
          updated_at?: string
          updated_by?: string | null
          yen_per_point?: number
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      manuals: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          file_path: string | null
          id: string
          note: string | null
          organization_id: string
          status: string
          store_id: string | null
          title: string
          updated_at: string
          updated_by: string | null
          url: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          file_path?: string | null
          id?: string
          note?: string | null
          organization_id: string
          status?: string
          store_id?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
          url?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          file_path?: string | null
          id?: string
          note?: string | null
          organization_id?: string
          status?: string
          store_id?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manuals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manuals_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_stores: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          membership_id: string
          store_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          membership_id: string
          store_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          membership_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_stores_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_stores_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          created_by: string | null
          hourly_note: string | null
          id: string
          organization_id: string
          profile_id: string
          role: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          hourly_note?: string | null
          id?: string
          organization_id: string
          profile_id: string
          role: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          hourly_note?: string | null
          id?: string
          organization_id?: string
          profile_id?: string
          role?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          name_en: string | null
          organization_id: string
          sort_order: number
          station: string
          status: string
          store_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          name_en?: string | null
          organization_id: string
          sort_order?: number
          station?: string
          status?: string
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          name_en?: string | null
          organization_id?: string
          sort_order?: number
          station?: string
          status?: string
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_categories_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_ingredients: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          inventory_item_id: string
          menu_item_id: string
          note: string | null
          organization_id: string
          quantity: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_item_id: string
          menu_item_id: string
          note?: string | null
          organization_id: string
          quantity: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_item_id?: string
          menu_item_id?: string
          note?: string | null
          organization_id?: string
          quantity?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_ingredients_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_ingredients_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_ingredients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_modifiers: {
        Row: {
          id: string
          menu_item_id: string
          modifier_id: string
        }
        Insert: {
          id?: string
          menu_item_id: string
          modifier_id: string
        }
        Update: {
          id?: string
          menu_item_id?: string
          modifier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_modifiers_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_modifiers_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "menu_modifiers"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          allergy_info: string | null
          category_id: string | null
          cost: number | null
          course_includes_ayce: boolean | null
          course_includes_drinks: boolean | null
          course_max_party: number | null
          course_min_party: number | null
          course_notes: string | null
          created_at: string
          created_by: string | null
          description: string | null
          duration_minutes: number | null
          id: string
          image_path: string | null
          imported_at: string | null
          is_recommended: boolean
          is_sold_out: boolean
          item_type: string
          name: string
          name_en: string | null
          name_kana: string | null
          organization_id: string
          price: number
          price_pending: boolean
          sell_end_time: string | null
          sell_start_time: string | null
          sort_order: number
          source: string | null
          source_key: string | null
          source_url: string | null
          status: string
          store_id: string | null
          takeout_price: number | null
          tax_rate_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allergy_info?: string | null
          category_id?: string | null
          cost?: number | null
          course_includes_ayce?: boolean | null
          course_includes_drinks?: boolean | null
          course_max_party?: number | null
          course_min_party?: number | null
          course_notes?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_minutes?: number | null
          id?: string
          image_path?: string | null
          imported_at?: string | null
          is_recommended?: boolean
          is_sold_out?: boolean
          item_type?: string
          name: string
          name_en?: string | null
          name_kana?: string | null
          organization_id: string
          price?: number
          price_pending?: boolean
          sell_end_time?: string | null
          sell_start_time?: string | null
          sort_order?: number
          source?: string | null
          source_key?: string | null
          source_url?: string | null
          status?: string
          store_id?: string | null
          takeout_price?: number | null
          tax_rate_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allergy_info?: string | null
          category_id?: string | null
          cost?: number | null
          course_includes_ayce?: boolean | null
          course_includes_drinks?: boolean | null
          course_max_party?: number | null
          course_min_party?: number | null
          course_notes?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_minutes?: number | null
          id?: string
          image_path?: string | null
          imported_at?: string | null
          is_recommended?: boolean
          is_sold_out?: boolean
          item_type?: string
          name?: string
          name_en?: string | null
          name_kana?: string | null
          organization_id?: string
          price?: number
          price_pending?: boolean
          sell_end_time?: string | null
          sell_start_time?: string | null
          sort_order?: number
          source?: string | null
          source_key?: string | null
          source_url?: string | null
          status?: string
          store_id?: string | null
          takeout_price?: number | null
          tax_rate_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_tax_rate_id_fkey"
            columns: ["tax_rate_id"]
            isOneToOne: false
            referencedRelation: "tax_rates"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_modifiers: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          price: number
          sort_order: number
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          price?: number
          sort_order?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          price?: number
          sort_order?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_modifiers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_variants: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          menu_item_id: string
          name: string
          organization_id: string
          price_diff: number
          sort_order: number
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          menu_item_id: string
          name: string
          organization_id: string
          price_diff?: number
          sort_order?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          menu_item_id?: string
          name?: string
          organization_id?: string
          price_diff?: number
          sort_order?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_variants_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_variants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      nencho_declarations: {
        Row: {
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          data: Json
          id: string
          organization_id: string
          profile_id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string | null
          updated_at: string
          updated_by: string | null
          year: number
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          organization_id: string
          profile_id: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
          updated_by?: string | null
          year: number
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          organization_id?: string
          profile_id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
          updated_by?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "nencho_declarations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nencho_declarations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nencho_declarations_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          body: string
          channel: string
          created_at: string
          error: string | null
          id: string
          organization_id: string
          recipient: string
          reservation_id: string | null
          scheduled_for: string | null
          sent_at: string | null
          status: string
          store_id: string
          subject: string | null
        }
        Insert: {
          body: string
          channel: string
          created_at?: string
          error?: string | null
          id?: string
          organization_id: string
          recipient: string
          reservation_id?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          store_id: string
          subject?: string | null
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          organization_id?: string
          recipient?: string
          reservation_id?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          store_id?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_outbox_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_outbox_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          organization_id: string | null
          read_at: string | null
          recipient_id: string
          store_id: string | null
          title: string
          type: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          organization_id?: string | null
          read_at?: string | null
          recipient_id: string
          store_id?: string | null
          title: string
          type: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          organization_id?: string | null
          read_at?: string | null
          recipient_id?: string
          store_id?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          id: string
          kitchen_ready_at: string | null
          kitchen_started_at: string | null
          kitchen_status: string
          line_total: number
          memo: string | null
          menu_item_id: string | null
          modifiers: Json
          name: string
          order_id: string
          organization_id: string
          quantity: number
          served_at: string | null
          staff_id: string | null
          status: string
          store_id: string
          tax_included: boolean
          tax_rate: number
          unit_price: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kitchen_ready_at?: string | null
          kitchen_started_at?: string | null
          kitchen_status?: string
          line_total?: number
          memo?: string | null
          menu_item_id?: string | null
          modifiers?: Json
          name: string
          order_id: string
          organization_id: string
          quantity?: number
          served_at?: string | null
          staff_id?: string | null
          status?: string
          store_id: string
          tax_included?: boolean
          tax_rate?: number
          unit_price: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kitchen_ready_at?: string | null
          kitchen_started_at?: string | null
          kitchen_status?: string
          line_total?: number
          memo?: string | null
          menu_item_id?: string | null
          modifiers?: Json
          name?: string
          order_id?: string
          organization_id?: string
          quantity?: number
          served_at?: string | null
          staff_id?: string | null
          status?: string
          store_id?: string
          tax_included?: boolean
          tax_rate?: number
          unit_price?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          business_date: string
          closed_at: string | null
          coupon_code: string | null
          coupon_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          discount_reason: string | null
          discount_total: number
          guest_count: number
          id: string
          memo: string | null
          opened_at: string
          order_no: number
          order_source: string
          order_type: string
          organization_id: string
          register_session_id: string | null
          reservation_id: string | null
          rounding_adjustment: number
          service_charge: number
          source_order_id: string | null
          staff_id: string | null
          status: string
          store_id: string
          subtotal: number
          table_id: string | null
          tax_total: number
          total: number
          updated_at: string
          updated_by: string | null
          void_reason: string | null
        }
        Insert: {
          business_date?: string
          closed_at?: string | null
          coupon_code?: string | null
          coupon_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount_reason?: string | null
          discount_total?: number
          guest_count?: number
          id?: string
          memo?: string | null
          opened_at?: string
          order_no?: number
          order_source?: string
          order_type?: string
          organization_id: string
          register_session_id?: string | null
          reservation_id?: string | null
          rounding_adjustment?: number
          service_charge?: number
          source_order_id?: string | null
          staff_id?: string | null
          status?: string
          store_id: string
          subtotal?: number
          table_id?: string | null
          tax_total?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
          void_reason?: string | null
        }
        Update: {
          business_date?: string
          closed_at?: string | null
          coupon_code?: string | null
          coupon_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount_reason?: string | null
          discount_total?: number
          guest_count?: number
          id?: string
          memo?: string | null
          opened_at?: string
          order_no?: number
          order_source?: string
          order_type?: string
          organization_id?: string
          register_session_id?: string | null
          reservation_id?: string | null
          rounding_adjustment?: number
          service_charge?: number
          source_order_id?: string | null
          staff_id?: string | null
          status?: string
          store_id?: string
          subtotal?: number
          table_id?: string | null
          tax_total?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_register_session_id_fkey"
            columns: ["register_session_id"]
            isOneToOne: false
            referencedRelation: "register_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          billing_info: Json
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          id: string
          is_demo: boolean
          kpi_settings: Json
          leave_policy: Json
          logo_path: string | null
          name: string
          name_kana: string | null
          onboarding: Json
          phone: string | null
          plan_code: string
          postal_code: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          billing_info?: Json
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_demo?: boolean
          kpi_settings?: Json
          leave_policy?: Json
          logo_path?: string | null
          name: string
          name_kana?: string | null
          onboarding?: Json
          phone?: string | null
          plan_code?: string
          postal_code?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          billing_info?: Json
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_demo?: boolean
          kpi_settings?: Json
          leave_policy?: Json
          logo_path?: string | null
          name?: string
          name_kana?: string | null
          onboarding?: Json
          phone?: string | null
          plan_code?: string
          postal_code?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      payment_intents: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          currency: string
          customer_id: string | null
          error_message: string | null
          id: string
          idempotency_key: string
          metadata: Json
          order_id: string | null
          organization_id: string
          provider: string
          provider_charge_id: string | null
          provider_checkout_session_id: string | null
          provider_customer_id: string | null
          provider_payment_intent_id: string | null
          purpose: string
          reader_id: string | null
          reservation_id: string | null
          status: string
          store_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string | null
          error_message?: string | null
          id?: string
          idempotency_key: string
          metadata?: Json
          order_id?: string | null
          organization_id: string
          provider?: string
          provider_charge_id?: string | null
          provider_checkout_session_id?: string | null
          provider_customer_id?: string | null
          provider_payment_intent_id?: string | null
          purpose: string
          reader_id?: string | null
          reservation_id?: string | null
          status?: string
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string
          metadata?: Json
          order_id?: string | null
          organization_id?: string
          provider?: string
          provider_charge_id?: string | null
          provider_checkout_session_id?: string | null
          provider_customer_id?: string | null
          provider_payment_intent_id?: string | null
          purpose?: string
          reader_id?: string | null
          reservation_id?: string | null
          status?: string
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_intents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_intents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_intents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_intents_reader_id_fkey"
            columns: ["reader_id"]
            isOneToOne: false
            referencedRelation: "terminal_readers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_intents_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_intents_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_providers: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          mode: string
          organization_id: string
          provider: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          mode?: string
          organization_id: string
          provider: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          mode?: string
          organization_id?: string
          provider?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_providers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          business_date: string
          change_amount: number | null
          created_at: string
          created_by: string | null
          id: string
          method: string
          order_id: string
          organization_id: string
          paid_at: string
          provider: string | null
          provider_charge_id: string | null
          provider_payment_intent_id: string | null
          register_session_id: string | null
          status: string
          store_id: string
          tendered: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          business_date?: string
          change_amount?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          method: string
          order_id: string
          organization_id: string
          paid_at?: string
          provider?: string | null
          provider_charge_id?: string | null
          provider_payment_intent_id?: string | null
          register_session_id?: string | null
          status?: string
          store_id: string
          tendered?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          business_date?: string
          change_amount?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          method?: string
          order_id?: string
          organization_id?: string
          paid_at?: string
          provider?: string | null
          provider_charge_id?: string | null
          provider_payment_intent_id?: string | null
          register_session_id?: string | null
          status?: string
          store_id?: string
          tendered?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_register_session_id_fkey"
            columns: ["register_session_id"]
            isOneToOne: false
            referencedRelation: "register_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_items: {
        Row: {
          allowance_total: number
          base_pay: number
          breakdown: Json
          commission_total: number
          commute_pay: number
          created_at: string
          created_by: string | null
          deduction_total: number
          gross_total: number
          holiday_minutes: number
          holiday_pay: number
          id: string
          night_minutes: number
          night_pay: number
          note: string | null
          organization_id: string
          overtime_minutes: number
          overtime_pay: number
          payroll_run_id: string
          profile_id: string
          store_id: string | null
          updated_at: string
          updated_by: string | null
          work_days: number
          work_minutes: number
        }
        Insert: {
          allowance_total?: number
          base_pay?: number
          breakdown?: Json
          commission_total?: number
          commute_pay?: number
          created_at?: string
          created_by?: string | null
          deduction_total?: number
          gross_total?: number
          holiday_minutes?: number
          holiday_pay?: number
          id?: string
          night_minutes?: number
          night_pay?: number
          note?: string | null
          organization_id: string
          overtime_minutes?: number
          overtime_pay?: number
          payroll_run_id: string
          profile_id: string
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
          work_days?: number
          work_minutes?: number
        }
        Update: {
          allowance_total?: number
          base_pay?: number
          breakdown?: Json
          commission_total?: number
          commute_pay?: number
          created_at?: string
          created_by?: string | null
          deduction_total?: number
          gross_total?: number
          holiday_minutes?: number
          holiday_pay?: number
          id?: string
          night_minutes?: number
          night_pay?: number
          note?: string | null
          organization_id?: string
          overtime_minutes?: number
          overtime_pay?: number
          payroll_run_id?: string
          profile_id?: string
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
          work_days?: number
          work_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_items_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_items_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_rules: {
        Row: {
          allowances: Json
          base_amount: number
          closing_day: number
          commute_allowance: number
          created_at: string
          created_by: string | null
          deductions: Json
          effective_from: string
          effective_to: string | null
          holiday_rate: number
          id: string
          night_rate: number
          organization_id: string
          overtime_rate: number
          pay_type: string
          payment_day: number
          profile_id: string
          status: string
          store_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allowances?: Json
          base_amount?: number
          closing_day?: number
          commute_allowance?: number
          created_at?: string
          created_by?: string | null
          deductions?: Json
          effective_from?: string
          effective_to?: string | null
          holiday_rate?: number
          id?: string
          night_rate?: number
          organization_id: string
          overtime_rate?: number
          pay_type?: string
          payment_day?: number
          profile_id: string
          status?: string
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allowances?: Json
          base_amount?: number
          closing_day?: number
          commute_allowance?: number
          created_at?: string
          created_by?: string | null
          deductions?: Json
          effective_from?: string
          effective_to?: string | null
          holiday_rate?: number
          id?: string
          night_rate?: number
          organization_id?: string
          overtime_rate?: number
          pay_type?: string
          payment_day?: number
          profile_id?: string
          status?: string
          store_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_rules_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_rules_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          organization_id: string
          payment_date: string | null
          period_end: string
          period_start: string
          rule_version: string
          rules_snapshot: Json | null
          run_type: string
          status: string
          store_id: string | null
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          organization_id: string
          payment_date?: string | null
          period_end: string
          period_start: string
          rule_version?: string
          rules_snapshot?: Json | null
          run_type?: string
          status?: string
          store_id?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          organization_id?: string
          payment_date?: string | null
          period_end?: string
          period_start?: string
          rule_version?: string
          rules_snapshot?: Json | null
          run_type?: string
          status?: string
          store_id?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          category: string | null
          code: string
          name: string
        }
        Insert: {
          category?: string | null
          code: string
          name: string
        }
        Update: {
          category?: string | null
          code?: string
          name?: string
        }
        Relationships: []
      }
      petty_cash_counts: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          count_date: string
          counted_amount: number
          created_at: string
          created_by: string | null
          difference: number
          expected_amount: number
          id: string
          note: string | null
          organization_id: string
          status: string
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          count_date: string
          counted_amount: number
          created_at?: string
          created_by?: string | null
          difference: number
          expected_amount: number
          id?: string
          note?: string | null
          organization_id: string
          status?: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          count_date?: string
          counted_amount?: number
          created_at?: string
          created_by?: string | null
          difference?: number
          expected_amount?: number
          id?: string
          note?: string | null
          organization_id?: string
          status?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_counts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_counts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_counts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          code: string
          created_at: string
          description: string | null
          features: Json
          id: string
          is_active: boolean
          monthly_price: number
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          monthly_price?: number
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          monthly_price?: number
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      point_transactions: {
        Row: {
          balance_after: number
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          kind: string
          note: string | null
          order_id: string | null
          organization_id: string
          points: number
          store_id: string | null
        }
        Insert: {
          balance_after: number
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          kind: string
          note?: string | null
          order_id?: string | null
          organization_id: string
          points: number
          store_id?: string | null
        }
        Update: {
          balance_after?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          kind?: string
          note?: string | null
          order_id?: string | null
          organization_id?: string
          points?: number
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "point_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_transactions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      print_jobs: {
        Row: {
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          job_type: string
          order_id: string | null
          organization_id: string
          payload: Json
          printed_at: string | null
          printer_config_id: string | null
          status: string
          store_id: string
          target: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          job_type?: string
          order_id?: string | null
          organization_id: string
          payload?: Json
          printed_at?: string | null
          printer_config_id?: string | null
          status?: string
          store_id: string
          target?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          job_type?: string
          order_id?: string | null
          organization_id?: string
          payload?: Json
          printed_at?: string | null
          printer_config_id?: string | null
          status?: string
          store_id?: string
          target?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_jobs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_printer_config_id_fkey"
            columns: ["printer_config_id"]
            isOneToOne: false
            referencedRelation: "printer_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      printer_configs: {
        Row: {
          auto_print: boolean
          connection_type: string | null
          created_at: string
          created_by: string | null
          drawer_kick: boolean
          id: string
          ip_address: string | null
          is_verified: boolean
          last_connected_at: string | null
          maker: string | null
          model: string | null
          name: string
          organization_id: string
          paper_width_mm: number
          status: string
          store_id: string
          updated_at: string
          updated_by: string | null
          usage: string
        }
        Insert: {
          auto_print?: boolean
          connection_type?: string | null
          created_at?: string
          created_by?: string | null
          drawer_kick?: boolean
          id?: string
          ip_address?: string | null
          is_verified?: boolean
          last_connected_at?: string | null
          maker?: string | null
          model?: string | null
          name: string
          organization_id: string
          paper_width_mm?: number
          status?: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
          usage?: string
        }
        Update: {
          auto_print?: boolean
          connection_type?: string | null
          created_at?: string
          created_by?: string | null
          drawer_kick?: boolean
          id?: string
          ip_address?: string | null
          is_verified?: boolean
          last_connected_at?: string | null
          maker?: string | null
          model?: string | null
          name?: string
          organization_id?: string
          paper_width_mm?: number
          status?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
          usage?: string
        }
        Relationships: [
          {
            foreignKeyName: "printer_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "printer_configs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          display_name_kana: string | null
          has_pin: boolean | null
          id: string
          is_cypress_admin: boolean
          phone: string | null
          pin_code: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          display_name_kana?: string | null
          has_pin?: boolean | null
          id: string
          is_cypress_admin?: boolean
          phone?: string | null
          pin_code?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          display_name_kana?: string | null
          has_pin?: boolean | null
          id?: string
          is_cypress_admin?: boolean
          phone?: string | null
          pin_code?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_order_items: {
        Row: {
          created_at: string
          id: string
          inventory_item_id: string | null
          name: string
          organization_id: string
          purchase_order_id: string
          quantity: number
          received_quantity: number
          tax_rate: number
          unit: string
          unit_cost: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          inventory_item_id?: string | null
          name: string
          organization_id: string
          purchase_order_id: string
          quantity: number
          received_quantity?: number
          tax_rate?: number
          unit?: string
          unit_cost?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          inventory_item_id?: string | null
          name?: string
          organization_id?: string
          purchase_order_id?: string
          quantity?: number
          received_quantity?: number
          tax_rate?: number
          unit?: string
          unit_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          expected_at: string | null
          id: string
          note: string | null
          ordered_at: string | null
          organization_id: string
          po_no: number
          requested_by: string | null
          status: string
          store_id: string
          tax_total: number
          total: number
          updated_at: string
          updated_by: string | null
          vendor_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          expected_at?: string | null
          id?: string
          note?: string | null
          ordered_at?: string | null
          organization_id: string
          po_no?: number
          requested_by?: string | null
          status?: string
          store_id: string
          tax_total?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
          vendor_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          expected_at?: string | null
          id?: string
          note?: string | null
          ordered_at?: string | null
          organization_id?: string
          po_no?: number
          requested_by?: string | null
          status?: string
          store_id?: string
          tax_total?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_items: {
        Row: {
          amount: number
          created_at: string
          id: string
          order_item_id: string
          organization_id: string
          quantity: number
          refund_id: string
          restock: boolean
          store_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          order_item_id: string
          organization_id: string
          quantity: number
          refund_id: string
          restock?: boolean
          store_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          order_item_id?: string
          organization_id?: string
          quantity?: number
          refund_id?: string
          restock?: boolean
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_items_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount: number
          approved_by: string | null
          business_date: string
          created_at: string
          created_by: string | null
          id: string
          journal_entry_id: string | null
          kind: string
          method: string
          order_id: string
          organization_id: string
          payment_id: string | null
          provider: string | null
          provider_refund_id: string | null
          reason: string
          refunded_at: string
          register_session_id: string | null
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          approved_by?: string | null
          business_date?: string
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          kind?: string
          method: string
          order_id: string
          organization_id: string
          payment_id?: string | null
          provider?: string | null
          provider_refund_id?: string | null
          reason: string
          refunded_at?: string
          register_session_id?: string | null
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          approved_by?: string | null
          business_date?: string
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          kind?: string
          method?: string
          order_id?: string
          organization_id?: string
          payment_id?: string | null
          provider?: string | null
          provider_refund_id?: string | null
          reason?: string
          refunded_at?: string
          register_session_id?: string | null
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refunds_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_register_session_id_fkey"
            columns: ["register_session_id"]
            isOneToOne: false
            referencedRelation: "register_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      register_sessions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          business_date: string
          closed_at: string | null
          closed_by: string | null
          counted_cash: number | null
          created_at: string
          created_by: string | null
          difference: number | null
          difference_reason: string | null
          expected_cash: number | null
          id: string
          note: string | null
          opened_at: string
          opened_by: string | null
          opening_float: number
          organization_id: string
          register_id: string
          status: string
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          business_date: string
          closed_at?: string | null
          closed_by?: string | null
          counted_cash?: number | null
          created_at?: string
          created_by?: string | null
          difference?: number | null
          difference_reason?: string | null
          expected_cash?: number | null
          id?: string
          note?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_float?: number
          organization_id: string
          register_id: string
          status?: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          business_date?: string
          closed_at?: string | null
          closed_by?: string | null
          counted_cash?: number | null
          created_at?: string
          created_by?: string | null
          difference?: number | null
          difference_reason?: string | null
          expected_cash?: number | null
          id?: string
          note?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_float?: number
          organization_id?: string
          register_id?: string
          status?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "register_sessions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "register_sessions_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "register_sessions_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "register_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "register_sessions_register_id_fkey"
            columns: ["register_id"]
            isOneToOne: false
            referencedRelation: "registers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "register_sessions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      registers: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          status: string
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          status?: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          status?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_sources: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
          organization_id: string | null
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name: string
          organization_id?: string | null
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
          organization_id?: string | null
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_tables: {
        Row: {
          created_at: string
          id: string
          reservation_id: string
          table_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reservation_id: string
          table_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reservation_id?: string
          table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_tables_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_tables_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          adults: number
          allergy_note: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          children: number
          code: string
          consent_accepted: boolean
          course_id: string | null
          course_posted_at: string | null
          created_at: string
          created_by: string | null
          created_via: string
          customer_id: string | null
          end_at: string
          guest_email: string | null
          guest_name: string
          guest_name_kana: string | null
          guest_phone: string
          id: string
          is_private_hire: boolean
          memo: string | null
          organization_id: string
          party_size: number
          purpose: string | null
          reminder_sent_at: string | null
          request_note: string | null
          reserved_date: string
          seat_type: string | null
          source_id: string | null
          staff_id: string | null
          start_at: string
          status: string
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          adults?: number
          allergy_note?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          children?: number
          code: string
          consent_accepted?: boolean
          course_id?: string | null
          course_posted_at?: string | null
          created_at?: string
          created_by?: string | null
          created_via?: string
          customer_id?: string | null
          end_at: string
          guest_email?: string | null
          guest_name: string
          guest_name_kana?: string | null
          guest_phone: string
          id?: string
          is_private_hire?: boolean
          memo?: string | null
          organization_id: string
          party_size: number
          purpose?: string | null
          reminder_sent_at?: string | null
          request_note?: string | null
          reserved_date: string
          seat_type?: string | null
          source_id?: string | null
          staff_id?: string | null
          start_at: string
          status?: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          adults?: number
          allergy_note?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          children?: number
          code?: string
          consent_accepted?: boolean
          course_id?: string | null
          course_posted_at?: string | null
          created_at?: string
          created_by?: string | null
          created_via?: string
          customer_id?: string | null
          end_at?: string
          guest_email?: string | null
          guest_name?: string
          guest_name_kana?: string | null
          guest_phone?: string
          id?: string
          is_private_hire?: boolean
          memo?: string | null
          organization_id?: string
          party_size?: number
          purpose?: string | null
          reminder_sent_at?: string | null
          request_note?: string | null
          reserved_date?: string
          seat_type?: string | null
          source_id?: string | null
          staff_id?: string | null
          start_at?: string
          status?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "reservation_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_tables: {
        Row: {
          capacity_max: number
          capacity_min: number
          created_at: string
          created_by: string | null
          current_status: string
          floor_id: string | null
          id: string
          is_counter: boolean
          is_private_room: boolean
          name: string
          organization_id: string
          pos_x: number | null
          pos_y: number | null
          qr_token: string | null
          shape: string
          smoking_allowed: boolean
          sort_order: number
          status: string
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          capacity_max?: number
          capacity_min?: number
          created_at?: string
          created_by?: string | null
          current_status?: string
          floor_id?: string | null
          id?: string
          is_counter?: boolean
          is_private_room?: boolean
          name: string
          organization_id: string
          pos_x?: number | null
          pos_y?: number | null
          qr_token?: string | null
          shape?: string
          smoking_allowed?: boolean
          sort_order?: number
          status?: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          capacity_max?: number
          capacity_min?: number
          created_at?: string
          created_by?: string | null
          current_status?: string
          floor_id?: string | null
          id?: string
          is_counter?: boolean
          is_private_room?: boolean
          name?: string
          organization_id?: string
          pos_x?: number | null
          pos_y?: number | null
          qr_token?: string | null
          shape?: string
          smoking_allowed?: boolean
          sort_order?: number
          status?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_tables_floor_id_fkey"
            columns: ["floor_id"]
            isOneToOne: false
            referencedRelation: "floors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_tables_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_tables_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_code: string
          role_code: string
        }
        Insert: {
          permission_code: string
          role_code: string
        }
        Update: {
          permission_code?: string
          role_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "role_permissions_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
        ]
      }
      roles: {
        Row: {
          code: string
          name: string
          scope: string
          sort_order: number
        }
        Insert: {
          code: string
          name: string
          scope: string
          sort_order?: number
        }
        Update: {
          code?: string
          name?: string
          scope?: string
          sort_order?: number
        }
        Relationships: []
      }
      saas_subscriptions: {
        Row: {
          created_at: string
          created_by: string | null
          current_period_end: string | null
          current_period_start: string | null
          id: string
          metadata: Json
          organization_id: string
          plan_code: string
          provider: string
          provider_customer_id: string | null
          provider_subscription_id: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          plan_code?: string
          provider?: string
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          plan_code?: string
          provider?: string
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saas_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_requirements: {
        Row: {
          created_at: string
          created_by: string | null
          day_of_week: number
          id: string
          organization_id: string
          required_count: number
          store_id: string
          time_from: string
          time_to: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          day_of_week: number
          id?: string
          organization_id: string
          required_count?: number
          store_id: string
          time_from: string
          time_to: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          day_of_week?: number
          id?: string
          organization_id?: string
          required_count?: number
          store_id?: string
          time_from?: string
          time_to?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_requirements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_requirements_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          created_at: string
          created_by: string | null
          end_time: string
          id: string
          kind: string
          note: string | null
          organization_id: string
          profile_id: string
          shift_date: string
          start_time: string
          status: string
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_time: string
          id?: string
          kind?: string
          note?: string | null
          organization_id: string
          profile_id: string
          shift_date: string
          start_time: string
          status?: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_time?: string
          id?: string
          kind?: string
          note?: string | null
          organization_id?: string
          profile_id?: string
          shift_date?: string
          start_time?: string
          status?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_count_items: {
        Row: {
          counted_quantity: number | null
          created_at: string
          difference: number | null
          expected_quantity: number
          id: string
          inventory_item_id: string
          stock_count_id: string
          updated_at: string
        }
        Insert: {
          counted_quantity?: number | null
          created_at?: string
          difference?: number | null
          expected_quantity?: number
          id?: string
          inventory_item_id: string
          stock_count_id: string
          updated_at?: string
        }
        Update: {
          counted_quantity?: number | null
          created_at?: string
          difference?: number | null
          expected_quantity?: number
          id?: string
          inventory_item_id?: string
          stock_count_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_count_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_items_stock_count_id_fkey"
            columns: ["stock_count_id"]
            isOneToOne: false
            referencedRelation: "stock_counts"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_counts: {
        Row: {
          count_date: string
          counted_by: string | null
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          organization_id: string
          status: string
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          count_date: string
          counted_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          organization_id: string
          status?: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          count_date?: string
          counted_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          organization_id?: string
          status?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_counts_counted_by_fkey"
            columns: ["counted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          business_date: string
          created_at: string
          created_by: string | null
          id: string
          inventory_item_id: string
          movement_type: string
          occurred_at: string
          organization_id: string
          quantity: number
          reason: string | null
          ref_order_id: string | null
          ref_purchase_order_id: string | null
          ref_stock_count_id: string | null
          store_id: string
          to_store_id: string | null
          transfer_group_id: string | null
          unit_cost: number | null
        }
        Insert: {
          business_date?: string
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_item_id: string
          movement_type: string
          occurred_at?: string
          organization_id: string
          quantity: number
          reason?: string | null
          ref_order_id?: string | null
          ref_purchase_order_id?: string | null
          ref_stock_count_id?: string | null
          store_id: string
          to_store_id?: string | null
          transfer_group_id?: string | null
          unit_cost?: number | null
        }
        Update: {
          business_date?: string
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_item_id?: string
          movement_type?: string
          occurred_at?: string
          organization_id?: string
          quantity?: number
          reason?: string | null
          ref_order_id?: string | null
          ref_purchase_order_id?: string | null
          ref_stock_count_id?: string | null
          store_id?: string
          to_store_id?: string | null
          transfer_group_id?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_stock_movements_count"
            columns: ["ref_stock_count_id"]
            isOneToOne: false
            referencedRelation: "stock_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_ref_order_id_fkey"
            columns: ["ref_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_ref_purchase_order_id_fkey"
            columns: ["ref_purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_to_store_id_fkey"
            columns: ["to_store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfer_items: {
        Row: {
          created_at: string
          id: string
          inventory_item_id: string
          name: string
          quantity: number
          transfer_id: string
          unit: string
        }
        Insert: {
          created_at?: string
          id?: string
          inventory_item_id: string
          name: string
          quantity: number
          transfer_id: string
          unit: string
        }
        Update: {
          created_at?: string
          id?: string
          inventory_item_id?: string
          name?: string
          quantity?: number
          transfer_id?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_items_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          created_at: string
          created_by: string | null
          from_store_id: string
          id: string
          note: string | null
          organization_id: string
          received_at: string | null
          received_by: string | null
          requested_by: string | null
          shipped_at: string | null
          shipped_by: string | null
          status: string
          to_store_id: string
          transfer_no: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_store_id: string
          id?: string
          note?: string | null
          organization_id: string
          received_at?: string | null
          received_by?: string | null
          requested_by?: string | null
          shipped_at?: string | null
          shipped_by?: string | null
          status?: string
          to_store_id: string
          transfer_no?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_store_id?: string
          id?: string
          note?: string | null
          organization_id?: string
          received_at?: string | null
          received_by?: string | null
          requested_by?: string | null
          shipped_at?: string | null
          shipped_by?: string | null
          status?: string
          to_store_id?: string
          transfer_no?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_from_store_id_fkey"
            columns: ["from_store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_shipped_by_fkey"
            columns: ["shipped_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_to_store_id_fkey"
            columns: ["to_store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_hardware: {
        Row: {
          category: string
          connection: string | null
          created_at: string
          created_by: string | null
          id: string
          ip_address: string | null
          model: string | null
          note: string | null
          organization_id: string
          provider: string | null
          status: string
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category: string
          connection?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          ip_address?: string | null
          model?: string | null
          note?: string | null
          organization_id: string
          provider?: string | null
          status?: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          connection?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          ip_address?: string | null
          model?: string | null
          note?: string | null
          organization_id?: string
          provider?: string | null
          status?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_hardware_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_hardware_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_onboarding: {
        Row: {
          checklist: Json
          created_at: string
          created_by: string | null
          enabled_modules: string[]
          environment: string
          go_live_at: string | null
          go_live_by: string | null
          opened_on: string | null
          organization_id: string
          stage: string
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          checklist?: Json
          created_at?: string
          created_by?: string | null
          enabled_modules?: string[]
          environment?: string
          go_live_at?: string | null
          go_live_by?: string | null
          opened_on?: string | null
          organization_id: string
          stage?: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          checklist?: Json
          created_at?: string
          created_by?: string | null
          enabled_modules?: string[]
          environment?: string
          go_live_at?: string | null
          go_live_by?: string | null
          opened_on?: string | null
          organization_id?: string
          stage?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_onboarding_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_onboarding_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_settings: {
        Row: {
          allow_negative_stock: boolean
          attendance_settings: Json
          booking_cutoff_minutes: number
          booking_deposit_amount: number
          booking_notes: string | null
          booking_payment_mode: string
          booking_photo_url: string | null
          booking_window_days: number
          business_day_start_hour: number
          cancel_deadline_hours: number
          cancellation_fee_policy: Json
          cancellation_policy: string | null
          cleaning_buffer_minutes: number
          course_enabled: boolean
          created_at: string
          created_by: string | null
          default_stay_minutes: number
          id: string
          invoice_registration_number: string | null
          kds_settings: Json
          leave_settings: Json
          max_party_size: number
          organization_id: string
          petty_opening_balance: number
          receipt_footer: string | null
          receipt_header: string | null
          reminder_enabled: boolean
          reminder_hours_before: number
          rounding: string
          seat_only_enabled: boolean
          service_charge_rate: number
          settings: Json
          slot_minutes: number
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allow_negative_stock?: boolean
          attendance_settings?: Json
          booking_cutoff_minutes?: number
          booking_deposit_amount?: number
          booking_notes?: string | null
          booking_payment_mode?: string
          booking_photo_url?: string | null
          booking_window_days?: number
          business_day_start_hour?: number
          cancel_deadline_hours?: number
          cancellation_fee_policy?: Json
          cancellation_policy?: string | null
          cleaning_buffer_minutes?: number
          course_enabled?: boolean
          created_at?: string
          created_by?: string | null
          default_stay_minutes?: number
          id?: string
          invoice_registration_number?: string | null
          kds_settings?: Json
          leave_settings?: Json
          max_party_size?: number
          organization_id: string
          petty_opening_balance?: number
          receipt_footer?: string | null
          receipt_header?: string | null
          reminder_enabled?: boolean
          reminder_hours_before?: number
          rounding?: string
          seat_only_enabled?: boolean
          service_charge_rate?: number
          settings?: Json
          slot_minutes?: number
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allow_negative_stock?: boolean
          attendance_settings?: Json
          booking_cutoff_minutes?: number
          booking_deposit_amount?: number
          booking_notes?: string | null
          booking_payment_mode?: string
          booking_photo_url?: string | null
          booking_window_days?: number
          business_day_start_hour?: number
          cancel_deadline_hours?: number
          cancellation_fee_policy?: Json
          cancellation_policy?: string | null
          cleaning_buffer_minutes?: number
          course_enabled?: boolean
          created_at?: string
          created_by?: string | null
          default_stay_minutes?: number
          id?: string
          invoice_registration_number?: string | null
          kds_settings?: Json
          leave_settings?: Json
          max_party_size?: number
          organization_id?: string
          petty_opening_balance?: number
          receipt_footer?: string | null
          receipt_header?: string | null
          reminder_enabled?: boolean
          reminder_hours_before?: number
          rounding?: string
          seat_only_enabled?: boolean
          service_charge_rate?: number
          settings?: Json
          slot_minutes?: number
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_settings_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_tasks: {
        Row: {
          assignee_id: string | null
          body: string | null
          comments: Json
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          organization_id: string
          priority: string
          status: string
          store_id: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assignee_id?: string | null
          body?: string | null
          comments?: Json
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          organization_id: string
          priority?: string
          status?: string
          store_id: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assignee_id?: string | null
          body?: string | null
          comments?: Json
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          organization_id?: string
          priority?: string
          status?: string
          store_id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_tasks_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          address: string | null
          booking_enabled: boolean
          created_at: string
          created_by: string | null
          description: string | null
          email: string | null
          id: string
          name: string
          name_kana: string | null
          organization_id: string
          phone: string | null
          postal_code: string | null
          seat_count: number | null
          slug: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          booking_enabled?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          email?: string | null
          id?: string
          name: string
          name_kana?: string | null
          organization_id: string
          phone?: string | null
          postal_code?: string | null
          seat_count?: number | null
          slug: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          booking_enabled?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          email?: string | null
          id?: string
          name?: string
          name_kana?: string | null
          organization_id?: string
          phone?: string | null
          postal_code?: string | null
          seat_count?: number | null
          slug?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stores_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      system_errors: {
        Row: {
          created_at: string
          detail: Json
          error_id: string
          id: string
          message: string
          organization_id: string | null
          request_id: string | null
          route: string | null
          severity: string
          store_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          detail?: Json
          error_id: string
          id?: string
          message: string
          organization_id?: string | null
          request_id?: string | null
          route?: string | null
          severity?: string
          store_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          detail?: Json
          error_id?: string
          id?: string
          message?: string
          organization_id?: string | null
          request_id?: string | null
          route?: string | null
          severity?: string
          store_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      table_combinations: {
        Row: {
          combined_capacity: number
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          status: string
          store_id: string
          table_ids: string[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          combined_capacity: number
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          status?: string
          store_id: string
          table_ids: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          combined_capacity?: number
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          status?: string
          store_id?: string
          table_ids?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "table_combinations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_combinations_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_rates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_default: boolean
          is_inclusive: boolean
          is_reduced: boolean
          name: string
          organization_id: string
          rate: number
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          is_inclusive?: boolean
          is_reduced?: boolean
          name: string
          organization_id: string
          rate: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          is_inclusive?: boolean
          is_reduced?: boolean
          name?: string
          organization_id?: string
          rate?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tax_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_support_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          organization_id: string
          store_id: string | null
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          organization_id: string
          store_id?: string | null
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          organization_id?: string
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_support_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_support_notes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      terminal_readers: {
        Row: {
          created_at: string
          created_by: string | null
          device_type: string | null
          id: string
          is_simulated: boolean
          label: string
          last_seen_at: string | null
          organization_id: string
          provider: string
          provider_reader_id: string
          status: string
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          device_type?: string | null
          id?: string
          is_simulated?: boolean
          label: string
          last_seen_at?: string | null
          organization_id: string
          provider?: string
          provider_reader_id: string
          status?: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          device_type?: string | null
          id?: string
          is_simulated?: boolean
          label?: string
          last_seen_at?: string | null
          organization_id?: string
          provider?: string
          provider_reader_id?: string
          status?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "terminal_readers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terminal_readers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          break_minutes: number
          clock_in_at: string | null
          clock_out_at: string | null
          created_at: string
          created_by: string | null
          entry_type: string
          id: string
          leave_fraction: number | null
          note: string | null
          on_break: boolean
          organization_id: string
          profile_id: string
          source: string
          status: string
          store_id: string
          updated_at: string
          updated_by: string | null
          work_date: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          break_minutes?: number
          clock_in_at?: string | null
          clock_out_at?: string | null
          created_at?: string
          created_by?: string | null
          entry_type?: string
          id?: string
          leave_fraction?: number | null
          note?: string | null
          on_break?: boolean
          organization_id: string
          profile_id: string
          source?: string
          status?: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
          work_date: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          break_minutes?: number
          clock_in_at?: string | null
          clock_out_at?: string | null
          created_at?: string
          created_by?: string | null
          entry_type?: string
          id?: string
          leave_fraction?: number | null
          note?: string | null
          on_break?: boolean
          organization_id?: string
          profile_id?: string
          source?: string
          status?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entry_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          occurred_at: string
          organization_id: string
          profile_id: string
          source: string
          store_id: string
          time_entry_id: string | null
          via_pin: boolean
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          occurred_at?: string
          organization_id: string
          profile_id: string
          source?: string
          store_id: string
          time_entry_id?: string | null
          via_pin?: boolean
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          occurred_at?: string
          organization_id?: string
          profile_id?: string
          source?: string
          store_id?: string
          time_entry_id?: string | null
          via_pin?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "time_entry_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entry_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entry_events_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entry_events_time_entry_id_fkey"
            columns: ["time_entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          address: string | null
          bank_info: string | null
          closing_day: number | null
          contact_name: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          name: string
          name_kana: string | null
          note: string | null
          organization_id: string
          payment_day: number | null
          phone: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          bank_info?: string | null
          closing_day?: number | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name: string
          name_kana?: string | null
          note?: string | null
          organization_id: string
          payment_day?: number | null
          phone?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          bank_info?: string | null
          closing_day?: number | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name?: string
          name_kana?: string | null
          note?: string | null
          organization_id?: string
          payment_day?: number | null
          phone?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_entries: {
        Row: {
          called_at: string | null
          created_at: string
          created_by: string | null
          desired_date: string
          desired_time_from: string | null
          desired_time_to: string | null
          guest_name: string
          guest_phone: string
          id: string
          note: string | null
          organization_id: string
          party_size: number
          seat_preference: string | null
          seated_at: string | null
          status: string
          store_id: string
          ticket_no: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          called_at?: string | null
          created_at?: string
          created_by?: string | null
          desired_date: string
          desired_time_from?: string | null
          desired_time_to?: string | null
          guest_name: string
          guest_phone: string
          id?: string
          note?: string | null
          organization_id: string
          party_size: number
          seat_preference?: string | null
          seated_at?: string | null
          status?: string
          store_id: string
          ticket_no?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          called_at?: string | null
          created_at?: string
          created_by?: string | null
          desired_date?: string
          desired_time_from?: string | null
          desired_time_to?: string | null
          guest_name?: string
          guest_phone?: string
          id?: string
          note?: string | null
          organization_id?: string
          party_size?: number
          seat_preference?: string | null
          seated_at?: string | null
          status?: string
          store_id?: string
          ticket_no?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          created_at: string
          error: string | null
          event_id: string
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          provider: string
          status: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          event_id: string
          event_type: string
          id?: string
          payload?: Json
          processed_at?: string | null
          provider?: string
          status?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          event_id?: string
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          provider?: string
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      app_business_date: { Args: { p_store_id: string }; Returns: string }
      app_can_view_customer_pii: { Args: { p_org: string }; Returns: boolean }
      app_can_view_payroll: { Args: { p_org: string }; Returns: boolean }
      app_feature_enabled: {
        Args: { p_flag: string; p_org: string }
        Returns: boolean
      }
      app_has_store_access: {
        Args: { p_org: string; p_store: string }
        Returns: boolean
      }
      app_is_cypress_admin: { Args: never; Returns: boolean }
      app_is_org_member: { Args: { p_org: string }; Returns: boolean }
      app_role: { Args: { p_org: string }; Returns: string }
      app_role_in: {
        Args: { p_org: string; p_roles: string[] }
        Returns: boolean
      }
      apply_punch: {
        Args: {
          p_event_type: string
          p_profile_id: string
          p_source?: string
          p_store_id: string
          p_via_pin?: boolean
        }
        Returns: Json
      }
      apply_stock_receipt: {
        Args: {
          p_inventory_item_id: string
          p_purchase_order_id?: string
          p_quantity: number
          p_unit_cost: number
        }
        Returns: undefined
      }
      apply_stock_transfer: {
        Args: {
          p_from_item_id: string
          p_quantity: number
          p_reason?: string
          p_to_store_id: string
        }
        Returns: Json
      }
      cancel_public_reservation: {
        Args: { p_code: string; p_phone: string; p_reason: string }
        Returns: Json
      }
      close_accounting_period: {
        Args: { p_month: string; p_org: string }
        Returns: Json
      }
      close_register_session: {
        Args: {
          p_counted_cash: number
          p_difference_reason?: string
          p_session_id: string
        }
        Returns: Json
      }
      close_store_day: {
        Args: { p_business_date: string; p_store_id: string }
        Returns: Json
      }
      create_public_reservation: {
        Args: {
          p_adults: number
          p_allergy?: string
          p_children: number
          p_consent?: boolean
          p_course_id?: string
          p_date: string
          p_email: string
          p_kana: string
          p_name: string
          p_party: number
          p_phone: string
          p_purpose?: string
          p_request?: string
          p_seat_type?: string
          p_slug: string
          p_source_code?: string
          p_time: string
        }
        Returns: Json
      }
      create_qr_order: {
        Args: { p_items: Json; p_slug: string; p_token: string }
        Returns: Json
      }
      finalize_order: {
        Args: {
          p_order_id: string
          p_payments: Json
          p_register_session_id?: string
        }
        Returns: Json
      }
      generate_reservation_code: { Args: never; Returns: string }
      get_booking_availability: {
        Args: {
          p_course_id?: string
          p_date: string
          p_party: number
          p_slug: string
        }
        Returns: Json
      }
      get_booking_store: { Args: { p_slug: string }; Returns: Json }
      get_public_reservation: {
        Args: { p_code: string; p_phone: string }
        Returns: Json
      }
      get_qr_menu: { Args: { p_slug: string; p_token: string }; Returns: Json }
      get_qr_order_status: {
        Args: { p_slug: string; p_token: string }
        Returns: Json
      }
      get_qr_reserved_course: {
        Args: { p_slug: string; p_token: string }
        Returns: Json
      }
      install_standard_accounts: { Args: { p_org: string }; Returns: number }
      log_audit: {
        Args: {
          p_action: string
          p_after?: Json
          p_before?: Json
          p_note?: string
          p_org: string
          p_store: string
          p_target_id: string
          p_target_table: string
        }
        Returns: string
      }
      log_system_error: {
        Args: {
          p_detail?: Json
          p_error_id: string
          p_message: string
          p_org: string
          p_request_id: string
          p_route: string
          p_severity: string
          p_store: string
        }
        Returns: undefined
      }
      merge_customers: {
        Args: { p_keep_id: string; p_merge_id: string; p_note?: string }
        Returns: Json
      }
      open_register_session: {
        Args: {
          p_opening_float: number
          p_register_id: string
          p_store_id: string
        }
        Returns: Json
      }
      post_journal_entry: { Args: { p_entry_id: string }; Returns: Json }
      recalc_customer_stats: {
        Args: { p_customer_id: string }
        Returns: undefined
      }
      recalc_order_totals: { Args: { p_order_id: string }; Returns: undefined }
      receive_stock_transfer: { Args: { p_transfer_id: string }; Returns: Json }
      refund_order: {
        Args: {
          p_amount: number
          p_items?: Json
          p_kind?: string
          p_method: string
          p_order_id: string
          p_reason: string
          p_register_session_id?: string
        }
        Returns: Json
      }
      reopen_accounting_period: {
        Args: { p_month: string; p_org: string; p_reason: string }
        Returns: Json
      }
      reopen_store_day: {
        Args: { p_business_date: string; p_reason: string; p_store_id: string }
        Returns: Json
      }
      ship_stock_transfer: { Args: { p_transfer_id: string }; Returns: Json }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      void_journal_entry: {
        Args: { p_entry_id: string; p_reason: string }
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
    Enums: {},
  },
} as const
