# Payment Service — Docker + Kubernetes (kubeadm) + CI/CD 


## Prerequisites
- Docker Desktop with Kubernetes (kubeadm) enabled, or your kubeadm cluster reachable via `kubectl`.
- `kubectl` and `kustomize` available (kubectl has kustomize built-in as `kubectl apply -k`).
- Docker Hub account (or GHCR if you prefer).


## 1) Build & Push Image
```bash
export USERNAME="<your-dockerhub-username>"
export IMG="$USERNAME/payment-service:latest"
docker build -t $IMG .
docker push $IMG




A Node.js + TypeScript microservice for handling payments. This project includes ESLint for code quality, Vitest for testing, and TypeScript for type safety. It is ready for CI/CD pipelines.

---

## Project Setup

### 1. Clone the repository
```bash
git clone https://github.com/gayagenius/payment-service-production.git
cd payment-service
````

### 2. Install dependencies

```bash
npm install
```

### 3. Add `.env` variables

Create a `.env` file in the root if needed for environment configuration.

---

## Scripts

| Script              | Description                                    |
| ------------------- | ---------------------------------------------- |
| `npm run lint`      | Run ESLint for code linting                    |
| `npm run test`      | Run Vitest tests with coverage                 |
| `npm run typecheck` | Run TypeScript type checks without emitting JS |
| `npm run build`     | Compile TypeScript into JavaScript (`dist/`)   |

---

## Database Scalability & Compliance

This payment service implements a comprehensive partitioning, archiving, and read-replica strategy for scalability, compliance, and performance.

### Key Features

- **Range Partitioning**: Payments and refunds partitioned by `created_at` for optimal performance
- **Automatic Archival**: Performance (49,999 row threshold) and compliance (1-year retention) archival
- **Read-Replica Support**: Separate read/write connection pools with consistency guarantees
- **Idempotency & Retry**: Safe retry logic with idempotency keys
- **Compliance Reporting**: 7-year retention for audit and reporting

### Database Scripts

| Script | Description |
|--------|-------------|
| `npm run backfill` | Migrate data to partitioned tables |
| `npm run backfill:dry-run` | Dry-run data migration |
| `npm run optimize-indexes` | Analyze and optimize database indexes |
| `npm run optimize-indexes:create` | Create recommended indexes |
| `npm run test:scalability` | Run comprehensive scalability tests |
| `npm run test:scalability:load` | Run load tests with 50k requests |
| `npm run test:scalability:dry-run` | Dry-run scalability tests |
| `npm run test:e2e` | Run comprehensive end-to-end tests |
| `npm run test:e2e:no-cleanup` | Run tests without cleanup |
| `npm run test:e2e:dry-run` | Dry-run end-to-end tests |
| `npm run setup` | Complete automated setup |
| `npm run setup:dry-run` | Dry-run complete setup |
| `npm run setup:no-tests` | Setup without running tests |

### Environment Variables

```bash
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=payment_service
DB_USER=postgres
DB_PASSWORD=password

# Read/Write Pool Configuration
DB_WRITE_HOST=localhost
DB_WRITE_PORT=5432
DB_WRITE_NAME=payment_service
DB_WRITE_USER=postgres
DB_WRITE_PASSWORD=password

DB_READ_HOST=localhost
DB_READ_PORT=5432
DB_READ_NAME=payment_service
DB_READ_USER=postgres
DB_READ_PASSWORD=password

# Pool Sizing
DB_WRITE_POOL_MAX=20
DB_WRITE_POOL_MIN=5
DB_READ_POOL_MAX=50
DB_READ_POOL_MIN=10

# Consistency Settings
DB_MAX_LAG_SECONDS=5
DB_READ_AFTER_WRITE_DELAY=1000

# Archival Configuration
ARCHIVAL_ENABLED=true
PERFORMANCE_THRESHOLD=49999
PERFORMANCE_ARCHIVE_COUNT=20000
COMPLIANCE_RETENTION_YEARS=1
REPORTS_RETENTION_YEARS=7
```

