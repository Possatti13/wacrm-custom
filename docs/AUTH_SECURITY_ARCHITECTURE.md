# CICLOPES — AUTH & TENANT SECURITY ARCHITECTURE (V1.7.1)

## 1. Identity vs. Membership vs. Profile vs. Account Contract

In Ciclopes V1, system concepts are strictly demarcated:

$$\text{Auth Identity} \neq \text{Profile} \neq \text{Membership} \neq \text{Account}$$

| Concept | Table / Location | Description & State on Uninvited Raw Signup |
| :--- | :--- | :--- |
| **IDENTITY** | `auth.users` | Cryptographic auth credentials. Created if Public Signup is ON; non-existent if Public Signup is OFF. |
| **PROFILE** | `public.profiles` | Public metadata row (`id`, `user_id`, `email`, `full_name`). On uninvited signup, an **Inert Profile** is created with `account_id = NULL` and `account_role = NULL`. |
| **MEMBERSHIP** | `profiles.account_role` | Active role binding to a tenant (`owner`, `admin`, `agent`, `viewer`). On uninvited signup: **NO MEMBERSHIP** (`null`). |
| **ACCOUNT** | `public.accounts` | Isolated tenant workspace. On uninvited signup: **0 ACCOUNTS CREATED**. |

---

## 2. Authentication Models

### MODEL A — TRUE CLOSED AUTH (Preferred Production Architecture)
- **Public Signup:** `OFF` (`enable_signup = false` in Supabase Auth config).
- **Random Visitor:** Attempting `POST /auth/v1/signup` is directly **REJECTED** by Supabase GoTrue Auth (`400 Bad Request / Signups not allowed`).
- **Identity Creation:** Exclusively executed server-side via `admin.createUser` / `admin.inviteUserByEmail` or administrative provisioning.
- **Email Ownership:** Mandatory verified email ownership before workspace access.
- **Residual Attack Surface:** 0 arbitrary `auth.users`.

### MODEL B — APPLICATION INVITE-ONLY (Fallback Architecture)
- **Public Signup:** `ON` (`enable_signup = true` in Supabase Auth config).
- **Random Visitor:** Can create an unconfirmed/confirmed raw identity in `auth.users`.
- **Isolation Enforcement:**
  - Raw identities receive an **Inert Profile** (`account_id = NULL`, `account_role = NULL`).
  - RLS blocks all tenant tables (`contacts`, `conversations`, `messages`, `deals`, `whatsapp_config`, `pipelines`).
  - Application shell displays the neutral Hellenic card **"Acesso Não Vinculado"**.
  - Internal APIs throw `ForbiddenError` (HTTP 403).
- **Email Ownership Gate:** `redeem_invitation` requires `email_confirmed_at IS NOT NULL` and `LOWER(email) = LOWER(invited_email)`.
- **Residual Attack Surface:** Arbitrary unattached `auth.users` identities in Supabase Auth internal table.

---

## 3. Verified Email Ownership (Migration 093)

To eliminate the **Email Matching vs. Email Ownership** vulnerability:
- `redeem_invitation` queries `email_confirmed_at` and `confirmed_at` from `auth.users`.
- If an unverified user attempts to redeem an invitation, the database raises exception `42501 (Email unverified)`.
- Even if an attacker registers an unconfirmed account using a victim's invited email address, they **CANNOT** claim the invitation without proving possession of the mailbox.

```
                    COLLABORATOR INVITATION
                              │
                              ▼
                  account_invitations created
                   (invited_email = 'user@co')
                              │
               ┌──────────────┴──────────────┐
               │                             │
       Attacker Unverified            Legitimate Recipient
     (email_confirmed_at = NULL)    (email_confirmed_at = NOW())
               │                             │
               ▼                             ▼
       redeem_invitation()           redeem_invitation()
               │                             │
               X                             ▼
      REJECTED (HTTP 403)              MEMBERSHIP GRANTED
      "Email unverified"             (account_id, server role)
```

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

- Creates confirmed auth user with `email_confirmed_at = NOW()`.
- Calls RPC `public.provision_new_account` (`SECURITY DEFINER` granted only to `service_role`).
- Sets `accounts.owner_user_id` and assigns `profiles.account_role = 'owner'`.
