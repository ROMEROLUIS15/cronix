import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const TEST_EMAIL = process.env.E2E_TEST_EMAIL    ?? 'test-e2e@cronix.com'
const TEST_PASS  = process.env.E2E_TEST_PASSWORD ?? 'test-password-e2e-123!'
const TEST_BIZ   = 'E2E Test Business'
const TEST_SLUG  = 'e2e-test'

async function setupTestData() {
  console.log('🚀 Setting up E2E test data...')
  console.log(`   Email: ${TEST_EMAIL}`)

  // ── Step 1: Find or create the Auth user ──────────────────────────────────
  // The problem with admin.createUser: Supabase has a trigger on auth.users
  // that auto-inserts into public.users. If that trigger requires business_id
  // to be non-null (via FK or NOT NULL constraint), it will fail and roll back.
  //
  // Strategy: try createUser → if DB trigger error, try updateUser (user may
  // exist from a partial previous run) → if not found, show manual instructions.

  let userId: string

  // 1a. Try to create the user
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email:             TEST_EMAIL,
    password:          TEST_PASS,
    email_confirm:     true,
    user_metadata:     { name: 'Test Admin' },
  })

  if (!createErr && created.user) {
    userId = created.user.id
    console.log('✅ Auth user created:', userId)
  } else {
    // 1b. If creation failed, the user might already exist — search by email
    const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    const existing = list?.users.find(u => u.email === TEST_EMAIL)

    if (existing) {
      userId = existing.id
      console.log('✅ Auth user already exists:', userId)

      // Make sure email is confirmed and password is correct
      await supabase.auth.admin.updateUserById(userId, {
        email_confirm: true,
        password:      TEST_PASS,
      })
    } else {
      // 1c. Truly can't create — show manual fallback
      console.error('\n❌ Could not create auth user automatically.')
      console.error('   Reason:', createErr?.message)
      console.error('\n👉 MANUAL STEP required:')
      console.error('   1. Go to Supabase Dashboard → Authentication → Users')
      console.error(`   2. Click "Add User" → email: ${TEST_EMAIL}`)
      console.error(`   3. Password: ${TEST_PASS}`)
      console.error('   4. Mark email as confirmed')
      console.error('   5. Run `npm run e2e:setup` again')
      process.exit(1)
    }
  }

  // ── Step 2: Create or get the E2E Business ────────────────────────────────
  const { data: existingBiz } = await supabase
    .from('businesses')
    .select('id')
    .eq('slug', TEST_SLUG)
    .maybeSingle()

  let bizId: string
  if (!existingBiz) {
    const { data: newBiz, error: bizErr } = await supabase
      .from('businesses')
      .insert({
        name:     TEST_BIZ,
        slug:     TEST_SLUG,
        category: 'Tech',
        owner_id: userId,
      })
      .select('id')
      .single()
    if (bizErr) throw new Error(`Business creation failed: ${bizErr.message}`)
    bizId = newBiz.id
    console.log('✅ Business created:', bizId)
  } else {
    bizId = existingBiz.id
    console.log('✅ Business already exists:', bizId)
  }

  // ── Step 3: Link user to business in public.users ─────────────────────────
  const { error: upsertErr } = await supabase.from('users').upsert({
    id:          userId,
    business_id: bizId,
    name:        'Test Admin',
    email:       TEST_EMAIL,
    role:        'owner' as 'owner' | 'employee' | 'platform_admin',
  }, { onConflict: 'id' })

  if (upsertErr) {
    // Non-fatal: the user may already exist in public.users
    console.log('⚠️  public.users upsert note:', upsertErr.message)
  } else {
    console.log('✅ User linked to business in public.users')
  }

  // ── Step 4: Create E2E Service ────────────────────────────────────────────
  // services has no unique constraint on (business_id, name) — use check-then-insert
  const { data: existingSvc } = await supabase
    .from('services')
    .select('id')
    .eq('business_id', bizId)
    .eq('name', 'E2E Service')
    .maybeSingle()

  if (!existingSvc) {
    const { error: svcErr } = await supabase.from('services').insert({
      business_id:  bizId,
      name:         'E2E Service',
      duration_min: 60,
      price:        100,
      is_active:    true,
    })
    if (svcErr) console.log('⚠️  Service insert note:', svcErr.message)
    else console.log('✅ Service created')
  } else {
    console.log('✅ Service already exists')
  }

  // ── Step 5: Create E2E Client ─────────────────────────────────────────────
  // clients has no unique constraint on phone — use check-then-insert
  // clients uses deleted_at for soft-delete (no is_active column)
  const { data: existingCli } = await supabase
    .from('clients')
    .select('id')
    .eq('business_id', bizId)
    .eq('name', 'E2E Client Test')
    .is('deleted_at', null)
    .maybeSingle()

  if (!existingCli) {
    const { error: cliErr } = await supabase.from('clients').insert({
      business_id: bizId,
      name:        'E2E Client Test',
      phone:       '+10000000001',
    })
    if (cliErr) console.log('⚠️  Client insert note:', cliErr.message)
    else console.log('✅ Client created')
  } else {
    console.log('✅ Client already exists')
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n🌟 E2E DATA READY')
  console.log('─────────────────────────────────')
  console.log(`Email:    ${TEST_EMAIL}`)
  console.log(`Password: ${TEST_PASS}`)
  console.log(`Biz ID:   ${bizId}`)
  console.log('─────────────────────────────────')
  console.log('Run: npx playwright test')
}

setupTestData().catch(err => {
  console.error('❌ Setup failed:', err)
  process.exit(1)
})

