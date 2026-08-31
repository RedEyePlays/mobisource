// Grants the `staff` custom claim to a Firebase Auth user by email. This is
// the only thing that makes firestore.rules' isStaff() true for an account,
// and it's the only thing intakeDonor/createSku/etc. check to let a client
// call them — treat it like handing out an admin role.
//
// Local/emulator use (default, safe):
//   npm run emulators                              # in one terminal
//   node scripts/grantStaffClaim.js someone@example.com   # in another
//
// One-time production use: this script refuses to run unless
// FIREBASE_AUTH_EMULATOR_HOST is set, so it can't be pointed at a real
// project by accident. To grant yourself staff on the real project the
// first time (before any staff exist to do it through a proper admin
// tool), run it with --production and real credentials:
//
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
//     node scripts/grantStaffClaim.js you@example.com --production
//
// The service account needs Firebase Authentication Admin. Prefer doing
// this exactly once, then building a real staff-onboarding path instead
// of reaching for --production again.

import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const email = process.argv[2]
const isProduction = process.argv.includes('--production')

if (!email) {
  console.error('Usage: node scripts/grantStaffClaim.js <email> [--production]')
  process.exit(1)
}

if (!isProduction && !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error(
    'FIREBASE_AUTH_EMULATOR_HOST is not set — refusing to run. This sets a real ' +
      'custom claim via the admin SDK, bypassing security rules. Run `npm run emulators` ' +
      'first, or pass --production with real service account credentials if you mean it.',
  )
  process.exit(1)
}

if (isProduction && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error(
    'FIREBASE_AUTH_EMULATOR_HOST is set but --production was passed — refusing to run, ' +
      'since it is unclear which project this is meant to target. Unset it to target the ' +
      'real project.',
  )
  process.exit(1)
}

const app = initializeApp()
const auth = getAuth(app)

const user = await auth.getUserByEmail(email)
await auth.setCustomUserClaims(user.uid, { ...user.customClaims, staff: true })

console.log(`Granted staff claim to ${email} (${user.uid}).`)
