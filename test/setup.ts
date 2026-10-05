import '@testing-library/jest-dom/vitest';

// In-memory Web Storage fallback for the test environment.
// Node >= 22 ships an experimental global `localStorage` that is present but
// unavailable without --localstorage-file, which shadows happy-dom's own
// implementation (global + window values stay undefined). Provide a minimal
// in-memory polyfill so store/component tests see working storage.
function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => {
      data.clear();
    },
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
  } as Storage;
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  try {
    const current = (globalThis as Record<string, unknown>)[name];
    const broken =
      current == null ||
      typeof (current as Storage).getItem !== 'function' ||
      typeof (current as Storage).setItem !== 'function';
    if (broken) {
      Object.defineProperty(globalThis, name, {
        value: createMemoryStorage(),
        writable: true,
        configurable: true,
      });
    }
  } catch {
    // If the global is non-configurable, fall through to window below.
  }
  try {
    if (typeof window !== 'undefined') {
      const w = window as unknown as Record<string, unknown>;
      const current = w[name];
      if (current == null || typeof (current as Storage).getItem !== 'function') {
        w[name] = (globalThis as Record<string, unknown>)[name] ?? createMemoryStorage();
      }
    }
  } catch {
    // ignore — tests that need storage use the global above
  }
}

// Mock fetch for API routes - tests use localStorage fallback
const originalFetch = global.fetch;
global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('/api/')) {
    // Return 401 immediately so stores fall back to localStorage
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  return originalFetch(input, init);
};
