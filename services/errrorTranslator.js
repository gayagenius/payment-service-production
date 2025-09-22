function translateStripeError(err) {
  if (!err) return new Error("Unknown Stripe error");
  if (err.type === "StripeCardError") {
    return new Error(err.message || "Card declined");
  }
  return new Error(err.message || "Stripe error");
}
module.exports = { translateStripeError };
