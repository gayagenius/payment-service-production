const statusMap = {
  requires_payment_method: "PENDING",
  requires_confirmation: "PENDING",
  requires_action: "ACTION_REQUIRED", // 3DS / SCA
  processing: "PROCESSING",
  succeeded: "SUCCEEDED",
  canceled: "CANCELED",
  requires_capture: "AWAITING_CAPTURE",
};

function mapStripeStatus(stripeStatus) {
  return statusMap[stripeStatus] || "UNKNOWN";
}

module.exports = { mapStripeStatus };