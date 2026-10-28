# ADR-0006: Offline sync

- Status: Accepted (architecture offline sync design, unchanged by the revision)

## Decision

- Every local change writes the draft record and an outbox mutation in one IndexedDB transaction before the screen shows "Saved on this phone".
- Mutation envelope: `mutationId` (UUIDv7), `entityType`, `entityId` (UUIDv7, stable), `op`, `estateId`, `deviceId`, `schemaVersion`, `capturedAt`, `baseVersion`, `payload`, `payloadHash` (SHA-256).
- Push: batches of up to 100, exponential backoff with jitter, triggered on app open, focus, `online` and the Sync now button. No reliance on Background Sync.
- Server: each mutation is applied in its own transaction with its outbox event. `(device_id, mutation_id)` is unique; a repeat returns the stored acknowledgement. Results are per item: `accepted`, `rejected` (with error code and field errors) or `conflict` (with the server version).
- Conflicts are never silently resolved. Duplicate attendance for one worker and day (OC-103 open) creates a conflict record; a user with `conflicts.resolve` chooses with a reason and both versions are kept.
- The server rejects a mutation whose `capturedAt` is more than 10 minutes in the future (clock skew) and records server time alongside device time.
- Devices report their waiting count on each sync; reports show it separately from accepted data.
