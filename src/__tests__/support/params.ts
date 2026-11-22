import type { UpiPaymentParams } from '../../index';

export const params: UpiPaymentParams = {
  payeeVpa: 'shop@okbank',
  payeeName: 'Corner Shop',
  amount: '149.50',
  transactionRef: 'ORDER42',
  note: 'Order 42',
};
