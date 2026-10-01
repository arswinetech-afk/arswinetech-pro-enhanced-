/*
 * [FIX 202] "Create account" must open a registration form, not reuse the sign-in one.
 *
 * Reported from the field (arswine-tech-pro.pages.dev, 2026-10-01): a new member taps
 * "Create account" and nothing appears to happen. The card still reads "Welcome Ka-Hog
 * Mates! / Sign in to access your farm workspace", the same two boxes sit there, and the
 * only feedback is a red box saying "Enter an email and a password with at least 6
 * characters" — which looks like a failed sign-in, not a registration form. There was
 * never a sign-up screen: the button simply called registerAccount() against the sign-in
 * inputs.
 *
 * The card now has a declared mode. The tabs, heading, sub-heading, password label,
 * primary button, footer link, helper text and the confirm-password row all follow it —
 * and the cloud calls underneath (ARSCloud.signIn / ARSCloud.signUp) are unchanged.
 *
 * Run:  node qa/test-signup-mode.mjs
 *
 * Must stay true:
 *   1. the card ships in sign-in mode and looks exactly like it always did
 *   2. one tap on "Create account" visibly becomes a registration form
 *   3. the registration form asks for a confirmed password
 *   4. going back to sign-in restores every word of the sign-in copy
 *   5. Enter / submit registers while in sign-up mode (it used to sign in)
 *   6. registration refuses one named problem at a time, not one catch-all sentence
 *   7. a successful sign-up with a session goes straight into the workspace
 *   8. a sign-up that needs email confirmation returns to sign-in, pre-filled, in GREEN
 *   9. an already-registered email is handed to sign-in instead of being an error
 *  10. signing in is untouched by all of it
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = [path.join(ROOT, 'app.js'), path.join(ROOT, 'js', 'app.js')].find(p => fs.existsSync(p));
const HTML = path.join(ROOT, 'index.html');
const CSS = path.join(ROOT, 'app.css');
if (!APP) { console.error('app.js not found'); process.exit(1); }

let failures = 0, checks = 0;
const ok = (name, cond, extra = '') => {
  checks++;
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
};

const html = fs.readFileSync(HTML, 'utf8');
const css = fs.readFileSync(CSS, 'utf8');

/* ── a DOM just real enough for the login card ────────────────────────────────
   Elements are looked up by id, carry textContent / value / dataset / classList
   and a tiny attribute map — which is all setAuthMode and registerAccount touch. */
