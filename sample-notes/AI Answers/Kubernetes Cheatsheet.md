# Kubernetes Cheatsheet

Quick reference distilled from an assistant conversation.

## Pods

```bash
kubectl get pods -A
kubectl logs -f deploy/api --tail=100
kubectl exec -it pod/api-7d9 -- sh
```

## Rollouts

1. `kubectl rollout status deploy/api`
2. `kubectl rollout undo deploy/api`

> **Tip:** keep manifests in Git and apply with `kubectl apply -k`.
