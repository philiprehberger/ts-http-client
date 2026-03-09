export class HttpError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly url: string;
  public readonly body: unknown;

  constructor(status: number, statusText: string, url: string, body: unknown) {
    super(`HTTP ${status} ${statusText}: ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.statusText = statusText;
    this.url = url;
    this.body = body;
  }
}