function makeEl(id, tag = 'div') {
  return {
    id, tagName: tag, textContent: '', value: '', disabled: false,
    style: {}, dataset: {}, attrs: {},
    _cls: new Set(),
    classList: {
      add(c) { this._o._cls.add(c); },
      remove(c) { this._o._cls.delete(c); },
      contains(c) { return this._o._cls.has(c); },
      toggle(c, on) { if (on === undefined) on = !this._o._cls.has(c); on ? this._o._cls.add(c) : this._o._cls.delete(c); return on; }
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    focus() { this._focused = true; },
    querySelector: () => null,
    querySelectorAll: () => []
  };
}

function boot() {
  const els = new Map();
  const el = (id, tag) => {
    if (!els.has(id)) { const e = makeEl(id, tag); e.classList._o = e; els.set(id, e); }
    return els.get(id);
  };
  /* the ids the card actually ships with */
  ['loginCard', 'authTitle', 'authSubtitle', 'authPasswordLabel', 'authPrimaryBtn', 'authSwitchBtn',
    'authHelp', 'authTabSignin', 'authTabSignup', 'loginEmailInput', 'loginPasswordInput',
    'loginConfirmInput', 'loginError', 'loginNotice', 'authStatus'].forEach(id => el(id));
  el('authTabSignin').classList.add('is-on');
  el('loginCard').dataset.authMode = 'signin';

  const calls = { signIn: [], signUp: [], finished: [] };
  const ctx = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, isFinite, parseInt, parseFloat, RegExp, Promise, Error, Set, Map, Symbol,
    setTimeout: (fn) => { try { fn && fn(); } catch (_) {} return 0; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { userAgent: 'node', onLine: true },
    location: { href: 'https://arswine-tech-pro.pages.dev/', origin: 'https://arswine-tech-pro.pages.dev', pathname: '/' },
    document: {
      getElementById: (id) => (els.has(id) ? els.get(id) : null),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      body: makeEl('body', 'body'),
      documentElement: makeEl('html', 'html')
    },
    __calls: calls, __els: els
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);

  /* only the auth slice of app.js is under test — lift it out rather than boot
     the whole 4,000-line app and its farm machinery */
  const src = fs.readFileSync(APP, 'utf8');
  const slice = (startMarker, endMarker) => {
    const a = src.indexOf(startMarker);
    const b = src.indexOf(endMarker, a);
    if (a < 0 || b < 0) throw new Error(`cannot slice ${startMarker}`);
    return src.slice(a, b);
  };
  const code = [
    slice('function showLoginError(message)', 'function authError('),
    slice('/* ── [FIX 202] sign in / create account', 'function showResetRequest()')
  ].join('\n');

  ctx.ARSCloud = {
    signIn: async (e, p) => { calls.signIn.push([e, p]); if (ctx.__signInThrows) throw new Error(ctx.__signInThrows); return { access_token: 't' }; },
    signUp: async (e, p) => { calls.signUp.push([e, p]); if (ctx.__signUpThrows) throw new Error(ctx.__signUpThrows); return ctx.__signUpResult ?? { access_token: 'tok', session: { access_token: 'tok' } }; }
  };
  ctx.finishAuthenticated = async (email) => { calls.finished.push(email); return true; };

  vm.runInContext(code, ctx, { filename: 'app.js#auth' });

  ctx.txt = id => String((els.get(id) || {}).textContent || '');
  ctx.val = id => String((els.get(id) || {}).value || '');
  ctx.mode = () => String(els.get('loginCard').dataset.authMode || '');
  ctx.errShown = () => els.get('loginError')._cls.has('show');
  ctx.noticeShown = () => els.get('loginNotice')._cls.has('show');
  ctx.type = (id, v) => { els.get(id).value = v; };
  return ctx;
}

/* ══ 1. the shipped markup ════════════════════════════════════════════════════ */
{
  console.log('\n[1] The card ships in sign-in mode');
  ok('[1] the card declares a mode in the markup', /id="loginCard"[^>]*data-auth-mode="signin"/.test(html));
  const signinTab = (html.match(/<button[^>]*id="authTabSignin"[^>]*>/) || [''])[0];
  ok('[1] there are two tabs, sign-in pre-selected',
    /class="auth-tab is-on"/.test(signinTab) && /id="authTabSignup"/.test(html), signinTab);
  ok('[1] the tabs are a real tablist for screen readers',
    /role="tablist"/.test(html) && (html.match(/role="tab"/g) || []).length === 2);
  ok('[1] the old hard-wired onsubmit="login(event)" is gone', !/onsubmit="login\(event\)"/.test(html));
  ok('[1] the form submits through the mode dispatcher', /onsubmit="arsAuthSubmit\(event\)"/.test(html));
  ok('[1] the sign-up only rows are marked as such', (html.match(/auth-only-signup/g) || []).length >= 3);
  ok('[1] "Forgot password?" is a sign-in only row', /class="link-btn auth-only-signin"/.test(html));
  ok('[1] a confirm-password box exists in the markup', /id="loginConfirmInput"/.test(html));
  ok('[1] and a green notice box next to the red one', /id="loginNotice"/.test(html) && /id="loginError"/.test(html));
  ok('[1] CSS hides sign-up rows while signing in', /\.login-card\[data-auth-mode="signin"\] \.auth-only-signup\{display:none\}/.test(css));
  ok('[1] CSS hides sign-in rows while registering', /\.login-card\[data-auth-mode="signup"\] \.auth-only-signin\{display:none\}/.test(css));
  ok('[1] the notice box is styled green, not red', /\.login-notice\{[^}]*rgba\(18,92,66/.test(css));
  ok('[1] the tabs have a light-theme skin too', /\.light-theme \.auth-tab\.is-on\{/.test(css));
}

/* ══ 2–4. the mode switch ═════════════════════════════════════════════════════ */
{
  console.log('\n[2] One tap on "Create account" becomes a registration form');
  const ctx = boot();
  ok('[2] it starts in sign-in mode', ctx.arsAuthMode === 'signin' && ctx.mode() === 'signin');

  ctx.toggleAuthMode();
  ok('[2] the card switches to sign-up mode', ctx.mode() === 'signup' && ctx.arsAuthMode === 'signup');
  ok('[2] the heading stops saying "Welcome Ka-Hog Mates!"', ctx.txt('authTitle') === 'Create your account', ctx.txt('authTitle'));
  ok('[2] the sub-heading stops saying "Sign in to access your farm workspace"',
    !/sign in/i.test(ctx.txt('authSubtitle')), ctx.txt('authSubtitle'));
  ok('[2] the password label becomes a choice, not a recall', ctx.txt('authPasswordLabel') === 'Choose a password', ctx.txt('authPasswordLabel'));
  ok('[2] the primary button says what it will do', ctx.txt('authPrimaryBtn') === 'Create my account →', ctx.txt('authPrimaryBtn'));
  ok('[2] the secondary link offers the way back', /Already have an account/.test(ctx.txt('authSwitchBtn')), ctx.txt('authSwitchBtn'));
  ok('[2] the footer help changes with it', /no payment details/.test(ctx.txt('authHelp')), ctx.txt('authHelp'));
  ok('[2] the sign-up tab is the lit one', ctx.__els.get('authTabSignup')._cls.has('is-on') && !ctx.__els.get('authTabSignin')._cls.has('is-on'));
  ok('[2] aria-selected follows the tabs', ctx.__els.get('authTabSignup').getAttribute('aria-selected') === 'true' && ctx.__els.get('authTabSignin').getAttribute('aria-selected') === 'false');
  ok('[3] the password box is told it is a new password', ctx.__els.get('loginPasswordInput').getAttribute('autocomplete') === 'new-password');

  console.log('\n[4] And back again');
  ctx.toggleAuthMode();
  ok('[4] the card returns to sign-in mode', ctx.mode() === 'signin');
  ok('[4] with the original heading', ctx.txt('authTitle') === 'Welcome Ka-Hog Mates!', ctx.txt('authTitle'));
  ok('[4] the original sub-heading', ctx.txt('authSubtitle') === 'Sign in to access your farm workspace.', ctx.txt('authSubtitle'));
  ok('[4] the original button', ctx.txt('authPrimaryBtn') === 'Sign in securely →', ctx.txt('authPrimaryBtn'));
  ok('[4] the original footer help', /administrator setup/.test(ctx.txt('authHelp')), ctx.txt('authHelp'));
  ok('[4] and the password box is a recalled one again', ctx.__els.get('loginPasswordInput').getAttribute('autocomplete') === 'current-password');
}

/* ══ 5. Enter does the right thing in each mode ═══════════════════════════════ */
{
  console.log('\n[5] Submitting the form follows the mode');
  const ctx = boot();
  ctx.type('loginEmailInput', 'mang.tonyo@farm.ph');
  ctx.type('loginPasswordInput', 'bukidnon1');
  await ctx.arsAuthSubmit({ preventDefault() {} });
  ok('[5] in sign-in mode it signs in', ctx.__calls.signIn.length === 1 && ctx.__calls.signUp.length === 0);

  ctx.setAuthMode('signup');
  ctx.type('loginConfirmInput', 'bukidnon1');
  await ctx.arsAuthSubmit({ preventDefault() {} });
  ok('[5] in sign-up mode it registers — it used to sign in', ctx.__calls.signUp.length === 1, JSON.stringify(ctx.__calls.signUp));
  ok('[5] with the email and password that were typed',
    ctx.__calls.signUp[0][0] === 'mang.tonyo@farm.ph' && ctx.__calls.signUp[0][1] === 'bukidnon1');
}

/* ══ 6. one named problem at a time ═══════════════════════════════════════════ */
{
  console.log('\n[6] Registration names the one thing that is wrong');
  const ctx = boot();
  ctx.setAuthMode('signup');

  await ctx.registerAccount();
  ok('[6] empty form asks for the email first', /email address you want to use/i.test(ctx.txt('loginError')), ctx.txt('loginError'));
  ok('[6] and nothing is sent to the cloud', ctx.__calls.signUp.length === 0);

  ctx.type('loginEmailInput', 'not-an-email');
  await ctx.registerAccount();
  ok('[6] a malformed email is caught before the network', /does not look right/i.test(ctx.txt('loginError')), ctx.txt('loginError'));

  ctx.type('loginEmailInput', 'mang.tonyo@farm.ph');
  await ctx.registerAccount();
  ok('[6] then it asks for a password', /Choose a password/i.test(ctx.txt('loginError')), ctx.txt('loginError'));

  ctx.type('loginPasswordInput', 'abc');
  await ctx.registerAccount();
  ok('[6] a short password is counted back to the member', /at least 6 characters.*has 3/i.test(ctx.txt('loginError')), ctx.txt('loginError'));

  ctx.type('loginPasswordInput', 'bukidnon1');
  ctx.type('loginConfirmInput', 'bukidnon2');
  await ctx.registerAccount();
  ok('[6] a mistyped confirmation is caught', /do not match/i.test(ctx.txt('loginError')), ctx.txt('loginError'));
  ok('[6] still nothing sent to the cloud', ctx.__calls.signUp.length === 0);

  ctx.type('loginConfirmInput', 'bukidnon1');
  await ctx.registerAccount();
  ok('[6] a complete form finally registers', ctx.__calls.signUp.length === 1);
  ok('[6] the old catch-all sentence is gone from the source',
    !fs.readFileSync(APP, 'utf8').includes('Enter an email and a password with at least 6 characters.'));
}

/* ══ 7. straight into the workspace ═══════════════════════════════════════════ */
{
  console.log('\n[7] A sign-up that returns a session opens the workspace');
  const ctx = boot();
  ctx.setAuthMode('signup');
  ctx.type('loginEmailInput', 'new.farmer@farm.ph');
  ctx.type('loginPasswordInput', 'bukidnon1');
  ctx.type('loginConfirmInput', 'bukidnon1');
  await ctx.registerAccount();
  ok('[7] the verified session path is used', ctx.__calls.finished.length === 1 && ctx.__calls.finished[0] === 'new.farmer@farm.ph');
  ok('[7] no error is shown', !ctx.errShown(), ctx.txt('loginError'));
}

/* ══ 8. email confirmation required ═══════════════════════════════════════════ */
{
  console.log('\n[8] A sign-up awaiting confirmation hands back to sign-in, in green');
  const ctx = boot();
  ctx.__signUpResult = { user: { id: 'u1' } };   // no session: confirmation on
  ctx.setAuthMode('signup');
  ctx.type('loginEmailInput', 'new.farmer@farm.ph');
  ctx.type('loginPasswordInput', 'bukidnon1');
  ctx.type('loginConfirmInput', 'bukidnon1');
  await ctx.registerAccount();

  ok('[8] the card is back on the sign-in side', ctx.mode() === 'signin');
  ok('[8] the good news is GREEN, not the red error box', ctx.noticeShown() && !ctx.errShown(), `notice=${ctx.noticeShown()} error=${ctx.txt('loginError')}`);
  ok('[8] it confirms the account was created', /Account created/i.test(ctx.txt('loginNotice')), ctx.txt('loginNotice'));
  ok('[8] it names the inbox to check', /spam folder/i.test(ctx.txt('loginNotice')), ctx.txt('loginNotice'));
  ok('[8] the email is left filled in', ctx.val('loginEmailInput') === 'new.farmer@farm.ph');
  ok('[8] the password box is cleared for the real sign-in', ctx.val('loginPasswordInput') === '');
  ok('[8] nobody is let into a workspace', ctx.__calls.finished.length === 0);
}

/* ══ 9. already registered ════════════════════════════════════════════════════ */
{
  console.log('\n[9] An email that already has an account is handed to sign-in');
  const ctx = boot();
  ctx.__signUpThrows = 'User already registered';
  ctx.setAuthMode('signup');
  ctx.type('loginEmailInput', 'mang.tonyo@farm.ph');
  ctx.type('loginPasswordInput', 'bukidnon1');
  ctx.type('loginConfirmInput', 'bukidnon1');
  await ctx.registerAccount();

  ok('[9] the card switches to sign-in for them', ctx.mode() === 'signin');
  ok('[9] the email is carried over', ctx.val('loginEmailInput') === 'mang.tonyo@farm.ph');
  ok('[9] it reads as guidance, not a failure', ctx.noticeShown() && !ctx.errShown(), ctx.txt('loginError'));
  ok('[9] and it points at the reset link', /Forgot password/i.test(ctx.txt('loginNotice')), ctx.txt('loginNotice'));
  ok('[9] no Supabase jargon reaches the farmer', !/supabase/i.test(ctx.txt('loginNotice')), ctx.txt('loginNotice'));
}

/* ══ 10. signing in is untouched ══════════════════════════════════════════════ */
{
  console.log('\n[10] Sign-in behaves exactly as before');
  const ctx = boot();
  await ctx.login({ preventDefault() {} });
  ok('[10] an empty form still asks for both boxes', /Enter your email address and password/.test(ctx.txt('loginError')), ctx.txt('loginError'));

  ctx.type('loginEmailInput', 'mang.tonyo@farm.ph');
  ctx.type('loginPasswordInput', 'wrong');
  ctx.__signInThrows = 'Invalid login credentials';
  await ctx.login({ preventDefault() {} });
  ok('[10] FIX 108 wording survives', /Wrong email or password/.test(ctx.txt('loginError')), ctx.txt('loginError'));
  ok('[10] and still points at the reset link', /Forgot password/.test(ctx.txt('loginError')));

  ctx.__signInThrows = null;
  ctx.type('loginPasswordInput', 'bukidnon1');
  await ctx.login({ preventDefault() {} });
  ok('[10] a good password opens the workspace', ctx.__calls.finished.length === 1);
  ok('[10] the button is handed back after the call', ctx.__els.get('authPrimaryBtn').disabled === false);
  ok('[10] and reads normally again', ctx.txt('authPrimaryBtn') === 'Sign in securely →', ctx.txt('authPrimaryBtn'));
}

console.log(`\n${failures ? 'FAILED' : 'OK'} — ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
