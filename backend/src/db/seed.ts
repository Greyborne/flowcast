/**
 * FlowCast Database Seed
 *
 * Seeds the database with Chaz's bill templates, income sources, and
 * generates 2 years of pay periods from today.
 *
 * Run with: npm run db:seed
 */

import { PrismaClient, IncomeType, BillType } from '@prisma/client';
import { addDays, addWeeks, startOfDay } from 'date-fns';

const prisma = new PrismaClient();

// ── Pay Period Generator ─────────────────────────────────────────────────────
// Bi-weekly starting from the next payday. Adjust FIRST_PAYDAY as needed.
const FIRST_PAYDAY = new Date('2026-03-28'); // Update to Chaz's actual next payday
const PROJECTION_YEARS = 2;
const PERIODS_COUNT = Math.ceil((PROJECTION_YEARS * 365) / 14);

async function generatePayPeriods() {
  console.log(`Generating ${PERIODS_COUNT} bi-weekly pay periods...`);
  const periods = [];

  for (let i = 0; i < PERIODS_COUNT; i++) {
    const paydayDate = addWeeks(FIRST_PAYDAY, i);
    const startDate = i === 0 ? paydayDate : addDays(addWeeks(FIRST_PAYDAY, i - 1), 1);
    const endDate = addDays(paydayDate, 13);

    periods.push({
      startDate: startOfDay(startDate),
      endDate: startOfDay(endDate),
      paydayDate: startOfDay(paydayDate),
      openingBalance: i === 0 ? 252.98 : 0, // Chaz's current balance
    });
  }

  await prisma.payPeriod.createMany({ data: periods, skipDuplicates: true });
  console.log(`✓ Created ${periods.length} pay periods`);
}

// ── Bill Templates (from spreadsheet analysis) ───────────────────────────────
const BILL_TEMPLATES = [
  // Group 1: Long-Term Credit
  { name: 'Home Mortgage',          group: '1. Long-Term Credit', dueDayOfMonth: 5,  defaultAmount: 1286.37, sortOrder: 1 },
  { name: 'Discover Personal Loan', group: '1. Long-Term Credit', dueDayOfMonth: 9,  defaultAmount: 587.12,  sortOrder: 2 },
  { name: 'Foundation (Doors)',      group: '1. Long-Term Credit', dueDayOfMonth: 2,  defaultAmount: 100.12,  sortOrder: 3 },
  { name: 'Foundation (Windows)',    group: '1. Long-Term Credit', dueDayOfMonth: 5,  defaultAmount: 141.13,  sortOrder: 4 },
  { name: 'Azure 2nd Mortgage',      group: '1. Long-Term Credit', dueDayOfMonth: 2,  defaultAmount: 0,       sortOrder: 5 },
  // Group 2: Bills
  { name: 'ATT Cell Phone',  group: '2. Bills', dueDayOfMonth: 6,  defaultAmount: 337.53, sortOrder: 1 },
  { name: 'Water',           group: '2. Bills', dueDayOfMonth: 6,  defaultAmount: 0,      sortOrder: 2 },
  { name: 'Evergy Electric', group: '2. Bills', dueDayOfMonth: 8,  defaultAmount: 0,      sortOrder: 3 },
  { name: 'Gas',             group: '2. Bills', dueDayOfMonth: 9,  defaultAmount: 95.00,  sortOrder: 4 },
  { name: 'Newshosting',     group: '2. Bills', dueDayOfMonth: 28, defaultAmount: 11.99,  sortOrder: 5 },
  { name: 'McElroys',        group: '2. Bills', dueDayOfMonth: 10, defaultAmount: 13.08,  sortOrder: 6 },
  { name: 'Genisys Gyms',    group: '2. Bills', dueDayOfMonth: 2,  defaultAmount: 135.58, sortOrder: 7 },
  { name: 'State Farm',      group: '2. Bills', dueDayOfMonth: 18, defaultAmount: 0,      sortOrder: 8 },
  { name: 'Xbox/Microsoft',  group: '2. Bills', dueDayOfMonth: 26, defaultAmount: 18.57,  sortOrder: 9 },
  { name: 'Kids Savings',    group: '2. Bills', dueDayOfMonth: 2,  defaultAmount: 20.00,  sortOrder: 10 },
  // Group 3: Vehicle Loan
  { name: 'Kia Payment',      group: '3. Vehicle Loan', dueDayOfMonth: 25, defaultAmount: 0,      sortOrder: 1 },
  { name: 'Explorer Payment', group: '3. Vehicle Loan', dueDayOfMonth: 2,  defaultAmount: 0,      sortOrder: 2 },
  { name: 'RZR Payment',      group: '3. Vehicle Loan', dueDayOfMonth: 21, defaultAmount: 0,      sortOrder: 3 },
  { name: 'Ally Car Kia',     group: '3. Vehicle Loan', dueDayOfMonth: 16, defaultAmount: 329.11, sortOrder: 4 },
  // Group 4: Credit Card Payments
  { name: 'AmazonCC',     group: '4. Credit Card Payments', dueDayOfMonth: 2,  defaultAmount: 1350.00, sortOrder: 1 },
  { name: 'PayPalCC',     group: '4. Credit Card Payments', dueDayOfMonth: 18, defaultAmount: 0,       sortOrder: 2 },
  { name: 'WorldMarkCC',  group: '4. Credit Card Payments', dueDayOfMonth: 12, defaultAmount: 70.00,   sortOrder: 3 },
  { name: 'SearsCC',      group: '4. Credit Card Payments', dueDayOfMonth: 25, defaultAmount: 87.00,   sortOrder: 4 },
  { name: 'DerithBOACC',  group: '4. Credit Card Payments', dueDayOfMonth: 3,  defaultAmount: 0,       sortOrder: 5 },
  { name: 'ChazBOACC',    group: '4. Credit Card Payments', dueDayOfMonth: 14, defaultAmount: 0,       sortOrder: 6 },
  { name: 'LowesCC',      group: '4. Credit Card Payments', dueDayOfMonth: 3,  defaultAmount: 110.00,  sortOrder: 7 },
  { name: 'DiscoverCC',   group: '4. Credit Card Payments', dueDayOfMonth: 18, defaultAmount: 250.00,  sortOrder: 8 },
  { name: 'BestBuyCC',    group: '4. Credit Card Payments', dueDayOfMonth: 2,  defaultAmount: 140.00,  sortOrder: 9 },
  { name: 'SamsCC',       group: '4. Credit Card Payments', dueDayOfMonth: 9,  defaultAmount: 0,       sortOrder: 10 },
  { name: 'KohlsCC',      group: '4. Credit Card Payments', dueDayOfMonth: 9,  defaultAmount: 0,       sortOrder: 11 },
  // Group 5: Savings
  { name: 'Savings', group: '5. Savings', dueDayOfMonth: null, defaultAmount: 50.00, sortOrder: 1 },
  // Group 6: Discretionary (no amounts — transaction-based)
  { name: 'School Costs',     group: '6. Discretionary', dueDayOfMonth: null, defaultAmount: 0, isDiscretionary: true, sortOrder: 1 },
  { name: 'Stuff',            group: '6. Discretionary', dueDayOfMonth: null, defaultAmount: 0, isDiscretionary: true, sortOrder: 2 },
  { name: 'Restaurants',      group: '6. Discretionary', dueDayOfMonth: null, defaultAmount: 0, isDiscretionary: true, sortOrder: 3 },
  { name: 'Gear & Clothing',  group: '6. Discretionary', dueDayOfMonth: null, defaultAmount: 0, isDiscretionary: true, sortOrder: 4 },
  { name: 'Home Improvements',group: '6. Discretionary', dueDayOfMonth: null, defaultAmount: 0, isDiscretionary: true, sortOrder: 5 },
  { name: 'Subscriptions',    group: '6. Discretionary', dueDayOfMonth: null, defaultAmount: 0, isDiscretionary: true, sortOrder: 6 },
  { name: 'Auto & Gas',       group: '6. Discretionary', dueDayOfMonth: null, defaultAmount: 0, isDiscretionary: true, sortOrder: 7 },
  { name: 'Groceries',        group: '6. Discretionary', dueDayOfMonth: null, defaultAmount: 0, isDiscretionary: true, sortOrder: 8 },
  { name: 'Misc',             group: '6. Discretionary', dueDayOfMonth: null, defaultAmount: 0, isDiscretionary: true, sortOrder: 9 },
  { name: 'Software',         group: '6. Discretionary', dueDayOfMonth: null, defaultAmount: 0, isDiscretionary: true, sortOrder: 10 },
  { name: 'Keep The Change',  group: '6. Discretionary', dueDayOfMonth: null, defaultAmount: 0, isDiscretionary: true, sortOrder: 11 },
];

