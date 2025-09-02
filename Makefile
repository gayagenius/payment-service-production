# Usage:
# make build IMG=user/payment-service:latest
# make run IMG=user/payment-service:latest
# make push IMG=user/payment-service:latest
# make k8s-apply NAMESPACE=payment


IMG ?= user/payment-service:latest
NAMESPACE ?= payment


build:
docker build -t $(IMG) .


run:
docker run --rm -p 8080:8080 $(IMG)


push:
docker push $(IMG)


k8s-namespace:
kubectl get ns $(NAMESPACE) || kubectl create ns $(NAMESPACE)


k8s-apply: k8s-namespace
kubectl apply -k k8s -n $(NAMESPACE)


k8s-delete:
kubectl delete -k k8s -n $(NAMESPACE)


k8s-status:
kubectl get deploy,svc,hpa -n $(NAMESPACE)