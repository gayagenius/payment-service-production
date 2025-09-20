import express from "express";

const app = express();
app.use(express.json());

app.get("/users/:id", (req, res) => {
  if (req.params.id === "404") {
    return res.status(404).json({ error: "User not found" });
  }
  res.json({ id: req.params.id, name: "Test User" });
});

const PORT = process.env.MOCK_USER_PORT || 4000;
app.listen(PORT, () => console.log(`Mock User Service running on ${PORT}`));
