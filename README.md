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