### Quick Start

#### Option 1: Complete Automated Setup (Recommended)
```bash
# Complete end-to-end setup with all features
npm run setup

# Dry-run to see what would be executed
npm run setup:dry-run

# Setup without running tests
npm run setup:no-tests
```

#### Option 2: Manual Step-by-Step Setup
1. **Run Partitioning Migration**:
   ```bash
   # Apply partitioning schema
   psql -d payment_service -f db/migrations/V001_enable_partitioning.sql
   
   # Run archival jobs
   psql -d payment_service -f jobs/archiveClosedPayments.sql
   
   # Setup helper functions
   psql -d payment_service -f src/db/roHelpers.sql
   ```

2. **Migrate Existing Data**:
   ```bash
   # Dry-run first
   npm run backfill:dry-run
   
   # Execute migration
   npm run backfill
   ```

3. **Optimize Indexes**:
   ```bash
   # Analyze current indexes
   npm run optimize-indexes
   
   # Create recommended indexes
   npm run optimize-indexes:create
   ```

4. **Test Everything**:
   ```bash
   # Run end-to-end tests
   npm run test:e2e
   
   # Run scalability tests
   npm run test:scalability
   
   # Run load tests
   npm run test:scalability:load
   ```

### API Endpoints with Retry Support

#### Create Payment with Retry
```bash
POST /payments
Content-Type: application/json

{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "order_id": "order-123",
  "amount": 1000,
  "currency": "USD",
  "retry": true,
  "idempotency_key": "payment-123-retry"
}
```

#### Get Payments with Pagination
```bash
GET /payments?limit=50&offset=0&status=SUCCEEDED&user_id=550e8400-e29b-41d4-a716-446655440000
```

#### Get User Payments
```bash
GET /payments/user/550e8400-e29b-41d4-a716-446655440000?limit=50&offset=0
```

### Monitoring & Compliance

- **Archival Status**: `SELECT * FROM get_archival_status();`
- **Data Integrity**: `SELECT * FROM verify_archival_integrity();`
- **Performance Monitoring**: `SELECT * FROM partition_sizes;`
- **Compliance Reports**: See `docs/Archival-Verification.md`

---

## ESLint

* ESLint configuration uses the new `eslint.config.js` format.
* To enforce linting rules in CI/CD, run:

```bash
npm run lint
```

---

## Testing

* Vitest is configured for CI-friendly runs.
* Tests must be in `*.test.ts` or `*.spec.ts` format inside the `src/` folder.
* Run tests with coverage:

```bash
npm test
```

---

## TypeScript

* Project uses `tsconfig.json` with Node type definitions.
* Type checking is separate from build:

```bash
npm run typecheck
```

---

## Build

* Compile TypeScript files to `dist/`:

```bash
npm run build
```

* `dist/` is excluded from Git; only source files are tracked.

---

## .gitignore

The repository ignores:

* `node_modules/`
* `coverage/`
* `dist/`
* `.env`
* IDE/editor files like `.vscode/` or `.idea/`

---

## CI/CD

* Pipeline runs lint, typecheck, tests with coverage, and build.
* Feature branches should be pushed to GitHub and merged via pull request (PR).
* No direct push to protected branches (like `main`) is allowed.

---

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

## 🚀 API Documentation

### Quick Start

1. **Start the payment service:**
   ```bash
   npm run start
   ```

2. **Start the documentation server:**
   ```bash
   npm run docs
   ```

3. **Access the documentation:**
   - **Swagger UI**: http://localhost:8081/docs/swagger-ui.html
   - **ER Diagram**: http://localhost:8081/docs/erd-viewer.html

### Environment Variables

Create a `.env` file with the following variables:

