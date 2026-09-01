# CICLOPES — AUTH & TENANT SECURITY ARCHITECTURE (V1.7.2)

## 1. Core Model: True Closed Auth (Model A)

In Ciclopes V1, security is enforced through two complementary layers:
1. **Infrastructure Boundary (Supabase GoTrue Auth)**:
   - `enable_signup = false` in Supabase Auth configuration.
   - Any raw, uninvited `POST /auth/v1/signup` is directly rejected at the HTTP gateway (`400 Bad Request / Signups not allowed for this instance`).
   - Creation of identities in `auth.users` occurs exclusively through server-side authorized invitations (`admin.inviteUserByEmail`).
2. **Database & Membership Boundary (PostgreSQL / Supabase DB)**:
   - `accounts.owner_user_id` is decoupled from initial creation (starts as `NULL` in `pending_owner_verification`).
   - `redeem_invitation` requires **proof of email ownership** (`email_confirmed_at IS NOT NULL`).
   - Direct PostgREST client tampering is blocked by the `tr_enforce_profile_privilege_columns` trigger.

$$\text{Identity Creation} \implies \text{Official Auth Invitation} \implies \text{Confirmed Email} \implies \text{Redeem Invitation} \implies \text{Tenant Membership}$$

---

## 2. Verified Owner Provisioning Flow (Migration 094)

Administrative owner onboarding is strictly protected against fake confirmations and email spoofing:

```
                  ADMINISTRATOR PROVISIONING
                             │
                             ▼
                provision_new_account(RPC)
                             │
            ┌────────────────┴────────────────┐
            │                                 │
    accounts created               account_invitations created
 (owner_user_id = NULL)                 (role = 'owner')
   [PENDING TENANT]                 [256-bit CSPRNG token]
            │                                 │
            └────────────────┬────────────────┘
                             │
                             ▼
                 Official Supabase Auth Invite
                    (sent to Owner email)
                             │
                             ▼
                 Owner opens email & verifies
                 (email_confirmed_at = NOW())
                             │
                             ▼
                    redeem_invitation()
                             │
            ┌────────────────┴────────────────┐
            │                                 │
  accounts.owner_user_id            profiles.account_role
    = owner_user_id                       = 'owner'
```

### Threat Mitigations:
- **Attacker knows CEO email**: If an attacker attempts to redeem the invitation or create an unconfirmed user, `redeem_invitation` checks `email_confirmed_at IS NOT NULL` $\to$ **REJECTED with HTTP 403 (Email unverified)**.
- **Attacker uses another verified account**: If an attacker redeems with a different confirmed email, `redeem_invitation` checks `LOWER(caller.email) = LOWER(invite.invited_email)` $\to$ **REJECTED with HTTP 400 (Email mismatch)**.
- **No fake admin confirmations**: `email_confirm: true` is eliminated from external provisioning scripts.

---

## 3. Verified Employee Invitation Flow (Migration 093)

1. Owner or Admin issues an invitation with `role: 'admin' | 'agent' | 'viewer'` and target `invited_email`.
2. Database persists token hash (`token_hash = SHA256(token)`) and `invited_email`.
3. Invitee receives link, confirms identity, and calls `redeem_invitation(token_hash)`.
4. Database validates:
   - Token not expired (`expires_at > NOW()`).
   - Token not used (`accepted_at IS NULL`).
   - Caller possesses confirmed email (`email_confirmed_at IS NOT NULL`).
   - Caller email matches `invited_email`.
5. Profile attached to target `account_id` with assigned `role`.

---

## 4. Summary Truth Table

| Scenario | Raw Signup | Profile Created | Account Created | Membership | Product Access |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Random Visitor (Model A)** | **REJECTED** | None | 0 | None | **BLOCKED** |
| **Unverified Attacker (matching invited email)** | N/A | Inert | 0 | None | **REJECTED (403)** |
| **Confirmed Imposter (mismatched email)** | N/A | Inert | 0 | None | **REJECTED (400)** |
| **Verified Invited Member** | N/A | Linked | Existing | Server Role | **ALLOWED** |
| **Verified Provisioned Owner** | N/A | Linked | New Tenant | Owner | **ALLOWED** |
