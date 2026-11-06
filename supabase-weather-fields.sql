-- Add environmental measurements to existing trigger rows.
ALTER TABLE public.inhaler_triggers
  ADD COLUMN IF NOT EXISTS wind_speed_180m double precision,
  ADD COLUMN IF NOT EXISTS showers double precision,
  ADD COLUMN IF NOT EXISTS precipitation_next_hour double precision,
  ADD COLUMN IF NOT EXISTS showers_next_hour double precision,
  ADD COLUMN IF NOT EXISTS dew_point_2m double precision,
  ADD COLUMN IF NOT EXISTS surface_pressure double precision,
  ADD COLUMN IF NOT EXISTS pressure_msl double precision;
