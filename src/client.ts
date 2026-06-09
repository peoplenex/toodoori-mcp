import type { McpConfig } from './config.js';

/**
 * toodoori API 에러 — 서버의 단일 에러 엔벨로프(C2) `{ success:false, error, code }`를 보존한다.
 * MCP 도구는 이 정보를 그대로 LLM에 전달해 `code`로 자가 교정하게 한다.
 */
export class ToodooriApiError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ToodooriApiError';
  }
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** 쓰기 작업 멱등성 키(C1) */
  idempotencyKey?: string;
}

/**
 * `/api/v1`를 호출하는 얇은 HTTP 클라이언트. 모든 요청에 PAT Bearer를 붙인다(D1: 서버 가드 경유).
 */
export class ToodooriClient {
  constructor(private readonly cfg: McpConfig) {}

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = new URL(this.cfg.apiBase + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  async request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.pat}`,
      Accept: 'application/json',
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

    let res: Response;
    try {
      res = await fetch(this.buildUrl(path, opts.query), {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (err) {
      throw new ToodooriApiError(
        0,
        'NETWORK_ERROR',
        `API 연결 실패(${this.cfg.origin}): ${(err as Error).message}. 서버가 떠 있는지(TOODOORI_API_BASE) 확인하세요.`,
      );
    }

    return this.parse<T>(res, method, path);
  }

  /** 응답 본문을 파싱한다. 에러면 엔벨로프(C2)를 보존해 던지고, 성공이면 { success, data }의 data를 언랩한다. */
  private async parse<T>(res: Response, method: string, path: string): Promise<T> {
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }

    if (!res.ok) {
      const body = (json ?? {}) as { error?: string; code?: string };
      throw new ToodooriApiError(res.status, body.code, body.error || `HTTP ${res.status} (${method} ${path})`);
    }

    // 성공 엔벨로프 { success, data } 면 data를, 아니면 본문 전체를 반환
    const body = json as { success?: boolean; data?: T } | undefined;
    if (body && typeof body === 'object' && 'data' in body) return body.data as T;
    return body as T;
  }

  get<T = unknown>(path: string, query?: RequestOptions['query']) {
    return this.request<T>('GET', path, { query });
  }
  post<T = unknown>(path: string, body?: unknown, opts: Omit<RequestOptions, 'body'> = {}) {
    return this.request<T>('POST', path, { ...opts, body });
  }
  put<T = unknown>(path: string, body?: unknown, opts: Omit<RequestOptions, 'body'> = {}) {
    return this.request<T>('PUT', path, { ...opts, body });
  }
  patch<T = unknown>(path: string, body?: unknown, opts: Omit<RequestOptions, 'body'> = {}) {
    return this.request<T>('PATCH', path, { ...opts, body });
  }
  delete<T = unknown>(path: string, body?: unknown, opts: Omit<RequestOptions, 'body'> = {}) {
    return this.request<T>('DELETE', path, { ...opts, body });
  }

  /**
   * 파일을 multipart/form-data로 업로드한다(첨부 업로드 등).
   * base64 인코딩 없이 raw 바이트를 그대로 전송한다 — 서버 multipart 엔드포인트는 `file` 필드를 기대한다.
   */
  async postFile<T = unknown>(
    path: string,
    file: { bytes: Uint8Array; filename: string; mimeType?: string },
  ): Promise<T> {
    const form = new FormData();
    // Buffer/readFile은 Uint8Array<ArrayBufferLike>라 Blob<ArrayBuffer> 제약과 어긋난다 → ArrayBuffer 기반 뷰로 정규화.
    const blob = new Blob([new Uint8Array(file.bytes)], { type: file.mimeType || 'application/octet-stream' });
    form.append('file', blob, file.filename);

    let res: Response;
    try {
      // Content-Type(boundary 포함)은 fetch가 FormData로부터 자동 설정한다 — 수동 지정 금지.
      res = await fetch(this.buildUrl(path), {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.pat}`, Accept: 'application/json' },
        body: form,
      });
    } catch (err) {
      throw new ToodooriApiError(
        0,
        'NETWORK_ERROR',
        `API 연결 실패(${this.cfg.origin}): ${(err as Error).message}. 서버가 떠 있는지(TOODOORI_API_BASE) 확인하세요.`,
      );
    }
    return this.parse<T>(res, 'POST', path);
  }

  /**
   * 바이너리/파일 응답을 그대로 받는다(JSON 엔벨로프가 아님). 첨부 다운로드 등에 사용.
   */
  async downloadRaw(path: string): Promise<{ contentType: string | null; bytes: Uint8Array }> {
    let res: Response;
    try {
      res = await fetch(this.buildUrl(path), { method: 'GET', headers: { Authorization: `Bearer ${this.cfg.pat}` } });
    } catch (err) {
      throw new ToodooriApiError(0, 'NETWORK_ERROR', `API 연결 실패(${this.cfg.origin}): ${(err as Error).message}`);
    }
    if (!res.ok) {
      const text = await res.text();
      let body: { error?: string; code?: string } = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        /* non-JSON error body */
      }
      throw new ToodooriApiError(res.status, body.code, body.error || `HTTP ${res.status} (GET ${path})`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { contentType: res.headers.get('content-type'), bytes };
  }
}
