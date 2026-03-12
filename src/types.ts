export type AuthConfig = {
  type: 'bearer';
  token: string;
} | {
  type: 'basic';
  username: string;
  password: string;
}

export interface ClientOptions {
  baseURL?: string;
  headers?: Record<string, string>;
  timeout?: number;
  retry?: RetryConfig;
  auth?: AuthConfig;
}

export interface RetryConfig {
  maxAttempts?: number;
  retryOn?: number[] | ((status: number) => boolean);
  backoff?: number;
  backoffStrategy?: 'linear' | 'exponential';
  jitter?: boolean;
  maxBackoff?: number;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  timeout?: number;
  signal?: AbortSignal;
}

export type RequestInterceptor = (request: Request) => Request | Promise<Request>;

export interface EnhancedResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
  url: string;
  duration: number;
}

export type ResponseInterceptor = (response: EnhancedResponse) => EnhancedResponse | Promise<EnhancedResponse>;
