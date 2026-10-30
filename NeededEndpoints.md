
Admin Token:
- GET /api/v2/admin/accounts HTTP/1.1 (User token + `admin:read:accounts`)

Unrestricted:
- GET /api/v1/statuses HTTP/1.1
- GET /api/v1/accounts/:id/statuses HTTP/1.1
- GET /api/v1/timelines/public HTTP/1.1
  - This endpoint should always be called with local=true

Flow:
1. Fetch all accounts using [/api/v2/admin/accounts](https://docs.joinmastodon.org/methods/admin/accounts/#v2) limit is 100 accounts per request
2. for each account use [/api/v1/accounts/:id/statuses](https://docs.joinmastodon.org/methods/accounts/#statuses) this will give the fullest snapshot of data
3. build out the data structure using the list of accounts and statuses
4. Open up a data stream to watch for status updates, also use this to watch any new accounts being created.