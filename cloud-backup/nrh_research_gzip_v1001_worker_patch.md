# Niji Research Helper gzip backup Worker patch (dbVersion 1001)

## Cause
Niji Research Helper v1.0.109+ uses dbVersion=1001 with a `gzip-base64-v1` envelope after its merged research JSON exceeds 16 MiB. The 2026-09-18 backup Worker only accepts dbVersion===1 on POST /v1/backups, so it responds with HTTP 400 `invalid_backup_format`.

## Important
This repository does **not** contain the current deployed Worker. Do not deploy the historical full Worker source: it can remove later routes such as `/v1/app-backups/`. First back up the currently deployed code in Cloudflare Workers & Pages > `niji-research-backup` > Edit code. Replace **only** the validation block beginning `if (payload.app !== 'Niji Research Helper' || payload.dbVersion !== 1 ||` and ending at the `invalid_backup_format` response.

## Drop-in replacement (within POST /v1/backups)
```js
    // Keep old plain v1 backups valid, while accepting compressed v1001.
    // Do NOT label compressedResearch as dbVersion=1.
    const v1 = payload?.app === 'Niji Research Helper' &&
      payload.dbVersion === 1 && !payload.compressedResearch &&
      !!payload.stores && STORES.every(s => Array.isArray(payload.stores[s])) &&
      payload.sourceOrigin === origin && payload.device === device;
    const pack = payload?.compressedResearch;
    const packedText = pack?.payload;
    const v1001 = payload?.app === 'Niji Research Helper' &&
      payload.dbVersion === 1001 &&
      payload.sourceOrigin === origin && payload.device === device &&
      !!payload.stores &&
      STORES.every(s => Array.isArray(payload.stores[s]) && payload.stores[s].length === 0) &&
      payload.preferences && typeof payload.preferences === 'object' &&
      !Array.isArray(payload.preferences) && Object.keys(payload.preferences).length === 0 &&
      pack?.format === 'gzip-base64-v1' &&
      Number.isSafeInteger(pack.originalBytes) &&
      pack.originalBytes > 0 && pack.originalBytes <= 150 * 1024 * 1024 &&
      /^[a-f0-9]{64}$/i.test(String(pack.originalSha256 || '')) &&
      typeof packedText === 'string' &&
      packedText.length >= 8 && packedText.length % 4 === 0 &&
      packedText.length <= Math.ceil(LIMIT_BYTES / 3) * 4 + 8 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(packedText) &&
      (() => {
        try {
          const prefix = atob(packedText.slice(0, 8));
          return prefix.charCodeAt(0) === 0x1f &&
            prefix.charCodeAt(1) === 0x8b &&
            prefix.charCodeAt(2) === 0x08;
        } catch { return false; }
      })();
    if (!v1 && !v1001) {
      return json({ok:false,error:'invalid_backup_format'},400,corsOrigin);
    }
```

The preexisting authorization, origin verification, request body SHA256 and 20MiB size limit must remain unchanged. The client reads back the uploaded envelope and verifies the uncompressed SHA256 and full research DB row counts. The Worker only checks the gzip signature and envelope here, avoiding potentially huge in-memory decompression.

## After deployment
1. Ensure the current Worker code is backed up.
2. Deploy this *validation-only* patch, not the historical complete Worker.
3. In YouTube Niji Cloud, retry a **manual** complete backup.
4. Confirm the UI shows saved and read-back verification succeeds, and old v1 backups are still listed and downloadable.
5. Never delete IndexedDB or historical pCloud backups to resolve this error.

Verified locally with Node syntax check and 11 pure validation cases. Live Cloudflare Worker behavior is not tested; this file is a patch proposal, not deployment.
