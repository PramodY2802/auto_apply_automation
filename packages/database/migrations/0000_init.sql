CREATE TYPE "public"."account_type" AS ENUM('INDIVIDUAL', 'ENTERPRISE');--> statement-breakpoint
CREATE TYPE "public"."ai_config_scope" AS ENUM('PLATFORM', 'ENTERPRISE', 'USER');--> statement-breakpoint
CREATE TYPE "public"."answer_source" AS ENUM('PROFILE', 'SAVED_ANSWER', 'AI', 'USER', 'PREFERENCE');--> statement-breakpoint
CREATE TYPE "public"."application_mode" AS ENUM('MANUAL', 'AUTOMATIC');--> statement-breakpoint
CREATE TYPE "public"."application_source" AS ENUM('INTERNAL', 'EXTERNAL');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('DISCOVERED', 'NOT_APPLIED', 'READY_TO_APPLY', 'IN_PROGRESS', 'PENDING_APPROVAL', 'APPLIED', 'FAILED', 'REJECTED', 'INTERVIEW', 'OFFER', 'WITHDRAWN', 'NEEDS_VERIFICATION', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'AUTO_APPROVED');--> statement-breakpoint
CREATE TYPE "public"."auth_token_type" AS ENUM('EMAIL_VERIFICATION', 'PASSWORD_RESET');--> statement-breakpoint
CREATE TYPE "public"."billing_interval" AS ENUM('MONTHLY', 'ANNUAL');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('CONNECTED', 'DISCONNECTED', 'NEEDS_REAUTH', 'PENDING_USER_ACTION', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."discovery_trigger" AS ENUM('MANUAL', 'SCHEDULED', 'EXTENSION');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY', 'FREELANCE');--> statement-breakpoint
CREATE TYPE "public"."enterprise_role" AS ENUM('ENTERPRISE_ADMIN', 'ENTERPRISE_USER');--> statement-breakpoint
CREATE TYPE "public"."extraction_method" AS ENUM('NATIVE_TEXT', 'OCR', 'DOCX', 'HYBRID');--> statement-breakpoint
CREATE TYPE "public"."extraction_status" AS ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."invoice_kind" AS ENUM('SUBSCRIPTION', 'AI_USAGE');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT', 'OPEN', 'PAID', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('USER', 'PLATFORM_ADMIN', 'SUPER_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('TEXT', 'TEXTAREA', 'YES_NO', 'MULTIPLE_CHOICE', 'DROPDOWN', 'NUMBER', 'FILE', 'EMAIL', 'PHONE', 'URL', 'DATE', 'CHECKBOX');--> statement-breakpoint
CREATE TYPE "public"."resume_status" AS ENUM('UPLOADED', 'PROCESSING', 'EXTRACTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."role_scope" AS ENUM('PLATFORM', 'ENTERPRISE');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."salary_period" AS ENUM('YEAR', 'MONTH', 'HOUR');--> statement-breakpoint
CREATE TYPE "public"."search_frequency" AS ENUM('MANUAL', 'DAILY', 'TWICE_DAILY', 'WEEKLY');--> statement-breakpoint
CREATE TYPE "public"."skill_category" AS ENUM('TECHNICAL', 'SOFT', 'PROGRAMMING_LANGUAGE', 'FRAMEWORK', 'DATABASE', 'CLOUD', 'TOOL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."usage_metric" AS ENUM('SEARCH', 'APPLICATION', 'AI_TOKENS', 'STORAGE_BYTES', 'BROWSER_MINUTES');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'SUSPENDED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."work_mode" AS ENUM('REMOTE', 'HYBRID', 'ONSITE');--> statement-breakpoint
CREATE TABLE "ai_provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "ai_config_scope" NOT NULL,
	"enterprise_id" uuid,
	"user_id" uuid,
	"provider_key" text NOT NULL,
	"encrypted_api_key" text,
	"api_key_last4" text,
	"default_model" text NOT NULL,
	"task_models" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fallback_provider_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"allow_fallback" boolean DEFAULT false NOT NULL,
	"monthly_token_limit" bigint,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"last_health" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_configs_scope_owner" CHECK (("ai_provider_configs"."scope" = 'PLATFORM' and "ai_provider_configs"."enterprise_id" is null and "ai_provider_configs"."user_id" is null) or ("ai_provider_configs"."scope" = 'ENTERPRISE' and "ai_provider_configs"."enterprise_id" is not null and "ai_provider_configs"."user_id" is null) or ("ai_provider_configs"."scope" = 'USER' and "ai_provider_configs"."user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"base_url" text,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"enterprise_id" uuid,
	"config_id" uuid,
	"scope" "ai_config_scope" NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"task" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(14, 6) DEFAULT '0' NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"fallback_from" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"question" text NOT NULL,
	"question_type" "question_type" NOT NULL,
	"intent" text DEFAULT 'CUSTOM' NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"answer" text,
	"source" "answer_source",
	"requires_user_input" boolean DEFAULT false NOT NULL,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"approval_status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"confidence" double precision,
	"reasoning" text,
	"ai_usage_log_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"from_status" "application_status",
	"to_status" "application_status" NOT NULL,
	"reason" text,
	"actor_user_id" uuid,
	"actor_type" text DEFAULT 'USER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"enterprise_id" uuid,
	"job_id" uuid NOT NULL,
	"job_source_id" uuid,
	"platform" text NOT NULL,
	"external_application_id" text,
	"source" "application_source" DEFAULT 'INTERNAL' NOT NULL,
	"mode" "application_mode" DEFAULT 'MANUAL' NOT NULL,
	"status" "application_status" DEFAULT 'READY_TO_APPLY' NOT NULL,
	"resume_id" uuid,
	"cover_letter" text,
	"form_snapshot" jsonb,
	"submitted_at" timestamp with time zone,
	"confirmation" jsonb,
	"last_synced_at" timestamp with time zone,
	"error" jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"enterprise_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"ip" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "auth_token_type" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "browser_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"connection_id" uuid,
	"platform" text NOT NULL,
	"encrypted_state" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_education" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"institution" text,
	"degree" text,
	"field" text,
	"start_date" text,
	"end_date" text,
	"grade" text,
	"source_page" integer,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"company" text,
	"title" text,
	"location" text,
	"start_date" text,
	"end_date" text,
	"is_current" boolean DEFAULT false NOT NULL,
	"description" text,
	"source_page" integer,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"titles" text[] DEFAULT '{}'::text[] NOT NULL,
	"experience_band" text DEFAULT 'CUSTOM' NOT NULL,
	"experience_min_years" double precision,
	"experience_max_years" double precision,
	"locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"work_modes" text[] DEFAULT '{}'::text[] NOT NULL,
	"employment_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"salary_min" double precision,
	"salary_max" double precision,
	"salary_currency" text DEFAULT 'USD' NOT NULL,
	"salary_period" "salary_period" DEFAULT 'YEAR' NOT NULL,
	"industries" text[] DEFAULT '{}'::text[] NOT NULL,
	"preferred_companies" text[] DEFAULT '{}'::text[] NOT NULL,
	"excluded_companies" text[] DEFAULT '{}'::text[] NOT NULL,
	"notice_period_days" integer,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"max_posting_age_days" integer,
	"search_frequency" "search_frequency" DEFAULT 'MANUAL' NOT NULL,
	"platforms" text[] DEFAULT '{}'::text[] NOT NULL,
	"application_mode" "application_mode" DEFAULT 'MANUAL' NOT NULL,
	"auto_apply_min_score" double precision DEFAULT 75 NOT NULL,
	"daily_application_limit" integer DEFAULT 10 NOT NULL,
	"auto_apply_consent_at" timestamp with time zone,
	"answer_preferences" jsonb NOT NULL,
	"next_search_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"enterprise_id" uuid,
	"full_name" text,
	"email" text,
	"phone" text,
	"location" text,
	"headline" text,
	"summary" text,
	"current_title" text,
	"total_experience_months" integer,
	"links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extras" jsonb DEFAULT '{"certifications":[],"projects":[],"achievements":[],"previousTitles":[]}'::jsonb NOT NULL,
	"field_confidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_resume_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"category" "skill_category" DEFAULT 'TECHNICAL' NOT NULL,
	"years" double precision,
	"confidence" double precision,
	"source" text DEFAULT 'USER' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enterprise_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enterprise_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "enterprise_role" DEFAULT 'ENTERPRISE_USER' NOT NULL,
	"team_id" uuid,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enterprise_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enterprise_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "enterprise_role" DEFAULT 'ENTERPRISE_USER' NOT NULL,
	"team_id" uuid,
	"status" "member_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enterprises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "member_status" DEFAULT 'ACTIVE' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"subscription_id" uuid,
	"user_id" uuid,
	"enterprise_id" uuid,
	"kind" "invoice_kind" NOT NULL,
	"status" "invoice_status" DEFAULT 'OPEN' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payment_provider" text DEFAULT 'manual' NOT NULL,
	"provider_invoice_id" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"enterprise_id" uuid,
	"trigger" "discovery_trigger" DEFAULT 'MANUAL' NOT NULL,
	"status" "run_status" DEFAULT 'QUEUED' NOT NULL,
	"platforms" text[] DEFAULT '{}'::text[] NOT NULL,
	"queries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stats" jsonb DEFAULT '{"found":0,"created":0,"duplicates":0,"matched":0,"skipped":0}'::jsonb NOT NULL,
	"logs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"overall_score" double precision NOT NULL,
	"skill_score" double precision NOT NULL,
	"experience_score" double precision NOT NULL,
	"location_score" double precision NOT NULL,
	"preference_score" double precision NOT NULL,
	"salary_score" double precision NOT NULL,
	"matched_skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"missing_skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"explanation" jsonb NOT NULL,
	"disqualified" boolean DEFAULT false NOT NULL,
	"is_new" boolean DEFAULT true NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"saved" boolean DEFAULT false NOT NULL,
	"discovery_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"apply_url" text,
	"raw" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"company" text NOT NULL,
	"normalized_company" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"required_skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"optional_skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"experience_min_years" double precision,
	"experience_max_years" double precision,
	"location" text,
	"city" text,
	"country" text,
	"work_mode" "work_mode",
	"employment_type" "employment_type",
	"salary_min" double precision,
	"salary_max" double precision,
	"salary_currency" text,
	"salary_period" "salary_period",
	"url" text NOT NULL,
	"apply_url" text,
	"posted_at" timestamp with time zone,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channel" text DEFAULT 'IN_APP' NOT NULL,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"price_monthly_cents" integer DEFAULT 0 NOT NULL,
	"price_annual_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"limits" jsonb NOT NULL,
	"features" jsonb NOT NULL,
	"ai_markup_percent" double precision DEFAULT 20 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"status" "connection_status" DEFAULT 'DISCONNECTED' NOT NULL,
	"auth_type" text DEFAULT 'NONE' NOT NULL,
	"encrypted_credentials" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_validated_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resume_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "extraction_status" DEFAULT 'PENDING' NOT NULL,
	"document_type" text,
	"method" "extraction_method",
	"ocr_engine" text,
	"raw_text" text,
	"pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"structured" jsonb,
	"field_confidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_provider" text,
	"ai_model" text,
	"parser" text,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"enterprise_id" uuid,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" "resume_status" DEFAULT 'UPLOADED' NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_key" text NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_role_key_permission_key_pk" PRIMARY KEY("role_key","permission_key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"scope" "role_scope" NOT NULL,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"question" text NOT NULL,
	"intent" text DEFAULT 'CUSTOM' NOT NULL,
	"answer" text NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_token" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"enterprise_id" uuid,
	"plan_id" uuid NOT NULL,
	"status" "subscription_status" DEFAULT 'ACTIVE' NOT NULL,
	"interval" "billing_interval" DEFAULT 'MONTHLY' NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"pending_plan_id" uuid,
	"payment_provider" text DEFAULT 'manual' NOT NULL,
	"provider_subscription_id" text,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_owner" CHECK (("subscriptions"."user_id" is not null) <> ("subscriptions"."enterprise_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enterprise_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid,
	"user_id" uuid,
	"enterprise_id" uuid,
	"metric" "usage_metric" NOT NULL,
	"quantity" bigint NOT NULL,
	"cost_usd" numeric(14, 6) DEFAULT '0' NOT NULL,
	"period_key" text NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"account_type" "account_type" DEFAULT 'INDIVIDUAL' NOT NULL,
	"platform_role" "platform_role" DEFAULT 'USER' NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_lower" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_provider_key_ai_providers_key_fk" FOREIGN KEY ("provider_key") REFERENCES "public"."ai_providers"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_config_id_ai_provider_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."ai_provider_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_answers" ADD CONSTRAINT "application_answers_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_source_id_job_sources_id_fk" FOREIGN KEY ("job_source_id") REFERENCES "public"."job_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_connection_id_platform_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."platform_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_education" ADD CONSTRAINT "candidate_education_profile_id_candidate_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_experiences" ADD CONSTRAINT "candidate_experiences_profile_id_candidate_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_preferences" ADD CONSTRAINT "candidate_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_source_resume_id_resumes_id_fk" FOREIGN KEY ("source_resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_skills" ADD CONSTRAINT "candidate_skills_profile_id_candidate_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_invitations" ADD CONSTRAINT "enterprise_invitations_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_invitations" ADD CONSTRAINT "enterprise_invitations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_invitations" ADD CONSTRAINT "enterprise_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_members" ADD CONSTRAINT "enterprise_members_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_members" ADD CONSTRAINT "enterprise_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_members" ADD CONSTRAINT "enterprise_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprises" ADD CONSTRAINT "enterprises_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_discovery_runs" ADD CONSTRAINT "job_discovery_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_discovery_runs" ADD CONSTRAINT "job_discovery_runs_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_discovery_run_id_job_discovery_runs_id_fk" FOREIGN KEY ("discovery_run_id") REFERENCES "public"."job_discovery_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sources" ADD CONSTRAINT "job_sources_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_connections" ADD CONSTRAINT "platform_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_extractions" ADD CONSTRAINT "resume_extractions_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_extractions" ADD CONSTRAINT "resume_extractions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_key_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."roles"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_answers" ADD CONSTRAINT "saved_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pending_plan_id_plans_id_fk" FOREIGN KEY ("pending_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_configs_scope_idx" ON "ai_provider_configs" USING btree ("scope","enterprise_id","user_id");--> statement-breakpoint
CREATE INDEX "ai_usage_user_idx" ON "ai_usage_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_enterprise_idx" ON "ai_usage_logs" USING btree ("enterprise_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_hash_uq" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "application_answers_field_uq" ON "application_answers" USING btree ("application_id","field_key");--> statement-breakpoint
CREATE INDEX "application_events_app_idx" ON "application_events" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "application_status_history_app_idx" ON "application_status_history" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_user_job_uq" ON "applications" USING btree ("user_id","job_id");--> statement-breakpoint
CREATE INDEX "applications_user_status_idx" ON "applications" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "applications_enterprise_idx" ON "applications" USING btree ("enterprise_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_enterprise_idx" ON "audit_logs" USING btree ("enterprise_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_hash_uq" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_idx" ON "auth_tokens" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "browser_sessions_user_idx" ON "browser_sessions" USING btree ("user_id","platform");--> statement-breakpoint
CREATE INDEX "candidate_education_profile_idx" ON "candidate_education" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "candidate_experiences_profile_idx" ON "candidate_experiences" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_preferences_user_uq" ON "candidate_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "candidate_preferences_next_search_idx" ON "candidate_preferences" USING btree ("next_search_at");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_profiles_user_uq" ON "candidate_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_skills_uq" ON "candidate_skills" USING btree ("profile_id","normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_uq" ON "enterprise_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_enterprise_idx" ON "enterprise_invitations" USING btree ("enterprise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enterprise_members_uq" ON "enterprise_members" USING btree ("enterprise_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enterprise_members_user_uq" ON "enterprise_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enterprises_slug_uq" ON "enterprises" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_uq" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "invoices_user_idx" ON "invoices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invoices_enterprise_idx" ON "invoices" USING btree ("enterprise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_period_uq" ON "invoices" USING btree ("subscription_id","kind","period_start");--> statement-breakpoint
CREATE INDEX "discovery_runs_user_idx" ON "job_discovery_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_matches_user_job_uq" ON "job_matches" USING btree ("user_id","job_id");--> statement-breakpoint
CREATE INDEX "job_matches_user_score_idx" ON "job_matches" USING btree ("user_id","overall_score");--> statement-breakpoint
CREATE UNIQUE INDEX "job_sources_platform_external_uq" ON "job_sources" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "job_sources_job_idx" ON "job_sources" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_fingerprint_uq" ON "jobs" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "jobs_company_idx" ON "jobs" USING btree ("normalized_company");--> statement-breakpoint
CREATE INDEX "jobs_posted_idx" ON "jobs" USING btree ("posted_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_key_uq" ON "plans" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_connections_uq" ON "platform_connections" USING btree ("user_id","platform");--> statement-breakpoint
CREATE INDEX "resume_extractions_resume_idx" ON "resume_extractions" USING btree ("resume_id");--> statement-breakpoint
CREATE INDEX "resume_extractions_user_idx" ON "resume_extractions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "resumes_user_idx" ON "resumes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resumes_user_sha_uq" ON "resumes" USING btree ("user_id","sha256") WHERE "resumes"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_answers_uq" ON "saved_answers" USING btree ("user_id","question_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_enterprise_idx" ON "subscriptions" USING btree ("enterprise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_enterprise_name_uq" ON "teams" USING btree ("enterprise_id","name");--> statement-breakpoint
CREATE INDEX "usage_user_period_idx" ON "usage_records" USING btree ("user_id","period_key","metric");--> statement-breakpoint
CREATE INDEX "usage_enterprise_period_idx" ON "usage_records" USING btree ("enterprise_id","period_key","metric");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_source_uq" ON "usage_records" USING btree ("metric","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");