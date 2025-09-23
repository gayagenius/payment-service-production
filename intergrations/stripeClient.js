const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
import { translateStripeError } from "./errorTranslator";

class StripeClient {
  /**
   * Create a PaymentIntent
   */
  static async createPaymentIntent(userId, orderId, amount, currency, idempotencyKey) {
    try {
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount,
          currency,
          metadata: { userId, orderId },
        },
        { idempotencyKey }
      );
      return paymentIntent;
    } catch (err) {
      throw translateStripeError(err);
    }
  }

  /**
   * Confirm PaymentIntent
   */
  static async confirmPaymentIntent(paymentIntentId, paymentMethodId, idempotencyKey) {
    try {
      const paymentIntent = await stripe.paymentIntents.confirm(
        paymentIntentId,
        paymentMethodId ? { payment_method: paymentMethodId } : {},
        { idempotencyKey }
      );
      return paymentIntent;
    } catch (err) {
      throw translateStripeError(err);
    }
  }

  /**
   * Cancel PaymentIntent
   */
  static async cancelPaymentIntent(paymentIntentId, idempotencyKey) {
    try {
      const paymentIntent = await stripe.paymentIntents.cancel(
        paymentIntentId,
        {},
        { idempotencyKey }
      );
      return paymentIntent;
    } catch (err) {
      throw translateStripeError(err);
    }
  }
}

export default StripeClient;
