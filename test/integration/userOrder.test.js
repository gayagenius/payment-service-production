const axios = require("axios");

describe("Integration: User + Order services", () => {
  test("should validate user successfully", async () => {
    const res = await axios.get("http://localhost:4000/users/123");
    expect(res.data).toHaveProperty("id", "123");
  });

  test("should return error for invalid user", async () => {
    try {
      await axios.get("http://localhost:4000/users/404");
    } catch (err) {
      expect(err.response.status).toBe(404);
    }
  });

  test("should confirm order successfully", async () => {
    const res = await axios.post("http://localhost:5000/orders/123/confirm", { paymentId: "pay_1" });
    expect(res.data.status).toBe("confirmed");
  });

  test("should fail to confirm order", async () => {
    try {
      await axios.post("http://localhost:5000/orders/fail/confirm", { paymentId: "pay_1" });
    } catch (err) {
      expect(err.response.status).toBe(500);
    }
  });
});
