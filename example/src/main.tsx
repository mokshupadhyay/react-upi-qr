import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PayWithUpi } from 'react-upi-qr';
import type { DeviceKind } from 'react-upi-qr';
import 'react-upi-qr/styles.css';
import { fakeServer } from './fakeServer';
import './demo.css';

type DeviceChoice = 'auto' | DeviceKind;

function Demo() {
  const [ref, setRef] = useState(() => fakeServer.createOrder());
  const [device, setDevice] = useState<DeviceChoice>('auto');
  const [log, setLog] = useState<string[]>([]);
  const note = (line: string) => setLog((lines) => [`${new Date().toLocaleTimeString()} ${line}`, ...lines].slice(0, 8));

  return (
    <main className="demo">
      <h1>react-upi-qr</h1>
      <p>
        A demo with a fake server. No money moves: the VPA below is not real, so do not pay the code with a real
        UPI app.
      </p>

      <fieldset className="demo-controls">
        <legend>Device</legend>
        {(['auto', 'desktop', 'android', 'ios'] as const).map((choice) => (
          <label key={choice}>
            <input
              type="radio"
              name="device"
              checked={device === choice}
              onChange={() => setDevice(choice)}
            />{' '}
            {choice}
          </label>
        ))}
      </fieldset>

      <PayWithUpi
        key={`${ref}-${device}`}
        params={{
          payeeVpa: 'demo-shop@examplebank',
          payeeName: 'Demo Shop',
          amount: '149.50',
          transactionRef: ref,
          note: `Order ${ref}`,
        }}
        deviceKind={device === 'auto' ? undefined : device}
        expiresInSeconds={120}
        pollIntervalMs={2000}
        confirmPayment={async ({ attempt }) => {
          const result = await fakeServer.status(ref);
          note(`check #${attempt}: ${result}`);
          return result;
        }}
        onPaid={() => note('onPaid')}
        onFailed={() => note('onFailed')}
        onExpired={() => note('onExpired')}
      />

      <fieldset className="demo-controls">
        <legend>Fake bank</legend>
        <button type="button" onClick={() => fakeServer.settle(ref, 'paid')}>
          Mark paid
        </button>
        <button type="button" onClick={() => fakeServer.settle(ref, 'failed')}>
          Mark failed
        </button>
        <button type="button" onClick={() => setRef(fakeServer.createOrder())}>
          New order
        </button>
      </fieldset>

      <h2>Server log</h2>
      <ol className="demo-log" aria-label="Server log">
        {log.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ol>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
