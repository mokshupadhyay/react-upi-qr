// Renders the built package (lib/commonjs) with React 17, 18 and 19:
// server rendering without a DOM, hydration without mismatch warnings, and a
// client render that polls until "Paid". Run with `npm run test:compat`.
//
// React 17 and 18 live in scripts/compat/react-<major> (installed on first
// run). Every `react` and `react-dom` import, including the ones inside
// lib/, is redirected to the version under test.
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const versions = [
  { major: 17, dir: path.join(__dirname, 'compat', 'react-17') },
  { major: 18, dir: path.join(__dirname, 'compat', 'react-18') },
  { major: 19, dir: root },
];

if (process.env.UPIQR_COMPAT_DIR) {
  runOne(process.env.UPIQR_COMPAT_DIR).then(
    () => process.exit(0),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
} else {
  let failed = false;
  for (const version of versions) {
    if (!fs.existsSync(path.join(version.dir, 'node_modules', 'react'))) {
      execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: version.dir, stdio: 'inherit' });
    }
    try {
      execFileSync(process.execPath, [__filename], {
        env: { ...process.env, UPIQR_COMPAT_DIR: version.dir },
        stdio: 'inherit',
        timeout: 120000,
      });
    } catch {
      failed = true;
      console.error(`React ${version.major}: FAILED`);
    }
  }
  process.exit(failed ? 1 : 0);
}

async function runOne(dir) {
  const Module = require('node:module');
  const original = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    if (/^react(-dom)?(\/.*)?$/.test(request)) {
      return original.call(this, request, { ...parent, paths: [path.join(dir, 'node_modules')] }, ...rest);
    }
    return original.call(this, request, parent, ...rest);
  };

  const React = require('react');
  const server = require('react-dom/server');
  const major = Number(React.version.split('.')[0]);
  const lib = require(path.join(root, 'lib', 'commonjs', 'index.js'));
  const params = { payeeVpa: 'shop@okbank', payeeName: 'Corner Shop', amount: '149.50', transactionRef: 'ORDER42', note: 'Order 42' };
  const expect = (condition, message) => {
    if (!condition) throw new Error(`React ${React.version}: ${message}`);
  };
  const h = React.createElement;

  // 1. Server rendering, with no DOM globals at all.
  expect(typeof window === 'undefined', 'window must not exist during the server render');
  const shell = server.renderToString(h(lib.PayWithUpi, { params, confirmPayment: () => new Promise(() => {}) }));
  expect(shell.includes('role="status"') && !shell.includes('<svg'), 'server shell without QR code');
  const desktop = server.renderToString(
    h(lib.PayWithUpi, { params, confirmPayment: () => new Promise(() => {}), deviceKind: 'desktop' }),
  );
  expect(desktop.includes('<svg'), 'server render with deviceKind="desktop" has the QR code');

  // 2. A DOM, for hydration and client rendering.
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  // Node 21+ has its own read-only `navigator`.
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator });
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const ReactDOM = require('react-dom');
  const client = major >= 18 ? require('react-dom/client') : null;
  const act = React.act || require('react-dom/test-utils').act;

  const errors = [];
  const consoleError = console.error;
  console.error = (...args) => {
    errors.push(args.map(String).join(' '));
  };

  try {
    // Hydrate the server shell; detection then switches to the desktop view.
    const hydrated = document.createElement('div');
    hydrated.innerHTML = shell;
    document.body.appendChild(hydrated);
    let hydratedRoot = null;
    await act(async () => {
      const element = h(lib.PayWithUpi, { params, confirmPayment: () => new Promise(() => {}) });
      if (client) hydratedRoot = client.hydrateRoot(hydrated, element);
      else ReactDOM.hydrate(element, hydrated);
    });
    expect(hydrated.querySelector('svg.upiqr-qr') !== null, 'QR code after hydration on a desktop user agent');
    await act(async () => {
      if (hydratedRoot) hydratedRoot.unmount();
      else ReactDOM.unmountComponentAtNode(hydrated);
    });

    // Client render that polls until the fake server says "paid".
    let checks = 0;
    let paid = 0;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const element = h(lib.PayWithUpi, {
      params,
      deviceKind: 'desktop',
      pollIntervalMs: 20,
      confirmPayment: async () => {
        checks += 1;
        return checks >= 2 ? 'paid' : 'pending';
      },
      onPaid: () => {
        paid += 1;
      },
    });
    let root = null;
    await act(async () => {
      if (client) {
        root = client.createRoot(container);
        root.render(element);
      } else {
        ReactDOM.render(element, container);
      }
    });
    const statusText = () => container.querySelector('[role="status"]').textContent;
    expect(statusText() === 'Waiting for payment…', `waiting, got "${statusText()}"`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(statusText() === 'Paid' && paid === 1 && checks === 2, `paid after two checks, got "${statusText()}", ${checks} checks`);
    await act(async () => {
      if (root) root.unmount();
      else ReactDOM.unmountComponentAtNode(container);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(checks === 2, 'no checks after unmount');
  } finally {
    console.error = consoleError;
  }
  expect(errors.length === 0, `no React warnings, got:\n${errors.join('\n')}`);
  console.log(`React ${React.version}: server render, hydration and client polling OK`);
  dom.window.close();
}
