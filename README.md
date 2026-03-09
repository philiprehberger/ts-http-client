# @philiprehberger/http-client

Type-safe fetch wrapper with interceptors, retries, and base URL support.

## Installation

```bash
npm install @philiprehberger/http-client
```

## Usage

### Basic

```ts
import { createClient } from '@philiprehberger/http-client';

const api = createClient({
  baseURL: 'https://api.example.com',
  headers: { Authorization: `Bearer ${token}` },
  timeout: 5000,
});

const user = await api.get<User>('/users/1');
const created = await api.post<User>('/users', { body: { name: 'Alice' } });
await api.put<User>('/users/1', { body: { name: 'Bob' } });
await api.patch<User>('/users/1', { body: { name: 'Bob' } });
await api.delete('/users/1');
```

### Query Parameters

```ts
const users = await api.get<User[]>('/users', {
  params: { page: 2, limit: 10, active: true },
});
// GET /users?page=2&limit=10&active=true
```

### Retry

```ts
const api = createClient({
  baseURL: 'https://api.example.com',
  retry: {
    maxAttempts: 3,
    retryOn: [500, 502, 503],  // or a function: (status) => status >= 500
    backoff: 1000,             // ms, multiplied by attempt number
  },
});
```

### Interceptors

```ts
// Request interceptor
api.onRequest((req) => {
  req.headers.set('X-Request-Id', crypto.randomUUID());
  return req;
});

// Response interceptor
api.onResponse((res) => {
  console.log(`${res.url} → ${res.status} (${res.duration}ms)`);
  return res;
});
```

### Timeout

```ts
// Default timeout for all requests
const api = createClient({ timeout: 5000 });

// Per-request override
await api.get('/slow-endpoint', { timeout: 30000 });
```

### Abort Signal

```ts
const controller = new AbortController();
await api.get('/data', { signal: controller.signal });
controller.abort();
```

### Error Handling

```ts
import { HttpError } from '@philiprehberger/http-client';

try {
  await api.get('/not-found');
} catch (error) {
  if (error instanceof HttpError) {
    error.status;     // 404
    error.statusText; // 'Not Found'
    error.url;        // full URL
    error.body;       // parsed response body
  }
}
```

## License

MIT
