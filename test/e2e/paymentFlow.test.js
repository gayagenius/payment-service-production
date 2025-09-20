const axios = require("axios");

describe("E2E: Payment Flow", () => {
  test("should complete payment lifecycle", async () => {
    // Step 1: Create payment
    const createRes = await axios.post("http://localhost:3000/api/payments", {
      userId: "123",
      orderId: "123",
      amount: 100,
    });
    expect(createRes.data.status).toBe("SUCCESS");
    const paymentId = createRes.data.paymentId;

    // Step 2: Fetch payment status
    const statusRes = await axios.get(`http://localhost:3000/api/payments/${paymentId}`);
    expect(statusRes.data).toHaveProperty("status");

    // Step 3: (Optional) Trigger refund flow if implemented
  });
});
