import { detectDeviceKind } from '../index';
import type { DeviceHints, DeviceKind } from '../index';

const UA = {
  pixel:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  androidWebView:
    'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36',
  reducedChromeAndroid:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  ipadOld:
    'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  chromeOs:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

const table: Array<[string, DeviceHints, DeviceKind]> = [
  ['Chrome on a Pixel', { userAgent: UA.pixel, maxTouchPoints: 5 }, 'android'],
  ['Samsung Internet', { userAgent: UA.samsung, maxTouchPoints: 5 }, 'android'],
  ['Firefox on Android', { userAgent: UA.androidFirefox, maxTouchPoints: 5 }, 'android'],
  ['an Android tablet', { userAgent: UA.androidTablet, maxTouchPoints: 10 }, 'android'],
  ['an Android WebView', { userAgent: UA.androidWebView, maxTouchPoints: 5 }, 'android'],
  ['the reduced Chrome user agent', { userAgent: UA.reducedChromeAndroid, maxTouchPoints: 5 }, 'android'],
  ['Chrome asking for the desktop site, with client hints', { userAgent: UA.linuxFirefox, platform: 'Android' }, 'android'],
  ['Safari on an iPhone', { userAgent: UA.iphone, maxTouchPoints: 5 }, 'ios'],
  ['Chrome on an iPhone', { userAgent: UA.iphoneChrome, maxTouchPoints: 5 }, 'ios'],
  ['an iPad on iOS 12', { userAgent: UA.ipadOld, maxTouchPoints: 5 }, 'ios'],
  ['an iPad in desktop mode (Mac user agent with touch)', { userAgent: UA.macSafari, maxTouchPoints: 5 }, 'ios'],
  ['Safari on a Mac', { userAgent: UA.macSafari, maxTouchPoints: 0 }, 'desktop'],
  ['a Mac without maxTouchPoints', { userAgent: UA.macSafari }, 'desktop'],
  ['Chrome on Windows', { userAgent: UA.windowsChrome, maxTouchPoints: 0, platform: 'Windows' }, 'desktop'],
  ['a Windows touch laptop', { userAgent: UA.windowsChrome, maxTouchPoints: 10 }, 'desktop'],
  ['Firefox on Linux', { userAgent: UA.linuxFirefox }, 'desktop'],
  ['ChromeOS', { userAgent: UA.chromeOs, platform: 'Chrome OS' }, 'desktop'],
  ['an empty user agent', { userAgent: '' }, 'desktop'],
];

describe('detectDeviceKind', () => {
  it.each(table)('%s', (_name, hints, expected) => {
    expect(detectDeviceKind(hints)).toBe(expected);
  });

  it('never throws on odd input', () => {
    expect(detectDeviceKind({} as DeviceHints)).toBe('desktop');
    expect(detectDeviceKind({ userAgent: 42 } as unknown as DeviceHints)).toBe('desktop');
  });
});