```bash
# Payment Service Configuration
PORT=8080
NODE_ENV=development

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=payment_service
DB_USER=your_postgres_user
DB_PASSWORD=your_postgres_password

# RabbitMQ Configuration
RABBITMQ_HOST=localhost
RABBITMQ_PORT=5672
RABBITMQ_USER=guest
RABBITMQ_PASS=guest
RABBITMQ_VHOST=/

# JWT Configuration (for testing)
JWT_SECRET=your-jwt-secret-key

# Documentation Server (runs on different port)
DOCS_PORT=8081
```

**Port Configuration:**
- **Payment Service**: Port 8080 (main API)
- **Documentation Server**: Port 8081 (Swagger UI, ERD)
- **RabbitMQ**: Port 5672 (message queue)

### API Endpoints

#### Base URL
- **Local Development**: `http://localhost:8080`
- **Documentation**: `http://localhost:8081`

#### Authentication
All endpoints require Bearer JWT authentication:
```bash
Authorization: Bearer <your-jwt-token>
```

#### Key Headers
- **`Idempotency-Key`**: Required for POST endpoints to ensure idempotent requests
- **`X-Request-Id`**: Optional correlation ID for request tracing
- **`X-Correlation-ID`**: Alternative correlation ID header

#### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/payments` | Create a new payment |
| `GET` | `/payments/{id}` | Get payment by ID |
| `GET` | `/payments/user/{userId}` | Get user's payments |
| `POST` | `/payments/{id}/refund` | Create refund for payment |
| `GET` | `/refunds/{id}` | Get refund by ID |
| `GET` | `/methods/types` | Get payment method types |
| `POST` | `/methods` | Add payment method |
| `GET` | `/methods/user/{userId}` | Get user's payment methods |
| `GET` | `/health` | Health check |

### Response Format

#### Success Response
```json
{
  "data": {
    // Response payload specific to endpoint
  },
  "metadata": {
    "status": 200,
    "correlation_id": "abc-123-xyz"
  }
}
```

#### Error Response
```json
{
  "error": {
    "code": "INVALID_CURRENCY",
    "message": "Currency code must be a valid ISO 4217 code",
    "status": 400,
    "correlation_id": "abc-123-xyz",
    "details": {
      "field": "currency",
      "value": "INVALID",
      "constraint": "Must be a valid ISO 4217 currency code"
    }
  }
}
```

### Status Codes

| Code | Meaning |
|------|---------|
| 200 | OK |
| 201 | Created |
| 202 | Accepted |
| 204 | No Content |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict |
| 422 | Unprocessable Entity |
| 429 | Too Many Requests |
| 500 | Internal Server Error |
| 502 | Bad Gateway |
| 503 | Service Unavailable |
| 504 | Gateway Timeout |

### Postman Collection

Import the provided Postman collection for easy API testing:

1. **Collection**: `docs/payment-service.postman_collection.json`
2. **Environment**: `docs/payment-service.postman_environment.json`

#### Import Instructions:
1. Open Postman
2. Click "Import" → "Upload Files"
3. Select both JSON files
4. Set the environment variables in Postman
5. Start testing!

### Rate Limiting
- **100 requests per minute** per user
- **60 requests per minute** per IP address

### Development Mode
```bash
# Auto-restart on changes
npm run dev

# Documentation with auto-restart
npm run dev:docs
``` 

## Contribution

1. Create a feature branch from `main`:

```bash
git checkout -b feature/my-feature
```

2. Make changes, add tests if applicable.
3. Run `npm run lint`, `npm run typecheck`, and `npm test`.
4. Commit and push your branch:

```bash
git add .
git commit -m "Describe your changes"
git push origin feature/my-feature
```

5. Open a Pull Request (PR) for review and merging.

---

## Notes

* Coverage reports are generated locally in `coverage/` but are ignored in Git.
* Node.js version: v18+
* TypeScript version: 5.9+
* Vitest version: 3.2+
* ESLint version: 9.34+

```



