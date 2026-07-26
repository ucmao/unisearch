import { Page, Request } from 'playwright';

/**
 * Signed-API access for Xiaohongshu.
 *
 * Rather than re-implementing the `x-s` / `x-s-common` algorithms (which change
 * whenever the web app ships a new bundle), we borrow the signing function the
 * page has already loaded and clone the header shape of a request the app made
 * itself. Only the signature-derived fields are recomputed per call, so a
 * front-end release changes the captured template instead of breaking us.
 */

const VOLATILE_HEADERS = new Set([
  'x-s',
  'x-t',
  'x-s-common',
  'x-b3-traceid',
  'x-xray-traceid',
  'content-length',
  'cookie',
  'host',
  'accept-encoding',
]);

export interface XhsRequestOptions {
  host: string;
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
}

export class XhsSigner {
  private headerTemplate: Record<string, string> | null = null;
  private searchBodyTemplate: Record<string, any> | null = null;
  private attached = false;

  constructor(private readonly page: Page) {}

  /** Start recording signed requests the web app issues on its own. */
  public attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.page.on('request', (request: Request) => this.captureRequest(request));
  }

  private captureRequest(request: Request): void {
    let headers: Record<string, string>;
    try {
      headers = request.headers();
    } catch {
      return;
    }
    if (!headers['x-s']) return;

    const template: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      const key = name.toLowerCase();
      if (key.startsWith(':') || VOLATILE_HEADERS.has(key)) continue;
      template[key] = value;
    }
    // Keep x-s-common so its decoded payload can be patched instead of guessed.
    if (headers['x-s-common']) template['x-s-common'] = headers['x-s-common'];
    this.headerTemplate = template;

    if (request.method() === 'POST' && request.url().includes('/search/notes')) {
      try {
        const body = request.postDataJSON();
        if (body && typeof body === 'object') this.searchBodyTemplate = body;
      } catch {}
    }
  }

  public hasTemplate(): boolean {
    return this.headerTemplate !== null;
  }

  /** The exact body the web app used for its own search, minus pagination. */
  public getSearchBodyTemplate(): Record<string, any> | null {
    return this.searchBodyTemplate;
  }

  /** Wait until the app has issued at least one signed request. */
  public async waitForTemplate(timeoutMs = 20000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.headerTemplate) return true;
      await this.page.waitForTimeout(200);
    }
    return this.headerTemplate !== null;
  }

  /**
   * Issue a signed API request from inside the page context, so cookies,
   * TLS fingerprint and the signing function all match a real session.
   */
  public async request<T = any>(options: XhsRequestOptions): Promise<T> {
    if (!this.headerTemplate) {
      throw new Error('尚未捕获到小红书签名请求模板');
    }
    const { host, path, method = 'GET', body = null } = options;

    const result = await this.page.evaluate(async (input: any) => {
      const { host, path, method, body, headerTemplate } = input;

      const signer = (window as any)._webmsxyw || (window as any).__webmsxyw;
      if (typeof signer !== 'function') {
        return { ok: false, reason: 'no-signer' };
      }

      // CRC32 variant used by the web app to seal the x-s-common payload.
      const crcTable: number[] = [];
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
      const mrc = (value: string): number => {
        let o = -1;
        for (let i = 0; i < value.length; i++) {
          o = crcTable[(o ^ value.charCodeAt(i)) & 255] ^ (o >>> 8);
        }
        return o ^ -1 ^ 3988292384;
      };
      const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

      let signature: any;
      try {
        signature = signer(path, body);
      } catch (err: any) {
        return { ok: false, reason: `sign-failed: ${err?.message || err}` };
      }
      const xs = signature['X-s'] ?? signature['x-s'] ?? '';
      const xt = String(signature['X-t'] ?? signature['x-t'] ?? '');
      if (!xs) return { ok: false, reason: 'sign-empty' };

      const headers: Record<string, string> = { ...headerTemplate };
      headers['x-s'] = xs;
      headers['x-t'] = xt;
      headers['x-b3-traceid'] = Array.from(crypto.getRandomValues(new Uint8Array(8)))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');

      // Re-seal x-s-common around the fresh signature; keep the captured value
      // verbatim if this build's payload is not the JSON shape we know.
      if (headers['x-s-common']) {
        try {
          const decoded = JSON.parse(decodeURIComponent(escape(atob(headers['x-s-common']))));
          decoded.x6 = xt;
          decoded.x7 = xs;
          decoded.x9 = mrc(String(decoded.x7) + String(decoded.x8 ?? '') + String(decoded.x6));
          if (typeof decoded.x10 === 'number') decoded.x10 += 1;
          headers['x-s-common'] = b64(JSON.stringify(decoded));
        } catch {}
      }

      if (method === 'POST') headers['content-type'] = 'application/json;charset=UTF-8';
      else delete headers['content-type'];

      let response: Response;
      try {
        response = await fetch(`https://${host}${path}`, {
          method,
          credentials: 'include',
          headers,
          body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
        });
      } catch (err: any) {
        return { ok: false, reason: `network: ${err?.message || err}` };
      }

      const text = await response.text();
      let payload: any = null;
      try {
        payload = JSON.parse(text);
      } catch {
        return { ok: false, reason: `http ${response.status}: ${text.slice(0, 160)}` };
      }
      return { ok: true, status: response.status, payload };
    }, { host, path, method, body, headerTemplate: this.headerTemplate });

    if (!result.ok) {
      throw new Error(`小红书签名请求失败 (${path}): ${result.reason}`);
    }
    const payload = result.payload;
    if (payload && payload.success === false) {
      throw new Error(`小红书接口拒绝请求 (${path}): ${payload.msg || payload.code || 'unknown'}`);
    }
    return payload as T;
  }
}
