import { ProductCategory } from '../common/types/product-category.enum';
import { RequestStatus } from '../common/types/request-status.enum';
import { RequestType } from '../common/types/request-type.enum';
import { UserRole } from '../common/types/user-role.enum';

/** SPEC.md §9 — these exact credentials must appear in the README. */
export interface SeedUser {
  key: 'officer1' | 'officer2' | 'customer1' | 'customer2';
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
  phone?: string;
  policyNumber?: string;
}

export const SEED_USERS: SeedUser[] = [
  {
    key: 'officer1',
    email: 'officer@igi.test',
    password: 'Officer123',
    fullName: 'Adaeze Okonkwo',
    role: UserRole.OFFICER,
    phone: '+2348030000001',
  },
  {
    key: 'officer2',
    email: 'officer2@igi.test',
    password: 'Officer123',
    fullName: 'Tunde Bakare',
    role: UserRole.OFFICER,
    phone: '+2348030000002',
  },
  {
    key: 'customer1',
    email: 'customer@igi.test',
    password: 'Customer123',
    fullName: 'Chidi Nwosu',
    role: UserRole.CUSTOMER,
    phone: '+2348020000001',
    policyNumber: 'IGI-POL-0001',
  },
  {
    key: 'customer2',
    email: 'customer2@igi.test',
    password: 'Customer123',
    fullName: 'Fatima Bello',
    role: UserRole.CUSTOMER,
    phone: '+2348020000002',
    policyNumber: 'IGI-POL-0002',
  },
];

export type OfficerKey = 'officer1' | 'officer2';
export type CustomerKey = 'customer1' | 'customer2';

/**
 * One step of a request's life. The seeder replays these through the same service methods
 * the HTTP layer calls, so every transition is validated by the state machine and every
 * audit entry is written by the code under test rather than inserted by hand.
 */
export type SeedStep =
  | { action: 'assign'; officer: OfficerKey }
  | { action: 'status'; to: RequestStatus; comment?: string }
  | { action: 'respond'; message: string }
  | { action: 'withdraw' }
  | { action: 'documents'; by: 'customer' | 'officer'; files: SeedFileSpec[] };

export interface SeedFileSpec {
  fileName: string;
  kind: 'pdf' | 'png';
}

export interface SeedRequest {
  customer: CustomerKey;
  requestType: RequestType;
  productCategory: ProductCategory;
  policyNumber: string;
  description: string;
  /** Days before today. Keeps the list from looking like it was all filed at once. */
  incidentDaysAgo: number;
  serviceProvider?: string;
  estimatedAmount: number;
  steps: SeedStep[];
  /** Asserted after replay — a mismatch means the state machine changed under us. */
  expectedStatus: RequestStatus;
}

const {
  SUBMITTED,
  ASSIGNED,
  UNDER_REVIEW,
  NEEDS_ADDITIONAL_INFO,
  APPROVED,
  DENIED,
  WITHDRAWN,
} = RequestStatus;

/**
 * Twelve requests covering all seven statuses, both request types and six product
 * categories. Several walk multiple steps so the audit timeline has something to show —
 * SPEC.md §9 is explicit that one entry each is not enough.
 *
 * `description` doubles as the natural key for idempotency, so keep them distinct.
 */