// ── Income Sources ────────────────────────────────────────────────────────────
const INCOME_SOURCES = [
  {
    name: 'Paycheck',
    type: IncomeType.W2,
    defaultAmount: 2583.77,
    propagateOnReconcile: true,
    startDate: new Date('2026-01-01'),
  },
  {
    name: 'Freelance',
    type: IncomeType.MONTHLY_RECURRING,
    defaultAmount: 0,
    propagateOnReconcile: false,
    startDate: new Date('2026-01-01'),
  },
  {
    name: 'CT Tech Salary',
    type: IncomeType.MONTHLY_RECURRING,
    defaultAmount: 0,
    propagateOnReconcile: false,
    startDate: new Date('2026-01-01'),
  },
  {
    name: 'Misc Income',
    type: IncomeType.AD_HOC,
    defaultAmount: 0,
    propagateOnReconcile: false,
    startDate: new Date('2026-01-01'),
  },
];

async function main() {
  console.log('\n🌱 Seeding FlowCast database...\n');

  await generatePayPeriods();

  // Create bill templates
  for (const bill of BILL_TEMPLATES) {
    await prisma.billTemplate.upsert({
      where: { id: bill.name }, // Use name as temporary key
      create: { ...bill, billType: BillType.EXPENSE, isDiscretionary: bill.isDiscretionary ?? false },
      update: { defaultAmount: bill.defaultAmount },
    }).catch(() =>
      prisma.billTemplate.create({
        data: { ...bill, billType: BillType.EXPENSE, isDiscretionary: bill.isDiscretionary ?? false },
      })
    );
  }
  console.log(`✓ Created ${BILL_TEMPLATES.length} bill templates`);

  // Create income sources
  for (const source of INCOME_SOURCES) {
    await prisma.incomeSource.create({ data: source }).catch(() => {});
  }
  console.log(`✓ Created ${INCOME_SOURCES.length} income sources`);

  // Seed app settings
  await prisma.appSetting.upsert({
    where: { key: 'currentBankBalance' },
    create: { key: 'currentBankBalance', value: '252.98' },
    update: {},
  });
  console.log('✓ Seeded app settings');

  console.log('\n✅ Database seeded successfully!\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
