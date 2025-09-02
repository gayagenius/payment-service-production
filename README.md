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