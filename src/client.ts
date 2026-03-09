import type {
  ClientOptions,
  RequestOptions,
  RequestInterceptor,
  ResponseInterceptor,
  EnhancedResponse,
} from './types.js';
import { HttpError } from './errors.js';

function buildURL(base: string | undefined, path: string, params?: Record<string, string | number | boolean | undefined | null>): string {
  let url = base ? `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}` : path;

  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.set(key, String(value));
      }
    }
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
  }

  return url;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createClient(options: ClientOptions = {}) {
  const { baseURL, headers: defaultHeaders = {}, timeout: defaultTimeout, retry: retryConfig } = options;

  const requestInterceptors: RequestInterceptor[] = [];
  const responseInterceptors: ResponseInterceptor[] = [];

  function onRequest(interceptor: RequestInterceptor): void {
    requestInterceptors.push(interceptor);
  }

  function onResponse(interceptor: ResponseInterceptor): void {
    responseInterceptors.push(interceptor);
  }

  async function request<T>(method: string, path: string, opts?: RequestOptions): Promise<T> {
    const url = buildURL(baseURL, path, opts?.params);
    const headers = new Headers({ ...defaultHeaders, ...opts?.headers });

    let body: BodyInit | undefined;
    if (opts?.body !== undefined) {
      if (typeof opts.body === 'string' || opts.body instanceof FormData || opts.body instanceof Blob) {
        body = opts.body as BodyInit;
      } else {
        body = JSON.stringify(opts.body);
        if (!headers.has('Content-Type')) {
          headers.set('Content-Type', 'application/json');
        }
      }
    }

    let req = new Request(url, { method, headers, body });

    for (const interceptor of requestInterceptors) {
      req = await interceptor(req);
    }

    const maxAttempts = retryConfig?.maxAttempts ?? 1;
    const backoff = retryConfig?.backoff ?? 1000;

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const start = Date.now();

      try {
        const timeout = opts?.timeout ?? defaultTimeout;
        let signal = opts?.signal;

        if (timeout && !signal) {
          signal = AbortSignal.timeout(timeout);
        } else if (timeout && signal) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(new Error('Request timeout')), timeout);
          signal.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            controller.abort(signal!.reason);
          }, { once: true });
          signal = controller.signal;
        }

        const fetchOpts: RequestInit = {
          method: req.method,
          headers: req.headers,
          body: req.body,
          signal,
        };

        const response = await fetch(req.url, fetchOpts);
        const duration = Date.now() - start;

        if (!response.ok) {
          const shouldRetry = retryConfig?.retryOn
            ? Array.isArray(retryConfig.retryOn)
              ? retryConfig.retryOn.includes(response.status)
              : retryConfig.retryOn(response.status)
            : false;

          if (shouldRetry && attempt < maxAttempts) {
            await sleep(backoff * attempt);
            continue;
          }

          let errorBody: unknown;
          try {
            errorBody = await response.json();
          } catch {
            errorBody = await response.text().catch(() => null);
          }

          throw new HttpError(response.status, response.statusText, req.url, errorBody);
        }

        let data: T;
        const contentType = response.headers.get('Content-Type') ?? '';
        if (contentType.includes('application/json')) {
          data = await response.json() as T;
        } else {
          data = await response.text() as unknown as T;
        }

        let enhanced: EnhancedResponse = {
          data,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          url: req.url,
          duration,
        };

        for (const interceptor of responseInterceptors) {
          enhanced = await interceptor(enhanced);
        }

        return enhanced.data as T;
      } catch (error) {
        lastError = error;
        if (error instanceof HttpError) throw error;
        if (attempt < maxAttempts) {
          await sleep(backoff * attempt);
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  }

  return {
    get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
    post: <T>(path: string, opts?: RequestOptions) => request<T>('POST', path, opts),
    put: <T>(path: string, opts?: RequestOptions) => request<T>('PUT', path, opts),
    patch: <T>(path: string, opts?: RequestOptions) => request<T>('PATCH', path, opts),
    delete: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts),
    onRequest,
    onResponse,
  };
}
