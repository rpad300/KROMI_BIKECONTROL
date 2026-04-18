import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupaFetchError } from '../supaFetch';

// supaFetch uses import.meta.env which is set at module load time.
// Testing the class and helper logic that doesn't depend on env vars.

describe('SupaFetchError', () => {
  it('creates error with status, body, and url', () => {
    const err = new SupaFetchError(403, '{"message":"forbidden"}', '/rest/v1/bikes');
    expect(err.status).toBe(403);
    expect(err.body).toBe('{"message":"forbidden"}');
    expect(err.name).toBe('SupaFetchError');
    expect(err.message).toContain('403');
    expect(err.message).toContain('/rest/v1/bikes');
  });

  it('truncates long body in message', () => {
    const longBody = 'x'.repeat(500);
    const err = new SupaFetchError(500, longBody, '/test');
    // Message should contain at most 200 chars of body
    expect(err.message.length).toBeLessThan(longBody.length);
    expect(err.body).toBe(longBody); // full body preserved
  });

  it('is an instance of Error', () => {
    const err = new SupaFetchError(404, 'not found', '/test');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('buildSupaHeadersSync', () => {
  beforeEach(() => {
    vi.resetModules();
    // Clean up any global JWT
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).__KROMI_AUTH_JWT__;
  });

  it('returns anon key when no JWT is set', async () => {
    // Mock import.meta.env
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');

    const { buildSupaHeadersSync } = await import('../supaFetch');
    const headers = buildSupaHeadersSync() as Record<string, string>;

    expect(headers['apikey']).toBeDefined();
    expect(headers['Authorization']).toBeDefined();
  });

  it('uses global JWT when available', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__KROMI_AUTH_JWT__ = 'my-kromi-jwt';

    const { buildSupaHeadersSync } = await import('../supaFetch');
    const headers = buildSupaHeadersSync() as Record<string, string>;

    expect(headers['Authorization']).toBe('Bearer my-kromi-jwt');
  });

  it('merges extra headers', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');

    const { buildSupaHeadersSync } = await import('../supaFetch');
    const headers = buildSupaHeadersSync({ Prefer: 'return=representation' }) as Record<string, string>;

    expect(headers['Prefer']).toBe('return=representation');
  });
});