export const SEED_REQUESTS: SeedRequest[] = [
  {
    customer: 'customer1',
    requestType: RequestType.INSURANCE_CLAIM,
    productCategory: ProductCategory.MOTOR,
    policyNumber: 'IGI-POL-0001',
    description:
      'Windscreen shattered by debris on the Lekki-Epe expressway during the morning commute.',
    incidentDaysAgo: 3,
    estimatedAmount: 185000,
    steps: [],
    expectedStatus: SUBMITTED,
  },
  {
    customer: 'customer2',
    requestType: RequestType.HMO_PRE_AUTHORIZATION,
    productCategory: ProductCategory.HEALTH,
    policyNumber: 'IGI-POL-0002',
    description:
      'Pre-authorization requested for a scheduled MRI scan of the lumbar spine.',
    incidentDaysAgo: 2,
    serviceProvider: 'Reddington Hospital, Victoria Island',
    estimatedAmount: 320000,
    steps: [],
    expectedStatus: SUBMITTED,
  },
  {
    customer: 'customer1',
    requestType: RequestType.INSURANCE_CLAIM,
    productCategory: ProductCategory.PROPERTY,
    policyNumber: 'IGI-POL-0001',
    description:
      'Storm damage to the roof and guttering of the insured property in Ikeja GRA.',
    incidentDaysAgo: 9,
    estimatedAmount: 1450000,
    steps: [{ action: 'assign', officer: 'officer1' }],
    expectedStatus: ASSIGNED,
  },
  {
    customer: 'customer2',
    requestType: RequestType.HMO_PRE_AUTHORIZATION,
    productCategory: ProductCategory.HEALTH,
    policyNumber: 'IGI-POL-0002',
    description:
      'Pre-authorization for an elective day-case arthroscopy of the knee.',
    incidentDaysAgo: 6,
    serviceProvider: 'Lagoon Hospitals, Ikoyi',
    estimatedAmount: 890000,
    steps: [{ action: 'assign', officer: 'officer2' }],
    expectedStatus: ASSIGNED,
  },
  {
    customer: 'customer1',
    requestType: RequestType.INSURANCE_CLAIM,
    productCategory: ProductCategory.TRAVEL,
    policyNumber: 'IGI-POL-0001',
    description:
      'Baggage lost in transit on a return flight from Nairobi; contents itemised.',
    incidentDaysAgo: 14,
    estimatedAmount: 465000,
    steps: [
      { action: 'assign', officer: 'officer1' },
      { action: 'status', to: UNDER_REVIEW },
    ],
    expectedStatus: UNDER_REVIEW,
  },
  {
    customer: 'customer2',
    requestType: RequestType.INSURANCE_CLAIM,
    productCategory: ProductCategory.MARINE,
    policyNumber: 'IGI-POL-0002',
    description:
      'Cargo container damaged by water ingress during shipping from Tema to Apapa.',
    incidentDaysAgo: 21,
    estimatedAmount: 3750000,
    steps: [
      { action: 'assign', officer: 'officer2' },
      { action: 'status', to: UNDER_REVIEW },
      {
        action: 'documents',
        by: 'customer',
        files: [
          { fileName: 'bill-of-lading.pdf', kind: 'pdf' },
          { fileName: 'container-damage.png', kind: 'png' },
        ],
      },
    ],
    expectedStatus: UNDER_REVIEW,
  },
  {
    customer: 'customer1',
    requestType: RequestType.INSURANCE_CLAIM,
    productCategory: ProductCategory.MOTOR,
    policyNumber: 'IGI-POL-0001',
    description:
      'Rear-end collision at the Ozumba Mbadiwe roundabout; third party details supplied.',
    incidentDaysAgo: 11,
    estimatedAmount: 720000,
    steps: [
      { action: 'assign', officer: 'officer1' },
      { action: 'status', to: UNDER_REVIEW },
      {
        action: 'status',
        to: NEEDS_ADDITIONAL_INFO,
        comment:
          'Please upload the police report and a photograph showing the rear bumper.',
      },
    ],
    expectedStatus: NEEDS_ADDITIONAL_INFO,
  },
  {
    customer: 'customer2',
    requestType: RequestType.HMO_PRE_AUTHORIZATION,
    productCategory: ProductCategory.HEALTH,
    policyNumber: 'IGI-POL-0002',
    description:
      'Pre-authorization for a course of physiotherapy following a shoulder injury.',
    incidentDaysAgo: 8,
    serviceProvider: 'St Nicholas Hospital, Lagos Island',
    estimatedAmount: 275000,
    steps: [
      { action: 'assign', officer: 'officer2' },
      { action: 'status', to: UNDER_REVIEW },
      {
        action: 'status',
        to: NEEDS_ADDITIONAL_INFO,
        comment:
          'We need the referring physician’s letter before we can authorise this.',
      },
    ],
    expectedStatus: NEEDS_ADDITIONAL_INFO,
  },
  {
    customer: 'customer1',
    requestType: RequestType.INSURANCE_CLAIM,
    productCategory: ProductCategory.LIFE,
    policyNumber: 'IGI-POL-0001',
    description:
      'Critical illness benefit claimed under the life policy, with hospital discharge summary.',
    incidentDaysAgo: 30,
    estimatedAmount: 5200000,
    // The full round trip: the richest audit trail in the seed set.
    steps: [
      { action: 'assign', officer: 'officer1' },
      { action: 'status', to: UNDER_REVIEW },
      {
        action: 'status',
        to: NEEDS_ADDITIONAL_INFO,
        comment: 'Kindly attach the consultant’s discharge summary.',
      },
      {
        action: 'respond',
        message:
          'Discharge summary attached as requested, reference LUTH/2026/8842.',
      },
      {
        action: 'documents',
        by: 'customer',
        files: [
          { fileName: 'discharge-summary.pdf', kind: 'pdf' },
          { fileName: 'policy-schedule.pdf', kind: 'pdf' },
        ],
      },
      { action: 'status', to: APPROVED },
    ],
    expectedStatus: APPROVED,
  },
  {
    customer: 'customer2',
    requestType: RequestType.HMO_PRE_AUTHORIZATION,
    productCategory: ProductCategory.HEALTH,
    policyNumber: 'IGI-POL-0002',
    description:
      'Pre-authorization for a routine antenatal ultrasound package.',
    incidentDaysAgo: 17,
    serviceProvider: 'First Consultants Medical Centre',
    estimatedAmount: 145000,
    steps: [
      { action: 'assign', officer: 'officer2' },
      { action: 'status', to: UNDER_REVIEW },
      { action: 'status', to: APPROVED },
    ],
    expectedStatus: APPROVED,
  },
  {
    customer: 'customer1',
    requestType: RequestType.INSURANCE_CLAIM,
    productCategory: ProductCategory.MOTOR,
    policyNumber: 'IGI-POL-0001',
    description:
      'Claim for alloy wheel damage sustained on an unpaved access road in Epe.',
    incidentDaysAgo: 25,
    estimatedAmount: 95000,
    steps: [
      { action: 'assign', officer: 'officer1' },
      { action: 'status', to: UNDER_REVIEW },
      {
        action: 'status',
        to: DENIED,
        comment:
          'Wear-and-tear to wheels on unpaved roads is excluded under section 4(b) of the policy.',
      },
    ],
    expectedStatus: DENIED,
  },
  {
    customer: 'customer2',
    requestType: RequestType.INSURANCE_CLAIM,
    productCategory: ProductCategory.PROPERTY,
    policyNumber: 'IGI-POL-0002',
    description:
      'Water damage to a ground-floor shop unit following a burst mains pipe in Yaba.',
    incidentDaysAgo: 19,
    estimatedAmount: 1180000,
    steps: [
      { action: 'assign', officer: 'officer2' },
      { action: 'status', to: UNDER_REVIEW },
      {
        action: 'status',
        to: NEEDS_ADDITIONAL_INFO,
        comment: 'Please provide the plumber’s report confirming the cause.',
      },
      { action: 'withdraw' },
    ],
    expectedStatus: WITHDRAWN,
  },
];
