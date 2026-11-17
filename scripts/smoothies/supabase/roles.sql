-- Supabase's PostgreSQL image provides the roles; set their installation
-- password from the generated container environment on the first init only.
\getenv pgpass POSTGRES_PASSWORD
alter role authenticator with password :'pgpass';
alter role supabase_auth_admin with password :'pgpass';
alter role supabase_storage_admin with password :'pgpass';
