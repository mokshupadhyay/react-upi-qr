import { buildUpiUrl, KNOWN_UPI_APPS, upiAppLink } from '../index';
import { params } from './support/params';

const url = buildUpiUrl(params);
const query = url.slice('upi://pay?'.length);
const phonepe = KNOWN_UPI_APPS.filter((app) => app.id === 'phonepe')[0];

describe('upiAppLink', () => {
  it('builds a Chrome intent URL with the package on Android', () => {
    expect(upiAppLink(phonepe, url, 'android')).toBe(
      `intent://pay?${query}#Intent;scheme=upi;package=com.phonepe.app;end`,
    );
  });

  it('uses the app scheme on iOS', () => {
    expect(upiAppLink(phonepe, url, 'ios')).toBe(`phonepe://pay?${query}`);
  });

  it('has no per-app link on desktop', () => {
    expect(upiAppLink(phonepe, url, 'desktop')).toBeNull();
  });

  it('keeps $ sequences in the query literal', () => {
    const odd = buildUpiUrl({ ...params, note: "$& $' $1" });
    expect(upiAppLink(phonepe, odd, 'ios')).toBe(`phonepe://pay?${odd.slice('upi://pay?'.length)}`);
  });

  it('never puts a raw # in the intent query, which would end it early', () => {
    const hashy = buildUpiUrl({ ...params, note: '#1 order' });
    const link = upiAppLink(phonepe, hashy, 'android')!;
    expect(link.indexOf('#')).toBe(link.indexOf('#Intent;'));
  });

  it('lists unique ids, every one with a package and a {query} template', () => {
    const ids = KNOWN_UPI_APPS.map((app) => app.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const app of KNOWN_UPI_APPS) {
      expect(app.androidPackage).toMatch(/^[a-z][\w.]+$/);
      expect(app.iosPayUrl).toContain('{query}');
    }
  });
});
