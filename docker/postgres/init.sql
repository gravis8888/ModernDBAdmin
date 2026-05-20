CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS public.users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.posts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public.users(id),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    published_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth.accounts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public.users(id),
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, external_id)
);

INSERT INTO public.users (id, username, display_name, email, status) VALUES
    (1, 'gravis', 'Gravis', 'gravis@example.com', 'active'),
    (2, 'nova', 'Nova', 'nova@example.com', 'active'),
    (3, 'mio', 'Mio', 'mio@example.com', 'disabled')
ON CONFLICT (id) DO UPDATE
SET
    username = EXCLUDED.username,
    display_name = EXCLUDED.display_name,
    email = EXCLUDED.email,
    status = EXCLUDED.status;

SELECT setval('public.users_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.users), 1));

INSERT INTO public.posts (id, user_id, title, body, status, published_at) VALUES
    (1, 1, 'Welcome to Modern DB Admin', 'This row is seeded for the PostgreSQL browser.', 'published', NOW()),
    (2, 2, 'Unified DB explorer', 'Database and schema clicks now render an overview panel.', 'published', NOW()),
    (3, 1, 'Draft entry', 'Use this row to test inline editing.', 'draft', NULL)
ON CONFLICT (id) DO UPDATE
SET
    user_id = EXCLUDED.user_id,
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    status = EXCLUDED.status,
    published_at = EXCLUDED.published_at;

SELECT setval('public.posts_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.posts), 1));

INSERT INTO auth.accounts (id, user_id, provider, external_id) VALUES
    (1, 1, 'github', 'gravis-gh'),
    (2, 2, 'google', 'nova-google')
ON CONFLICT (id) DO UPDATE
SET
    user_id = EXCLUDED.user_id,
    provider = EXCLUDED.provider,
    external_id = EXCLUDED.external_id;

SELECT setval('auth.accounts_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM auth.accounts), 1));

CREATE OR REPLACE VIEW public.active_users AS
SELECT id, username, display_name, email, created_at
FROM public.users
WHERE status = 'active';

DO
$$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'reader_role') THEN
        CREATE ROLE reader_role;
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'writer_role') THEN
        CREATE ROLE writer_role;
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'reader_user') THEN
        CREATE ROLE reader_user LOGIN PASSWORD 'readerpass';
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'writer_user') THEN
        CREATE ROLE writer_user LOGIN PASSWORD 'writerpass';
    END IF;
END
$$;

GRANT CONNECT ON DATABASE sample_db TO reader_user, writer_user;
GRANT USAGE ON SCHEMA public TO reader_role, writer_role;
GRANT USAGE ON SCHEMA auth TO reader_role, writer_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO reader_role;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO reader_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO writer_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO writer_role;
GRANT reader_role TO reader_user;
GRANT writer_role TO writer_user;
