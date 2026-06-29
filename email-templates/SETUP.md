# Branded Warr.GG emails (custom sender + templates)

Goal: auth emails come from **Warr.GG via your domain** (e.g. `noreply@warr-gg.one`) instead of Supabase's default address, and look on-brand.

There are two parts. You do Part 1 & 2 (provider + DNS + Supabase settings — they need your logins). I've already built Part 3 (the templates) — you just paste them.

---

## Part 1 — Email provider (Resend, free tier)

1. Sign up at **resend.com** (free: 3,000 emails/mo, 100/day — plenty for auth).
2. Resend → **Domains → Add Domain** → enter `warr-gg.one`.
3. Resend shows DNS records to add (an **MX**, an **SPF/TXT**, and **DKIM** CNAME/TXT records). Keep that tab open.

## Part 2 — Add the DNS records (in Netlify DNS)

Your DNS is at **Netlify** (NS1). For each record Resend gave you:
- Netlify → **DNS** (left sidebar) → **warr-gg.one** → **Add new record**.
- Match the **type / name / value** exactly from Resend (DKIM is usually a TXT or CNAME; SPF is a TXT like `v=spf1 include:...`).
- Save each one. Back in Resend, click **Verify** — wait a few minutes; it goes green when DNS propagates.

> Tip: if a host name from Resend ends in `.warr-gg.one`, in Netlify enter only the part **before** `.warr-gg.one` as the Name (e.g. `resend._domainkey`).

## Part 3 — Point Supabase at Resend (custom SMTP)

1. In Resend → **API Keys → Create** (or use the SMTP credentials Resend provides).
2. Supabase → **Project Settings → Authentication → SMTP Settings** → **Enable custom SMTP**:
   - **Host:** `smtp.resend.com`
   - **Port:** `465` (SSL) or `587`
   - **Username:** `resend`
   - **Password:** your Resend API key
   - **Sender email:** `noreply@warr-gg.one`  (must be on the verified domain)
   - **Sender name:** `Warr.GG`
3. Save.

## Part 4 — Paste the branded templates

Supabase → **Authentication → Email Templates**. For each, paste the matching file from this folder and set the subject:

| Supabase template | File | Suggested subject |
|---|---|---|
| Confirm signup | `confirm-signup.html` | Confirm your Warr.GG account |
| Magic Link | `magic-link.html` | Your Warr.GG sign-in link |
| Reset Password | `reset-password.html` | Reset your Warr.GG password |

Each template keeps the Supabase variable `{{ .ConfirmationURL }}`, so the links work unchanged.

---

## Done — verify
1. Sign up with a test email → the confirmation email should arrive **from `Warr.GG <noreply@warr-gg.one>`**, branded, and land in the inbox (not spam).
2. Once this works, you can safely keep **email confirmation ON** in Supabase (Authentication → Sign In → Email) — new users will reliably get the confirm link, so the "can't access Scout/AI Battle" issue is solved.

If a test email still lands in spam, double-check the DKIM/SPF records show **Verified** in Resend.
