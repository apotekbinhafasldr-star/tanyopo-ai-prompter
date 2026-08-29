-- Fixes a Supabase linter WARN (function_search_path_mutable) on the
-- trigger function introduced in the previous migration.
create or replace function public.prompter_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
