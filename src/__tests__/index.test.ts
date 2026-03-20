import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { createClient, HttpError } = await import('../../dist/index.js');

describe('createClient', () => {
  it('returns object with HTTP method functions', () => {
    const client = createClient();
    assert.equal(typeof client.get, 'function');
    assert.equal(typeof client.post, 'function');
    assert.equal(typeof client.put, 'function');
    assert.equal(typeof client.patch, 'function');
    assert.equal(typeof client.delete, 'function');
    assert.equal(typeof client.head, 'function');
    assert.equal(typeof client.options, 'function');
    assert.equal(typeof client.onRequest, 'function');
    assert.equal(typeof client.onResponse, 'function');
  });
});

describe('HttpError', () => {
  it('has correct properties', () => {
    const err = new HttpError(404, 'Not Found', 'https://api.test/users', { msg: 'nope' });
    assert.equal(err.status, 404);
    assert.equal(err.statusText, 'Not Found');
    assert.equal(err.url, 'https://api.test/users');
    assert.deepEqual(err.body, { msg: 'nope' });
    assert.equal(err.name, 'HttpError');
    assert.ok(err.message.includes('404'));
    assert.ok(err.message.includes('Not Found'));
  });

  it('is an instance of Error', () => {
    const err = new HttpError(500, 'Internal Server Error', '/test', null);
    assert.ok(err instanceof Error);
    assert.ok(err instanceof HttpError);
  });

  it('includes URL in message', () => {
    const err = new HttpError(403, 'Forbidden', 'https://api.test/secret', null);
    assert.ok(err.message.includes('https://api.test/secret'));
  });

  it('preserves body with null', () => {
    const err = new HttpError(500, 'Internal Server Error', '/test', null);
    assert.equal(err.body, null);
  });

  it('preserves string body', () => {
    const err = new HttpError(400, 'Bad Request', '/test', 'invalid input');
    assert.equal(err.body, 'invalid input');
  });
});

describe('interceptors', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('onRequest registers without error', () => {
    const client = createClient();
    assert.doesNotThrow(() => {
      client.onRequest((req) => req);
    });
  });

  it('onResponse registers without error', () => {
    const client = createClient();
    assert.doesNotThrow(() => {
      client.onResponse((res) => res);
    });
  });

  it('request interceptor modifies request', async () => {
    let capturedHeaders;
    globalThis.fetch = async (url, opts) => {
      capturedHeaders = opts.headers;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createClient({ baseURL: 'https://api.test' });
    client.onRequest((req) => {
      const newReq = new Request(req, {
        headers: new Headers(req.headers),
      });
      newReq.headers.set('X-Custom', 'test-value');
      return newReq;
    });

    await client.get('/data');
    assert.equal(capturedHeaders.get('X-Custom'), 'test-value');
  });

  it('response interceptor modifies response', async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ value: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createClient({ baseURL: 'https://api.test' });
    client.onResponse((res) => {
      return { ...res, data: { ...res.data, injected: true } };
    });

    const result = await client.get('/data');
    assert.equal(result.value, 1);
    assert.equal(result.injected, true);
  });
});

describe('auth', () => {
  let originalFetch;
  let capturedHeaders;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, opts) => {
      capturedHeaders = opts.headers;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sets bearer token authorization header', async () => {
    const client = createClient({
      baseURL: 'https://api.test',
      auth: { type: 'bearer', token: 'my-secret-token' },
    });

    await client.get('/protected');
    assert.equal(capturedHeaders.get('Authorization'), 'Bearer my-secret-token');
  });

  it('sets basic auth authorization header', async () => {
    const client = createClient({
      baseURL: 'https://api.test',
      auth: { type: 'basic', username: 'user', password: 'pass' },
    });

    await client.get('/protected');
    const expected = 'Basic ' + btoa('user:pass');
    assert.equal(capturedHeaders.get('Authorization'), expected);
  });

  it('does not set authorization header when no auth configured', async () => {
    const client = createClient({ baseURL: 'https://api.test' });

    await client.get('/open');
    assert.equal(capturedHeaders.get('Authorization'), null);
  });
});

