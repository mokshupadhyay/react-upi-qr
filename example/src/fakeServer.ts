import type { PaymentCheckResult } from 'react-upi-qr';

/**
 * Stands in for your backend. A real server would look the order up and ask
 * its payment gateway (status API or webhook records) whether the money for
 * this transactionRef and amount arrived. Never trust the browser for this.
 */
const orders = new Map<string, PaymentCheckResult>();
let checks = 0;

export const fakeServer = {
  createOrder(): string {
    const ref = `ORDER${Date.now().toString(36).toUpperCase()}`;
    orders.set(ref, 'pending');
    return ref;
  },
  /** What the demo buttons do: pretend the bank reported back. */
  settle(ref: string, result: 'paid' | 'failed') {
    orders.set(ref, result);
  },
  /** GET /api/orders/:ref/status, with some network latency. */
  async status(ref: string): Promise<PaymentCheckResult> {
    checks += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    return orders.get(ref) || 'failed';
  },
  checks: () => checks,
};
