CREATE TABLE IF NOT EXISTS methods (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(50),
  type VARCHAR(20),
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(50),
  method_id INT REFERENCES methods(id),
  amount NUMERIC(10,2),
  currency VARCHAR(10),
  status VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);

