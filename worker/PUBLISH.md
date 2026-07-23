# Endpoint `/publish` — configuración

Este worker expone ahora dos rutas:
- `POST /` (cualquier otro path) → reservas (sin cambios), reenvía por Resend.
- `POST /publish` → recibe contenido actualizado desde el panel admin, verifica
  el ID token de Firebase Auth de quien llama y commitea `content.json`
  (+ imágenes opcionales) al repo de GitHub, lo que dispara la GitHub Action
  de deploy.

## Secretos (nunca en wrangler.toml)

```bash
cd worker
wrangler secret put GITHUB_TOKEN
```

El token debe ser un **Personal Access Token** (fine-grained recomendado) con
permiso de **Contents: Read and write** sobre el repo configurado en `GITHUB_REPO`.

## Variables (no secretas, en `wrangler.toml` bajo `[vars]`)

- `GITHUB_REPO` — formato `owner/repo`, p.ej. `"tu-usuario/tu-repo"`.
- `GITHUB_BRANCH` — opcional, default `"main"`.
- `ALLOWED_PUBLISHER_EMAILS` — emails separados por coma que pueden publicar
  (se compara contra el claim `email` del ID token de Firebase, case-insensitive).
  Incluye `test@gmail.com` para pruebas y añade el/los email(s) reales del bar
  antes de dar acceso en producción. Si se deja vacía/no definida, no se aplica
  esta restricción adicional (no recomendado).

## Cómo funciona la verificación del token

1. El admin llama a `/publish` con `Authorization: Bearer <idToken>` (ID token
   de Firebase Auth del usuario logueado en el panel).
2. El worker descarga las claves públicas JWK de Google
   (`https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`),
   cacheándolas en el edge (Cache API, respeta el `Cache-Control` de Google)
   para no pedirlas en cada request.
3. Verifica la firma RS256 del JWT con WebCrypto contra la clave pública que
   corresponde al `kid` del header del token.
4. Verifica los claims: `aud === "kafe-143b5"`, `iss ===
   "https://securetoken.google.com/kafe-143b5"`, `exp` no expirado, `iat` no
   futuro (con 60s de margen de reloj) y `sub` no vacío.
5. Si la firma o cualquier claim no es válido → `401`.
6. Si `ALLOWED_PUBLISHER_EMAILS` está definida y el email del token no está en
   la lista → `403`.

## Body esperado

```json
{
  "content": { /* content.json completo actualizado */ },
  "images": [
    { "path": "imagenes/foo.jpg", "base64": "<base64 sin prefijo data:>" }
  ]
}
```

- `images` es opcional (puede omitirse o ir vacío).
- Cada `image.path` debe empezar por `imagenes/` y no contener `..`.
- El body completo se rechaza si supera ~10 MB.

## Checklist de pruebas manuales

Tras cada cambio en el worker, comprobar:

1. Que un ID token real de Firebase Auth (del proyecto `kafe-143b5`) es
   aceptado (200/success) y uno caducado o de otro proyecto es rechazado (401).
2. Que un email fuera de `ALLOWED_PUBLISHER_EMAILS` recibe 403.
3. Que el commit aparece en GitHub con `content.json` correctamente formateado
   (2 espacios de indentación) y que dispara la GitHub Action de deploy.
4. Que las reservas (`POST` a cualquier path que no sea `/publish`) siguen
   funcionando exactamente igual que antes.
5. Que un `image.path` con `..` o que no empiece por `imagenes/` es rechazado
   con 400 antes de llegar a GitHub.
