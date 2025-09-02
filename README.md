
# payment-service
Payment Service microservice for handling payments, refunds, and payment history as part of the e-commerce system (Group 1)

## 🗄️ Database Setup

### Prerequisites
- PostgreSQL 14+ installed locally
- Database `payment_service` created

### Run Migrations
```bash
# Create database (if not exists)
createdb payment_service

# Run all migrations
npm run migrate

# Reset database (drops and recreates all tables)
npm run migrate:reset
```

### Environment Variables (Optional)
```bash
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=payment_service
export DB_USER= the user set for postgres on your local
export DB_PASSWORD=the password set for your account
```

---

(Add GitHub Actions workflow for Docker build & push)
**README.md** that:

1. Explains the service.
2. Shows how to run locally with Docker.
3. Documents endpoints.
4. Explains how to contribute.
5. Includes the GitHub Actions workflow (so Docker builds & pushes automatically).



---

```markdown
# Payment Service 💳

A simple **payment microservice** built with Node.js + Express and PostgreSQL.  
Runs in **Docker** and supports GitHub Actions for CI/CD.

---

## Features

- ✅ Process payments (credit card, digital wallets) *(simulation mode)*
- ✅ Handle refunds and chargebacks
- ✅ Manage payment methods
- ✅ View transaction history and receipts
- ✅ Runs in Docker (isolated DB + app)
- ✅ GitHub Actions workflow to auto-build + push Docker images

---

## Project Structure

```

payment-service/
├── src/
│   ├── app.js              # Main Express app
│   ├── routes/
│   │    ├── payments.js    # Payments routes
│   │    ├── refunds.js     # Refunds routes
│   │    └── methods.js     # Payment methods routes
│   ├── db.js               # Database connection (Postgres)
│   └── models.js           # Models (transactions, methods, etc.)
├── Dockerfile
├── docker-compose.yml
├── package.json
├── .env
├── init.sql                # DB schema (auto-loaded by Postgres)
└── README.md

````

---

## Getting Started

### 1. Clone the repo
```bash
git clone https://github.com/<your-org>/payment-service.git
cd payment-service
````

### 2. Setup environment

Create a `.env` file in the root:

```env
PORT=8080
DATABASE_URL=postgres://pay_user:supersecret@payment-db:5432/payments
```

### 3. Run with Docker

```bash
docker-compose up --build
```

App runs at: [http://localhost:8080](http://localhost:8080) 🚀
DB runs inside Docker as `payment-db`.

---

## Endpoints

| Method | Endpoint    | Description                    |
| ------ | ----------- | ------------------------------ |
| GET    | `/`         | Health check                   |
| POST   | `/payments` | Create a payment (simulated)   |
| POST   | `/refunds`  | Create a refund (simulated)    |
| GET    | `/methods`  | List available payment methods |

---

## GitHub Actions (CI/CD)

A workflow is included to auto-build and push the Docker image.
It triggers on every push to `main`.

### `.github/workflows/docker-build.yml`

```yaml
name: Build and Push Payment Service

on:
  push:
    branches:
      - main

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repo
        uses: actions/checkout@v3

      - name: Log in to DockerHub
        uses: docker/login-action@v2
        with:
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_TOKEN }}

      - name: Build and push Docker image
        uses: docker/build-push-action@v4
        with:
          push: true
          tags: your-dockerhub-username/payment-service:latest
```

> ⚠️ Before using, set your DockerHub credentials in GitHub repo:
> **Settings → Secrets → Actions → New Repository Secret**
>
> * `DOCKER_USERNAME`
> * `DOCKER_TOKEN`

---

## View Documentation Locally

To view the API documentation and ER Diagram locally:

1. **Start the documentation server:**
   ```bash
   npm run docs
   ```

2. **Access the documentation:**
   - **Swagger UI**: http://localhost:8081/docs/swagger-ui.html
   - **ER Diagram**: http://localhost:8081/docs/erd-viewer.html

The ER Diagram is built using **Mermaid** and automatically loads from `docs/ERD.mmd`. The Swagger documentation loads the OpenAPI spec from `api/openapi.yaml`.

**Development mode** (auto-restart on changes):
```bash
npm run dev:docs
``` 

## Contributing

1. Fork the repo
2. Create a branch (`git checkout -b feature/new-thing`)
3. Commit changes (`git commit -m "Add new thing"`)
4. Push (`git push origin feature/new-thing`)
5. Create a PR 🚀

---

## License

MIT License



---

# Payment Service

A simple payment microservice containerized with Docker and deployed using GitHub Actions.

---

## 🚀 Features
- Node.js payment service running on **port 8080**
- PostgreSQL database as a dependency
- Dockerized setup with `docker-compose`
- GitHub Actions workflow to build & push Docker image to DockerHub

---

## 🐳 Running Locally with Docker

### 1. Clone the repository
```bash
git clone https://github.com/your-username/payment-service.git
cd payment-service
````

### 2. Build & start services

```bash
docker-compose up --build
```

This will:

* Start the **Postgres DB** (`payment-db`)
* Start the **payment service** (`payment-service`) at `http://localhost:8080`

---

## ⚙️ Development Notes

* If you visit `http://localhost:8080`, you may see `Cannot GET /`.
  That’s expected — define your routes in the service (e.g. `/health`, `/pay`, etc.).
* Ensure port **8080** is free before running:

  ```bash
  lsof -i :8080
  kill -9 <PID>
  ```

---

## ☁️ Deploying with GitHub Actions

We use GitHub Actions to **build and push** the Docker image to DockerHub.

### 1. Create DockerHub Token

* Log in to [DockerHub](https://hub.docker.com/)
* Go to **Account Settings → Security → Access Tokens**
* Create a new token (e.g., `github-actions`)

### 2. Add GitHub Secrets

In your repo:

* `DOCKER_USERNAME` → your DockerHub username
* `DOCKERHUB_TOKEN` → the token you created above

### 3. Workflow File

The CI workflow is defined in:

```
.github/workflows/docker-build.yml
```

```yaml
name: Build and Push Payment Service

on:
  push:
    branches:
      - main

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repo
        uses: actions/checkout@v3

      - name: Log in to DockerHub
        uses: docker/login-action@v2
        with:
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Build and push Docker image
        uses: docker/build-push-action@v4
        with:
          push: true
          tags: ${{ secrets.DOCKER_USERNAME }}/payment-service:latest
```

When you push to the **main branch**, GitHub will:

1. Build the Docker image
2. Push it to DockerHub:

   ```
   docker pull your-username/payment-service:latest
   ```

---

## 📂 Project Structure

```
payment-service/
├── Dockerfile
├── docker-compose.yml
├── init.sql
├── src/               # our service code
├── package.json
└── .github/
    └── workflows/
        └── docker-build.yml
```

