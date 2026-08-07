import { model } from 'mongoose';

import { AuditLogSchema } from '../../audit/schemas/audit-log.schema';
import { RequestStatus } from '../../common/types/request-status.enum';
import { RequestType } from '../../common/types/request-type.enum';
import { ProductCategory } from '../../common/types/product-category.enum';
import { CounterSchema } from './counter.schema';
import { RequestSchema } from './request.schema';

/**
 * Building the schemas is itself the test: SchemaFactory throws at import time for a
 * property whose Mongoose type it cannot infer (a TS enum without `type: String`, say),
 * which the TypeScript compiler cannot catch — it only shows up at boot.
 */
describe('request schemas', () => {
  const RequestModel = model('RequestSchemaSpec', RequestSchema);

  const build = (overrides: Record<string, unknown> = {}) =>
    new RequestModel({
      requestNumber: 'CLM-2026-000001',
      customer: '507f1f77bcf86cd799439011',
      requestType: RequestType.INSURANCE_CLAIM,
      productCategory: ProductCategory.MOTOR,
      policyNumber: 'IGI-POL-0001',
      description: 'A description comfortably over ten characters.',
      incidentDate: new Date('2026-07-15'),
      estimatedAmount: 250000,
      ...overrides,
    });

  it('compiles every schema without a connection', () => {
    expect(() => model('CounterSchemaSpec', CounterSchema)).not.toThrow();
    expect(() => model('AuditLogSchemaSpec', AuditLogSchema)).not.toThrow();
  });

  it('defaults status to SUBMITTED and leaves the request unassigned', () => {
    const doc = build();
    expect(doc.status).toBe(RequestStatus.SUBMITTED);
    expect(doc.assignedOfficer).toBeNull();
    expect(doc.documents).toEqual([]);
  });

  it('validates a well-formed request', () => {
    expect(build().validateSync()).toBeUndefined();
  });

  it('rejects a description under 10 characters', () => {
    expect(
      build({ description: 'too short' }).validateSync()?.errors.description,
    ).toBeDefined();
  });

  it('rejects a non-positive amount', () => {
    expect(
      build({ estimatedAmount: 0 }).validateSync()?.errors.estimatedAmount,
    ).toBeDefined();
  });

  it('rejects a status outside the enum', () => {
    expect(
      build({ status: 'MADE_UP' }).validateSync()?.errors.status,
    ).toBeDefined();
  });

  it('declares every index SPEC §5 lists', () => {
    const declared = RequestSchema.indexes().map(([fields]) =>
      JSON.stringify(fields),
    );

    expect(declared).toContain(JSON.stringify({ customer: 1, createdAt: -1 }));
    expect(declared).toContain(
      JSON.stringify({
        status: 1,
        requestType: 1,
        productCategory: 1,
        createdAt: -1,
      }),
    );
    expect(declared).toContain(
      JSON.stringify({ assignedOfficer: 1, status: 1 }),
    );
    expect(declared).toContain(
      JSON.stringify({
        requestNumber: 'text',
        description: 'text',
        policyNumber: 'text',
      }),
    );
    // requestNumber uniqueness is declared on the @Prop rather than via .index().
    expect(RequestSchema.path('requestNumber').options).toMatchObject({
      unique: true,
    });
  });

  it('indexes the audit trail by request and time', () => {
    const declared = AuditLogSchema.indexes().map(([fields]) =>
      JSON.stringify(fields),
    );
    expect(declared).toContain(JSON.stringify({ request: 1, createdAt: 1 }));
  });

  it('keeps the audit trail append-only — no updatedAt', () => {
    expect(AuditLogSchema.path('updatedAt')).toBeUndefined();
    expect(AuditLogSchema.path('createdAt')).toBeDefined();
  });

  it('embeds documents with no _id of their own', () => {
    const doc = build({
      documents: [
        {
          url: 'https://res.cloudinary.com/x.pdf',
          publicId: 'igi-portal/requests/1/x',
          fileName: 'x.pdf',
          mimeType: 'application/pdf',
          size: 1024,
          uploadedBy: '507f1f77bcf86cd799439011',
        },
      ],
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.documents[0]).not.toHaveProperty('_id');
    expect(doc.documents[0].uploadedAt).toBeInstanceOf(Date);
  });
});
