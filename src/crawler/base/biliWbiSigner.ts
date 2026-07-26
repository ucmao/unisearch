import { createHash } from 'crypto';
import { Page } from 'playwright';

/**
 * WBI-signed API access for Bilibili.
 *
 * Unlike Xiaohongshu (see `xhsSigner`), Bilibili's signature is a documented,
 * stable construction: two keys published by the `nav` endpoint are interleaved
 * through a fixed permutation table to form a `mixin_key`, and every request
 * carries `wts` plus an MD5 of the sorted query string. So we compute it
 * ourselves instead of borrowing a function off the page.
 *
 * The signature alone is not enough, though — unsigned-but-valid requests still
 * come back as an empty `{ v_voucher }` shell, or `-403`, unless they carry the
 * browser's cookies (`buvid3`, `bili_ticket`, login state). We therefore sign in
 * Node and dispatch through `page.evaluate` so the request inherits the session
 * the crawler has already established.
 */

/** Byte order used to weave img_key + sub_key into the mixin key. */
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 20, 20, 47, 51, 45, 51, 40, 26, 22, 12, 15, 11, 22, 47, 22, 25, 42, 23, 27, 33,
  36, 27, 44, 39, 30, 15, 55, 4, 42, 40, 47, 33, 5, 24, 30, 25, 61, 20, 6, 21, 43, 62, 33, 42,
  17, 26, 20, 15, 47, 60, 3, 42, 62, 27, 55, 61, 3, 39, 30, 3, 41, 39, 54, 41, 25, 12, 4, 33, 7,
  16, 62, 34, 3, 51, 62, 55, 44, 55, 4, 61, 61, 21, 42, 22, 32, 42, 55, 25, 26, 62, 30, 34, 3,
];

/** Characters Bilibili strips from values before signing. */
const FILTERED_CHARS = /[!'()*]/g;

/** Keys are rotated daily; re-read them well before that to avoid a stale-key 403. */
const KEY_TTL_MS = 60 * 60 * 1000;

export interface WbiParams {
  [key: string]: string | number | undefined;
}

export class BiliWbiSigner {
  private mixinKey: string | null = null;
  private fetchedAt = 0;

  constructor(private readonly page: Page) {}

  /** Drop the cached key so the next call re-reads `nav` (used after a -403). */
  public invalidate(): void {
    this.mixinKey = null;
    this.fetchedAt = 0;
  }

  private async resolveMixinKey(): Promise<string> {
    if (this.mixinKey && Date.now() - this.fetchedAt < KEY_TTL_MS) return this.mixinKey;

    const nav = await this.request('https://api.bilibili.com/x/web-interface/nav');
    // `nav` reports -101 when logged out but still publishes usable wbi keys.
    const imgUrl = nav?.data?.wbi_img?.img_url || '';
    const subUrl = nav?.data?.wbi_img?.sub_url || '';
    const imgKey = this.keyFromUrl(imgUrl);
    const subKey = this.keyFromUrl(subUrl);
    if (!imgKey || !subKey) {
      throw new Error(`nav 未返回 wbi 密钥 (code ${nav?.code ?? 'unknown'})`);
    }

    const raw = imgKey + subKey;
    this.mixinKey = MIXIN_KEY_ENC_TAB.map((index) => raw[index]).join('').slice(0, 32);
    this.fetchedAt = Date.now();
    return this.mixinKey;
  }

  private keyFromUrl(url: string): string {
    return url.split('/').pop()?.split('.')[0] || '';
  }

  /** Build the signed query string for `params` (adds `wts` and `w_rid`). */
  public async signQuery(params: WbiParams): Promise<string> {
    const mixinKey = await this.resolveMixinKey();
    const signed: WbiParams = { ...params, wts: Math.round(Date.now() / 1000) };

    const query = Object.keys(signed)
      .filter((key) => signed[key] !== undefined && signed[key] !== '')
      .sort()
      .map((key) => {
        const value = String(signed[key]).replace(FILTERED_CHARS, '');
        return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
      })
      .join('&');

    const wRid = createHash('md5').update(query + mixinKey).digest('hex');
    return `${query}&w_rid=${wRid}`;
  }

  /** Issue a raw GET from the page context so session cookies ride along. */
  private async request(url: string): Promise<any> {
    return this.page.evaluate(async (target) => {
      const response = await fetch(target, { credentials: 'include' });
      return response.json();
    }, url);
  }

  /**
   * Sign `params`, call `endpoint`, and return `data`.
   *
   * Throws on anything that is not a usable payload — a non-zero `code`, or the
   * `v_voucher` risk-control shell that Bilibili returns with `code: 0` when it
   * wants a captcha. Callers are expected to fall back to browser scraping.
   */
  public async get(endpoint: string, params: WbiParams): Promise<any> {
    const result = await this.request(`${endpoint}?${await this.signQuery(params)}`);

    if (!result || result.code !== 0) {
      if (result?.code === -403) this.invalidate();
      throw new Error(`${endpoint} 返回 code ${result?.code ?? 'unknown'}: ${result?.message || '无响应'}`);
    }
    if (result.data?.v_voucher && !result.data.result && !result.data.list) {
      throw new Error(`${endpoint} 触发风控校验 (v_voucher)，需要有效登录态`);
    }
    return result.data;
  }
}
