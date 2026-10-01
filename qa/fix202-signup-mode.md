# FIX 202 — "Create account" now opens a real sign-up form

**Reported:** 2026-10-01, with a screenshot of `arswine-tech-pro.pages.dev` on a phone.
**Symptom as described:** *"it confuses a new member that wants to create their account,
because when they click 'Create account' it doesn't pop up anything that indicates any
pop up card for registration because it uses the same 'sign in' text (or input field)."*
**Version:** `v251-signup-mode-2026-10-01`
**Files:** `index.html`, `app.js`, `app.css`, `qa/test-signup-mode.mjs` (new)

---

## What was wrong

There was no sign-up screen. There never had been.

```html
<button type="button" class="btn" onclick="login(event)">Sign in securely →</button>
<button type="button" class="btn ghost" onclick="registerAccount()">Create account</button>
```

`registerAccount()` read the **same two inputs** the sign-in form used:

```js
let email = document.querySelector('.login-card input[type="email"]')?.value...
```

So tapping **Create account** changed nothing a member could see:

* the heading still read **"Welcome Ka-Hog Mates!"**
* the sub-heading still read **"Sign in to access your farm workspace."**
* the same two boxes, the same labels, the same button
* no confirm-password, no indication a new account was being made
* and on an empty form, the only feedback was a **red** box — *"Enter an email and a
  password with at least 6 characters"* — which reads like a failed sign-in

That red box is what is on the screenshot. A new member reasonably concludes the app is
rejecting them, not that they are halfway through registering.

Three smaller faults in the same place:

* `<form onsubmit="login(event)">` was hard-wired, so pressing **Enter** while trying to
  register attempted to *sign in* with an account that did not exist yet;
* the one success case went through `showLoginError` — *"Account created! Please sign in
  with your password."* in the red failure box;
* one catch-all sentence covered three different mistakes (no email, no password, short
  password), and `"This email is already registered in Supabase"` leaked the backend's
  name at a farmer.

---

## The fix

One card, **two declared modes**, driven off `data-auth-mode` on the form. The cloud
functions underneath are untouched — it is still `ARSCloud.signIn` and `ARSCloud.signUp`,
still `finishAuthenticated()`.

### Everything the member reads follows the mode

|  | Sign in | Create account |
|---|---|---|
| Tabs | **Sign in** lit | **Create account** lit |
| Heading | Welcome Ka-Hog Mates! | **Create your account** |
| Sub-heading | Sign in to access your farm workspace. | **A few seconds and your farm workspace is yours.** |
| Password label | Password | **Choose a password** |
| Hint | — | **Use at least 6 characters…** |
| Confirm password | hidden | **shown** |
| Primary button | Sign in securely → | **Create my account →** |
| Secondary | New here? Create your account | **Already have an account? Sign in** |
| Forgot password? | shown | hidden |
| Footer | …cloud sync activates after administrator setup | **You set up your farm right after this step · no payment details needed** |
| `autocomplete` | `current-password` | `new-password` |

Mode-specific rows are plain markup (`.auth-only-signin` / `.auth-only-signup`) scoped by
CSS to `[data-auth-mode]`, so the HTML is the single source of truth and nothing is shown
or hidden by hand.

### Submit follows the mode

```js
function arsAuthSubmit(e) {
  if (e) e.preventDefault();
  return window.arsAuthMode === 'signup' ? registerAccount() : login(e);
}
```

Enter now registers while registering. The primary button also goes busy
(*"Creating your account…"*, disabled) for the duration of the call.

### One named problem at a time

| situation | before | now |
|---|---|---|
| no email | *Enter an email and a password with at least 6 characters.* | Enter the email address you want to use for your account. |
| bad email | (sent to the server) | That email address does not look right. Check it and try again. |
| no password | *Enter an email and a password with at least 6 characters.* | Choose a password for your new account. |
| 3-char password | *Enter an email and a password with at least 6 characters.* | Your password needs at least 6 characters — that one has 3. |
| mistyped confirm | *(no confirm field existed)* | The two passwords do not match. Re-type them and try again. |

### Good news is green

A new `.login-notice` box sits next to `.login-error`:

* **confirmation required** → the card flips back to sign-in with the email pre-filled and
  the password cleared: *"✓ Account created for you@farm.ph. Check your inbox (and spam
  folder) to confirm it, then sign in here."*
* **already registered** → the card flips to sign-in with the email carried over:
  *"you@farm.ph already has an account — signing you in instead. Enter your password, or
  tap 'Forgot password?'."* No mention of Supabase.

`clearLoginError()` clears the notice too, and `logout()` resets the card to sign-in so
nobody returns to a half-filled registration.

---

## QA

`node qa/test-signup-mode.mjs` — **62/62**

1. the shipped markup declares the mode, the tabs are a real `role="tablist"`, the
   hard-wired `onsubmit="login(event)"` is gone
2. one tap visibly becomes a registration form — heading, sub-heading, label, button,
   footer, tabs and `aria-selected` all verified
3. the registration form asks for a confirmed password
4. switching back restores every word of the sign-in copy
5. submit registers in sign-up mode and signs in in sign-in mode
6. each validation message is checked individually, and the old catch-all sentence is
   asserted **absent from the source**
7. a sign-up with a session reaches `finishAuthenticated()`
8. a sign-up awaiting confirmation returns to sign-in, pre-filled, green, with nobody
   let into a workspace
9. an already-registered email becomes guidance, with no Supabase jargon
10. sign-in is unchanged, FIX 108 wording included, and the button is handed back after
    the call

A `.auth-tab:focus-visible` rule was removed from `app.css` after
`test-neumorphic-ui.mjs` caught it: `neumorphic.css` owns the single `--neo-focus` ring
for every button in the app, and the tabs are buttons.

Whole suite: **13 files, 994 checks, all green.**
