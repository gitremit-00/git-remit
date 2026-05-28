# How to Create an Admin Account

## Step 1 — Create the Auth User in Supabase

1. Go to your **Supabase Dashboard**
2. Navigate to **Authentication → Users**
3. Click **"Add user"**
4. Fill in:
   - **Email** — e.g. `admin@remitsafe.com`
   - **Password** — must meet the app's requirements (8+ chars, uppercase, lowercase, number, special character)
5. Tick **"Auto Confirm User"** so email verification is skipped
6. Click **Create User**
7. Copy the **UUID** shown in the user row (you'll need it in Step 2)

---

## Step 2 — Insert the Profile Row

Open **Supabase SQL Editor** and run the following, replacing the placeholder values with your own:

```sql
INSERT INTO public.profiles (
  id,
  username,
  role,
  full_name,
  phone_number,
  email,
  country_of_work,
  country_of_origin,
  gov_id_type,
  id_number,
  gov_id_photo_url,
  email_verified
) VALUES (
  'paste-uuid-here',        -- UUID from Step 1
  'admin',                  -- unique username
  'admin',                  -- must be exactly 'admin'
  'RemitSafe Admin',        -- display name
  '+639000000000',          -- phone number
  'admin@remitsafe.com',    -- must match the auth user email
  'Philippines',            -- country of work
  'Philippines',            -- country of origin
  'Passport',               -- gov ID type
  'ADMIN-001',              -- gov ID number
  'https://placeholder.com',-- gov ID photo URL (placeholder is fine for admin)
  true                      -- email verified
);
```

---

## Step 3 — Log In

Go to `/login` and sign in with the email and password you set in Step 1.

You will be automatically redirected to `/admin`.

---

## Promoting an Existing User to Admin

If you already have a registered account and just want to make it an admin, run this in SQL Editor:

```sql
UPDATE public.profiles
SET role = 'admin'
WHERE email = 'your@email.com';
```

Then log out and log back in.

---

## Reverting Admin Back to Sender

```sql
UPDATE public.profiles
SET role = 'ofw_sender'
WHERE email = 'your@email.com';
```

---

## Notes

- The `role` column must be exactly `'admin'` — the login route reads this value directly from the `profiles` table.
- The admin account does **not** need a MetaMask wallet to access the admin dashboard.
- Admin users are blocked from accessing sender and merchant routes by the middleware.
