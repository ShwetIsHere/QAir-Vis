-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.inhaler_triggers (
  user_id uuid NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  aqi integer,
  category text,
  pm25 double precision,
  pm10 double precision,
  temperature double precision,
  humidity double precision,
  wind_speed_180m double precision,
  showers double precision,
  precipitation_next_hour double precision,
  showers_next_hour double precision,
  dew_point_2m double precision,
  surface_pressure double precision,
  pressure_msl double precision,
  notes text,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  timestamp timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT inhaler_triggers_pkey PRIMARY KEY (id),
  CONSTRAINT inhaler_triggers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.user_settings (
  user_id uuid NOT NULL UNIQUE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  notifications_enabled boolean DEFAULT true,
  location_tracking_enabled boolean DEFAULT true,
  dark_mode_enabled boolean DEFAULT false,
  aqi_alert_threshold integer DEFAULT 100,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_settings_pkey PRIMARY KEY (id),
  CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.emergency_contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  is_primary boolean DEFAULT false,
  user_id uuid NOT NULL,
  name text NOT NULL,
  phone_number text NOT NULL,
  relationship text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT emergency_contacts_pkey PRIMARY KEY (id),
  CONSTRAINT emergency_contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.asthma_action_plan (
  user_id uuid NOT NULL UNIQUE,
  green_zone_actions text,
  yellow_zone_actions text,
  red_zone_actions text,
  medications text,
  doctor_name text,
  doctor_phone text,
  hospital_name text,
  hospital_address text,
  allergies text,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT asthma_action_plan_pkey PRIMARY KEY (id),
  CONSTRAINT asthma_action_plan_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.inhaler_count (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  remaining_doses integer NOT NULL DEFAULT 30,
  user_id uuid NOT NULL UNIQUE,
  total_doses integer NOT NULL DEFAULT 30,
  last_reset_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT inhaler_count_pkey PRIMARY KEY (id),
  CONSTRAINT inhaler_count_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);