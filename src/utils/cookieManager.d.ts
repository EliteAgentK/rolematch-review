/**
 * TypeScript declarations for CookieManager utility
 */

export const COOKIE_CATEGORIES: {
  ESSENTIAL: string;
  FUNCTIONAL: string;
  ANALYTICS: string;
  MARKETING: string;
};

export const AUTH_COOKIE_NAMES: {
  TOKEN: string;
  USER_ID: string;
  SESSION: string;
};

export function setCookie(
  name: string, 
  value: string, 
  options?: {
    expiration?: number;
    path?: string;
    domain?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
    category?: string;
  }
): void;

export function getCookie(name: string): string | null;

export function deleteCookie(
  name: string, 
  options?: {
    path?: string;
    domain?: string;
  }
): void;

export function getConsentSettings(): {
  essential: boolean;
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
  consentDate: string | null;
};

export function saveConsentSettings(settings: {
  essential?: boolean;
  functional?: boolean;
  analytics?: boolean;
  marketing?: boolean;
}): boolean;

export function hasConsent(category: string): boolean;

export function hasConsentChoice(): boolean;

export function acceptAllCookies(): void;

export function acceptEssentialCookies(): void;

export function setAuthToken(token: string, rememberMe?: boolean): void;

export function getAuthToken(): string | null;

export function clearAuthCookies(): void;

declare const cookieManager: {
  setCookie: typeof setCookie;
  getCookie: typeof getCookie;
  deleteCookie: typeof deleteCookie;
  getConsentSettings: typeof getConsentSettings;
  saveConsentSettings: typeof saveConsentSettings;
  hasConsent: typeof hasConsent;
  hasConsentChoice: typeof hasConsentChoice;
  acceptAllCookies: typeof acceptAllCookies;
  acceptEssentialCookies: typeof acceptEssentialCookies;
  setAuthToken: typeof setAuthToken;
  getAuthToken: typeof getAuthToken;
  clearAuthCookies: typeof clearAuthCookies;
  COOKIE_CATEGORIES: typeof COOKIE_CATEGORIES;
  AUTH_COOKIE_NAMES: typeof AUTH_COOKIE_NAMES;
};

export default cookieManager;
