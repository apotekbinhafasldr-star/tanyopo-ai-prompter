-- LOCAL-ONLY stub of the columns of Supabase auth.users that the B4.2 recipient functions read. Never run against Supabase.
create table if not exists auth.users (
  id uuid primary key, email text, email_confirmed_at timestamptz, banned_until timestamptz, deleted_at timestamptz
);
