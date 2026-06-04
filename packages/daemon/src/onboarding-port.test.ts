import { describe, it, expect } from 'vitest';
import { ONBOARDING_PORT_OFFSET, onboardingPort, onboardingUrlFromAdminUrl } from './onboarding-port.js';

describe('onboarding-port — single source of truth (Daemon ↔ CLI join)', () => {
  it('offset is +1', () => {
    expect(ONBOARDING_PORT_OFFSET).toBe(1);
  });

  it('onboardingPort bumps the main port by the offset', () => {
    expect(onboardingPort(9440)).toBe(9441);
    expect(onboardingPort(8000)).toBe(8001);
  });

  describe('onboardingUrlFromAdminUrl', () => {
    it('REGRESSION (port-mismatch bug): the documented admin URL :9440 → certless join origin :9441', () => {
      // The admin prints `--admin-url https://<ip>:9440`; the certless /onboarding/join
      // MUST NOT hit the mTLS main port (9440) — it lives on the onboarding port (9441).
      expect(onboardingUrlFromAdminUrl('https://10.10.10.94:9440')).toBe('https://10.10.10.94:9441');
    });

    it('strips any path / trailing slash → returns origin only', () => {
      expect(onboardingUrlFromAdminUrl('https://10.10.10.94:9440/')).toBe('https://10.10.10.94:9441');
      expect(onboardingUrlFromAdminUrl('https://10.10.10.94:9440/onboarding/join')).toBe('https://10.10.10.94:9441');
    });

    it('preserves the protocol (http kept for local-mode admin)', () => {
      expect(onboardingUrlFromAdminUrl('http://127.0.0.1:9440')).toBe('http://127.0.0.1:9441');
    });

    it('handles a non-default main port', () => {
      expect(onboardingUrlFromAdminUrl('https://host.local:8443')).toBe('https://host.local:8444');
    });

    it('handles IPv6 hosts and strips path/query/hash', () => {
      expect(onboardingUrlFromAdminUrl('https://[::1]:9440/onboarding/join?x=1#f')).toBe('https://[::1]:9441');
    });

    it('strips userinfo from the derived origin', () => {
      expect(onboardingUrlFromAdminUrl('https://user:pass@admin.local:9440/path')).toBe('https://admin.local:9441');
    });

    it('uses default ports when admin URL has no explicit port', () => {
      expect(onboardingUrlFromAdminUrl('https://admin.local/path')).toBe('https://admin.local:444');
      expect(onboardingUrlFromAdminUrl('http://admin.local/path')).toBe('http://admin.local:81');
    });

    it('rejects unsupported protocols', () => {
      expect(() => onboardingUrlFromAdminUrl('ftp://admin.local:9440')).toThrow();
    });

    it('throws on an invalid URL', () => {
      expect(() => onboardingUrlFromAdminUrl('not-a-url')).toThrow();
    });
  });
});
