import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { activeConfig } from '../../tools/config';

export interface SystemRequestOptions extends AxiosRequestConfig {
  mode?: 'desktop' | 'mobile';
  referer?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  autoCookie?: boolean;
}

const DESKTOP_USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
];

const MOBILE_USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
];

function getRandomUserAgent(mode: 'desktop' | 'mobile' = 'desktop'): string {
  const pool = mode === 'mobile' ? MOBILE_USER_AGENTS : DESKTOP_USER_AGENTS;
  return pool[Math.floor(Math.random() * pool.length)];
}

export class CookieStore {
  private store: Map<string, Map<string, string>> = new Map();

  public getDomain(urlStr: string): string {
    try {
      const parsed = new URL(urlStr);
      return parsed.hostname;
    } catch {
      return 'default';
    }
  }

  public saveCookies(urlStr: string, setCookieHeaders?: string[]): void {
    if (!setCookieHeaders || setCookieHeaders.length === 0) return;
    const domain = this.getDomain(urlStr);
    if (!this.store.has(domain)) {
      this.store.set(domain, new Map());
    }
    const domainMap = this.store.get(domain)!;

    for (const header of setCookieHeaders) {
      const firstPart = header.split(';')[0];
      const eqIdx = firstPart.indexOf('=');
      if (eqIdx > 0) {
        const key = firstPart.slice(0, eqIdx).trim();
        const value = firstPart.slice(eqIdx + 1).trim();
        domainMap.set(key, value);
      }
    }
  }

  public getCookieString(urlStr: string): string {
    const domain = this.getDomain(urlStr);
    const domainMap = this.store.get(domain);
    if (!domainMap || domainMap.size === 0) return '';
    return Array.from(domainMap.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  public setCookie(urlStr: string, key: string, value: string): void {
    const domain = this.getDomain(urlStr);
    if (!this.store.has(domain)) {
      this.store.set(domain, new Map());
    }
    this.store.get(domain)!.set(key, value);
  }

  public clear(): void {
    this.store.clear();
  }
}

export const globalCookieStore = new CookieStore();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class SystemHttpClient {
  private cookieStore: CookieStore;

  constructor(cookieStore: CookieStore = globalCookieStore) {
    this.cookieStore = cookieStore;
  }

  public async request(url: string, options: SystemRequestOptions = {}): Promise<AxiosResponse<any>> {
    const mode = options.mode || 'desktop';
    const maxRetries = options.maxRetries ?? 3;
    const baseDelay = options.retryDelayMs ?? 1000;
    const autoCookie = options.autoCookie ?? true;

    let lastError: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const ua = getRandomUserAgent(mode);
      const existingCookie = autoCookie ? this.cookieStore.getCookieString(url) : '';
      
      const customHeaders = options.headers || {};
      const mergedHeaders: Record<string, string> = {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        ...(options.referer ? { 'Referer': options.referer } : {}),
        ...customHeaders,
      };

      if (autoCookie && existingCookie) {
        if (mergedHeaders['Cookie']) {
          mergedHeaders['Cookie'] = `${existingCookie}; ${mergedHeaders['Cookie']}`;
        } else {
          mergedHeaders['Cookie'] = existingCookie;
        }
      }

      const axiosConfig: AxiosRequestConfig = {
        ...options,
        headers: mergedHeaders,
        timeout: options.timeout || 8000,
        maxRedirects: options.maxRedirects ?? 5,
      };

      // Proxy integration
      if (activeConfig.ENABLE_IP_PROXY && activeConfig.STATIC_PROXY_URL) {
        try {
          const parsedProxy = new URL(activeConfig.STATIC_PROXY_URL);
          axiosConfig.proxy = {
            protocol: parsedProxy.protocol.replace(':', ''),
            host: parsedProxy.hostname,
            port: Number(parsedProxy.port || 80),
          };
        } catch {}
      }

      try {
        const response = await axios({ url, ...axiosConfig });

        if (autoCookie && response.headers['set-cookie']) {
          this.cookieStore.saveCookies(url, response.headers['set-cookie']);
        }

        const finalUrl = response.request?.res?.responseUrl || response.config.url || '';
        if (typeof response.data === 'string' && (finalUrl.includes('antispider') || response.data.includes('验证码拦截'))) {
          console.warn(`[SystemHttpClient] Anti-spider detected on attempt ${attempt}/${maxRetries} for ${url}. Retrying with new fingerprint...`);
          if (attempt < maxRetries) {
            await sleep(baseDelay * Math.pow(2, attempt - 1));
            continue;
          }
        }

        return response;
      } catch (err: any) {
        lastError = err;
        console.warn(`[SystemHttpClient] Request failed on attempt ${attempt}/${maxRetries} (${err.message})...`);
        if (attempt < maxRetries) {
          await sleep(baseDelay * Math.pow(2, attempt - 1));
        }
      }
    }

    throw lastError || new Error(`[SystemHttpClient] Request failed after ${maxRetries} retries: ${url}`);
  }

  public async get(url: string, options: SystemRequestOptions = {}): Promise<AxiosResponse<any>> {
    return this.request(url, { ...options, method: 'GET' });
  }

  public async post(url: string, data?: any, options: SystemRequestOptions = {}): Promise<AxiosResponse<any>> {
    return this.request(url, { ...options, method: 'POST', data });
  }

  public async head(url: string, options: SystemRequestOptions = {}): Promise<AxiosResponse<any>> {
    return this.request(url, {
      ...options,
      method: 'HEAD',
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });
  }

  public getCookieStore(): CookieStore {
    return this.cookieStore;
  }
}

export const systemHttpClient = new SystemHttpClient();
export default systemHttpClient;
