# CICLOPES — AUTH & TENANT SECURITY ARCHITECTURE (V1.7.0)

## 1. Identity vs. Membership Separation

In Ciclopes V1, authentication identity is strictly decoupled from workspace membership and tenant access:

$$\text{Auth Identity} \neq \text{Ciclopes Tenant Membership}$$

1. **Auth Identity (`auth.users`)**:
   - Represents a cryptographic identity managed by Supabase Auth (email, password hash, metadata).
   - Creation of an `auth.users` row (e.g. via direct public API or uninvited signup) **NEVER** creates an account, workspace, company, or owner role.
   - Uninvited signups produce an **Inert User Profile** (`profiles.account_id = NULL`, `profiles.account_role = NULL`).

2. **Inert User State**:
   - Inert users can establish a Supabase Auth session, but have zero access to any tenant data.
   - RLS on all operational tables (`contacts`, `conversations`, `messages`, `deals`, `whatsapp_config`, `pipelines`, etc.) evaluates `is_account_member(account_id)` $\to$ `false`.
   - Application route guards and `DashboardShellInner` detect `account_id === null` and render the neutral **"Acesso Não Vinculado"** card, preventing navigation into `/inbox`, `/dashboard`, `/pipeline`, `/settings`, or `/onboarding`.
   - Internal API endpoints calling `getCurrentAccount()` or `requireRole(...)` throw `ForbiddenError` (HTTP 403).

3. **Workspace Membership (`profiles`)**:
   - Membership is established exclusively through two authorized channels:
     - **Invited Member**: Redeeming an authorized cryptographic invitation link (`redeem_invitation`).
     - **Tenant Owner**: Administrative server-side provisioning (`scripts/provision-owner.mjs` / `provision_new_account`).

---

## 2. True Invite-Only Architecture

```
                       INTERNET / VISITOR
                               │
                               ▼
                       Supabase Auth User
                               │
                ┌──────────────┴──────────────┐
                │                             │
          Sem Convite                   Convite Válido
                │                             │
                ▼                             ▼
         INERT USER PROFILE           redeem_invitation()
     (account_id = NULL)                      │
                │                             ▼
                X                     MEMBERSHIP ATTACHED
       PRODUTO BLOQUEADO            (Target account_id, role)
```

### Invitation Security Model
- **Token Entropy**: 32 bytes CSPRNG (`crypto.randomBytes(32).toString('base64url')` $\approx$ 256 bits of entropy).
- **Zero Raw Tokens at Rest**: The plaintext token is shown to the administrator exactly once. The database persists only `token_hash = SHA-256(token)`.
- **Atomic Locking**: `redeem_invitation` locks the `account_invitations` row `FOR UPDATE`, eliminating concurrent double-redemption race conditions.
- **Email Binding**: If an invitation specifies `invited_email`, `redeem_invitation` strictly enforces `LOWER(caller.email) = LOWER(invite.invited_email)`.
- **Server-Dictated Roles**: The assigned role is loaded strictly from `account_invitations.role` in the database; client-supplied role parameters are ignored.
- **Data Orphan Protection**: If a caller already owns domain data or belongs to another shared tenant, redemption is rejected (`SQLSTATE 23505`).

---

## 3. Privilege Escalation Defense

To prevent direct REST tampering via Supabase client:
- **Trigger `tr_enforce_profile_privilege_columns`**:
  - Attached to `profiles` as `BEFORE INSERT OR UPDATE`.
  - Runs as `SECURITY INVOKER`.
  - When the executing client is `authenticated` or `anon`, any attempt to set or modify `account_id` or `account_role` raises exception `42501 (Privilege escalation)`.
  - Legitimate modifications occur strictly inside `SECURITY DEFINER` functions owned by `postgres` (`redeem_invitation`, `provision_new_account`) or backend processes running as `service_role`.

---

## 4. Administrative Owner Provisioning

New tenant accounts and their initial Owners are provisioned through a controlled server-side CLI:

```bash
node scripts/provision-owner.mjs \
  --account-name="Nome da Empresa" \
  --owner-email="owner@empresa.com" \
  --owner-name="Nome do Proprietário" \
  --currency="BRL" \
  --timezone="America/Sao_Paulo"
```

### Safety Features
- **Dry-run mode**: `--dry-run` flag validates input without modifying the database.
- **Service Role Isolation**: Uses `SUPABASE_SERVICE_ROLE_KEY` server-side only; never bundled into client assets.
- **Idempotency**: Links existing auth identities or creates confirmed auth users with full name metadata.
- **Zero Secret Logging**: Outputs masked emails and IDs (`te***@empresa.com`).

---

## 5. Summary of Roles

| Role | Operational Scope | Can Manage Team? | Can Access Settings? | Account Creation |
| :--- | :--- | :--- | :--- | :--- |
| **Owner** | Full read/write across tenant data | Yes (Admin & Members) | Yes | Controlled Admin Provisioning |
| **Admin** | Full read/write across tenant data | Yes (Agents & Viewers) | Yes | No |
| **Agent** | Read/write operational records | No | No | No |
| **Viewer** | Read-only across tenant records | No | No | No |
| **Inert** | **ZERO ACCESS** | No | No | No |
