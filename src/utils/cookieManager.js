/**
 * RoleMatch Cookie Management Utility
 * 
 * Provides industry-standard cookie management functions including:
 * - Cookie consent handling
 * - Setting and deleting cookies with security options
 * - Cookie categories (essential, functional, analytics, marketing)
 * - GDPR/CCPA compliant consent mechanisms
 */

import { forgetDemoProfiles } from './forgetDemoProfiles';

// Cookie consent settings key in localStorage
const CONSENT_STORAGE_KEY = 'rolematch_cookie_consent';

// Cookie categories
export const COOKIE_CATEGORIES = {
  ESSENTIAL: 'essential',   // Required for basic functionality
  FUNCTIONAL: 'functional', // Enhances user experience (preferences)
  ANALYTICS: 'analytics',   // Usage statistics and performance
  MARKETING: 'marketing'    // Personalized content and advertising
};

// Default expiration time (30 days in seconds)
const DEFAULT_EXPIRATION = 30 * 24 * 60 * 60;

/**
 * Sets a cookie with the specified parameters
 * 
 * @param {string} name - Cookie name
 * @param {string} value - Cookie value
 * @param {Object} options - Cookie options
 * @param {number} options.expiration - Expiration time in seconds (default: 30 days)
 * @param {string} options.path - Cookie path (default: '/')
 * @param {string} options.domain - Cookie domain
 * @param {boolean} options.secure - Set secure flag for HTTPS only
 * @param {boolean} options.httpOnly - Set httpOnly flag
 * @param {string} options.sameSite - SameSite attribute (Strict, Lax, None)
 * @param {string} options.category - Cookie category for consent management
 */
function setCookie(name, value, options = {}) {
  // If user hasn't consented to non-essential cookies, check category
  if (options.category && options.category !== COOKIE_CATEGORIES.ESSENTIAL) {
    const consent = getConsentSettings();
    if (!consent[options.category]) {
      return;
    }
  }

  const expiration = options.expiration !== undefined ? options.expiration : DEFAULT_EXPIRATION;
  const path = options.path || '/';
  
  let cookieString = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
  
  // Add expiration if provided (use session cookie if not)
  if (expiration) {
    const expirationDate = new Date();
    expirationDate.setTime(expirationDate.getTime() + expiration * 1000);
    cookieString += `; expires=${expirationDate.toUTCString()}`;
  }
  
  // Add path
  cookieString += `; path=${path}`;
  
  // Add domain if provided
  if (options.domain) {
    cookieString += `; domain=${options.domain}`;
  }
  
  // Add secure flag for HTTPS
  if (options.secure || window.location.protocol === 'https:') {
    cookieString += '; secure';
  }
  
  // Add SameSite attribute (default to Lax for security)
  const sameSite = options.sameSite || 'Lax';
  cookieString += `; samesite=${sameSite}`;
  
  // Set the cookie
  document.cookie = cookieString;
}

/**
 * Deletes a cookie by setting its expiration to the past
 * 
 * @param {string} name - Cookie name
 * @param {Object} options - Cookie options (path, domain)
 */
function deleteCookie(name, options = {}) {
  setCookie(name, '', {
    ...options,
    expiration: -1, // Expire immediately
  });
}

/**
 * Gets the current consent settings from localStorage
 * 
 * @returns {Object} Consent settings for each category
 */
export function getConsentSettings() {
  try {
    const storedConsent = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (storedConsent) {
      return JSON.parse(storedConsent);
    }
  } catch (error) {
    console.error('Error retrieving cookie consent settings:', error);
  }
  
  // Default: only essential cookies allowed
  return {
    [COOKIE_CATEGORIES.ESSENTIAL]: true,
    [COOKIE_CATEGORIES.FUNCTIONAL]: false,
    [COOKIE_CATEGORIES.ANALYTICS]: false,
    [COOKIE_CATEGORIES.MARKETING]: false,
    consentDate: null
  };
}

/**
 * Saves consent settings to localStorage
 * 
 * @param {Object} settings - Consent settings for each category
 */
export function saveConsentSettings(settings) {
  try {
    // Ensure essential cookies are always enabled
    const updatedSettings = {
      ...settings,
      [COOKIE_CATEGORIES.ESSENTIAL]: true,
      consentDate: new Date().toISOString()
    };
    
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(updatedSettings));
    
    // Dispatch an event that consent settings changed
    window.dispatchEvent(new CustomEvent('cookieConsentChanged', { 
      detail: updatedSettings 
    }));
    
    return true;
  } catch (error) {
    console.error('Error saving cookie consent settings:', error);
    return false;
  }
}

/**
 * Checks if the user has made any consent choice (accepted or declined)
 * 
 * @returns {boolean} Whether the user has made a consent choice
 */
export function hasConsentChoice() {
  const consent = getConsentSettings();
  return !!consent.consentDate;
}

/**
 * Accepts all cookie categories
 */
export function acceptAllCookies() {
  saveConsentSettings({
    [COOKIE_CATEGORIES.ESSENTIAL]: true,
    [COOKIE_CATEGORIES.FUNCTIONAL]: true,
    [COOKIE_CATEGORIES.ANALYTICS]: true,
    [COOKIE_CATEGORIES.MARKETING]: true
  });
}

/**
 * Accepts only essential cookies
 */
export function acceptEssentialCookies() {
  saveConsentSettings({
    [COOKIE_CATEGORIES.ESSENTIAL]: true,
    [COOKIE_CATEGORIES.FUNCTIONAL]: false,
    [COOKIE_CATEGORIES.ANALYTICS]: false,
    [COOKIE_CATEGORIES.MARKETING]: false
  });
}

/**
 * Authentication-related cookie functions
 */

// Cookie names
const AUTH_COOKIE_NAMES = {
  TOKEN: 'rolematch_auth_token',
  USER_ID: 'rolematch_user_id',
  SESSION: 'rolematch_session'
};

/**
 * Clear all authentication cookies and user session data
 */
export function clearAuthCookies() {
  // Clear auth cookies
  Object.values(AUTH_COOKIE_NAMES).forEach(name => {
    deleteCookie(name);
  });
  
  // and whatever an earlier version kept about the person in this browser
  forgetDemoProfiles();
}
