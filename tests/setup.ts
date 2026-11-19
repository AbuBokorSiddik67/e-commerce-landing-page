process.env.DATABASE_URL ??= "postgresql://landiq:landiq_dev_password@127.0.0.1:55432/landiq_test?schema=public";
process.env.NEXT_PUBLIC_SITE_URL ??= "http://localhost:3000";
process.env.CREDENTIALS_ENCRYPTION_KEY ??= "test-only-encryption-key-at-least-16-bytes";
