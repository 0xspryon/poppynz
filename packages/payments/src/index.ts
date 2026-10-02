// The port and the mock. The provider-selecting layer joins in Task 2; the
// Stripe adapter is reached only through it — nothing outside this package
// imports Stripe.
export * from './port';
export * from './mock';