describe('retry with exponential backoff', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('retries on configured status codes', async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      if (attempts < 3) {
        return new Response('error', { status: 503, statusText: 'Service Unavailable' });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createClient({
      baseURL: 'https://api.test',
      retry: {
        maxAttempts: 3,
        retryOn: [503],
        backoff: 10,
        backoffStrategy: 'exponential',
      },
    });

    const result = await client.get('/flaky');
    assert.equal(result.success, true);
    assert.equal(attempts, 3);
  });

  it('uses exponential backoff by default', async () => {
    const timestamps = [];
    let attempts = 0;
    globalThis.fetch = async () => {
      timestamps.push(Date.now());
      attempts++;
      if (attempts < 3) {
        return new Response('error', { status: 500, statusText: 'Error' });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createClient({
      baseURL: 'https://api.test',
      retry: {
        maxAttempts: 3,
        retryOn: [500],
        backoff: 50,
      },
    });

    await client.get('/test');
    assert.equal(attempts, 3);

    // Exponential: first delay ~50ms (50*2^0), second delay ~100ms (50*2^1)
    const delay1 = timestamps[1] - timestamps[0];
    const delay2 = timestamps[2] - timestamps[1];
    // Second delay should be roughly double the first (with some tolerance)
    assert.ok(delay2 > delay1 * 1.3, `Second delay (${delay2}ms) should be notably larger than first (${delay1}ms)`);
  });

  it('uses linear backoff when configured', async () => {
    const timestamps = [];
    let attempts = 0;
    globalThis.fetch = async () => {
      timestamps.push(Date.now());
      attempts++;
      if (attempts < 3) {
        return new Response('error', { status: 500, statusText: 'Error' });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createClient({
      baseURL: 'https://api.test',
      retry: {
        maxAttempts: 3,
        retryOn: [500],
        backoff: 50,
        backoffStrategy: 'linear',
      },
    });

    await client.get('/test');
    assert.equal(attempts, 3);
  });

  it('respects maxBackoff cap', async () => {
    const timestamps = [];
    let attempts = 0;
    globalThis.fetch = async () => {
      timestamps.push(Date.now());
      attempts++;
      if (attempts < 3) {
        return new Response('error', { status: 500, statusText: 'Error' });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createClient({
      baseURL: 'https://api.test',
      retry: {
        maxAttempts: 3,
        retryOn: [500],
        backoff: 1000,
        backoffStrategy: 'exponential',
        maxBackoff: 50,
      },
    });

    await client.get('/test');
    assert.equal(attempts, 3);
    // Both delays should be capped at ~50ms
    const delay1 = timestamps[1] - timestamps[0];
    const delay2 = timestamps[2] - timestamps[1];
    assert.ok(delay1 < 200, `First delay (${delay1}ms) should be capped near 50ms`);
    assert.ok(delay2 < 200, `Second delay (${delay2}ms) should be capped near 50ms`);
  });

  it('throws HttpError after exhausting retries', async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      return new Response('error', { status: 503, statusText: 'Service Unavailable' });
    };

    const client = createClient({
      baseURL: 'https://api.test',
      retry: {
        maxAttempts: 2,
        retryOn: [503],
        backoff: 10,
      },
    });

    await assert.rejects(
      () => client.get('/fail'),
      (err) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.status, 503);
        return true;
      },
    );
    assert.equal(attempts, 2);
  });
});

describe('timeout behavior', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('aborts request when timeout expires', async () => {
    globalThis.fetch = async (_url, opts) => {
      return new Promise((_resolve, reject) => {
        const id = setTimeout(() => _resolve(new Response('ok')), 5000);
        opts.signal?.addEventListener('abort', () => {
          clearTimeout(id);
          reject(opts.signal.reason);
        });
      });
    };

    const client = createClient({
      baseURL: 'https://api.test',
      timeout: 50,
    });

    await assert.rejects(() => client.get('/slow'));
  });

  it('succeeds when response comes before timeout', async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ fast: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createClient({
      baseURL: 'https://api.test',
      timeout: 5000,
    });

    const result = await client.get('/fast');
    assert.equal(result.fast, true);
  });

  it('per-request timeout overrides default', async () => {
    globalThis.fetch = async (_url, opts) => {
      return new Promise((_resolve, reject) => {
        const id = setTimeout(() => _resolve(new Response('ok')), 5000);
        opts.signal?.addEventListener('abort', () => {
          clearTimeout(id);
          reject(opts.signal.reason);
        });
      });
    };

    const client = createClient({
      baseURL: 'https://api.test',
      timeout: 10000,
    });

    await assert.rejects(() => client.get('/slow', { timeout: 50 }));
  });
});

describe('error handling', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws HttpError on non-ok response with JSON body', async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        statusText: 'Not Found',
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createClient({ baseURL: 'https://api.test' });

    await assert.rejects(
      () => client.get('/missing'),
      (err) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.status, 404);
        assert.equal(err.statusText, 'Not Found');
        assert.deepEqual(err.body, { error: 'not found' });
        assert.ok(err.url.includes('/missing'));
        return true;
      },
    );
  });

  it('throws HttpError on non-ok response with text body', async () => {
    globalThis.fetch = async () => {
      return new Response('plain error text', {
        status: 400,
        statusText: 'Bad Request',
      });
    };

    const client = createClient({ baseURL: 'https://api.test' });

    await assert.rejects(
      () => client.get('/bad'),
      (err) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.status, 400);
        assert.equal(err.body, 'plain error text');
        return true;
      },
    );
  });

  it('propagates network errors', async () => {
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed');
    };

    const client = createClient({ baseURL: 'https://api.test' });

    await assert.rejects(
      () => client.get('/network-fail'),
      (err) => {
        assert.ok(err instanceof TypeError);
        return true;
      },
    );
  });
});
