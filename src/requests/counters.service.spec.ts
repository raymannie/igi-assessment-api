import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { RequestType } from '../common/types/request-type.enum';
import { CountersService } from './counters.service';
import { Counter } from './schemas/counter.schema';

describe('CountersService', () => {
  let service: CountersService;
  let findOneAndUpdate: jest.Mock;

  beforeEach(async () => {
    findOneAndUpdate = jest.fn().mockReturnValue({
      lean: () => ({
        exec: () => Promise.resolve({ _id: 'CLM-2026', seq: 1 }),
      }),
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        CountersService,
        {
          provide: getModelToken(Counter.name),
          useValue: { findOneAndUpdate },
        },
      ],
    }).compile();

    service = moduleRef.get(CountersService);
  });

  it('formats an insurance claim as CLM-{year}-{6 digits}', async () => {
    const number = await service.nextRequestNumber(
      RequestType.INSURANCE_CLAIM,
      new Date('2026-03-04T00:00:00Z'),
    );
    expect(number).toBe('CLM-2026-000001');
  });

  it('formats a pre-authorization as PRE-{year}-{6 digits}', async () => {
    const number = await service.nextRequestNumber(
      RequestType.HMO_PRE_AUTHORIZATION,
      new Date('2026-03-04T00:00:00Z'),
    );
    expect(number).toBe('PRE-2026-000001');
  });

  it('increments atomically and upserts, never counting documents', async () => {
    await service.nextRequestNumber(
      RequestType.INSURANCE_CLAIM,
      new Date('2026-03-04T00:00:00Z'),
    );

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'CLM-2026' },
      { $inc: { seq: 1 } },
      expect.objectContaining({ upsert: true, new: true }),
    );
  });

  it('keys the sequence per type and year, so numbering restarts each January', async () => {
    await service.nextRequestNumber(
      RequestType.INSURANCE_CLAIM,
      new Date('2027-01-01T00:00:00Z'),
    );
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'CLM-2027' },
      expect.anything(),
      expect.anything(),
    );
  });

  it('pads a large sequence to six digits without truncating', async () => {
    findOneAndUpdate.mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve({ seq: 1234567 }) }),
    });
    const number = await service.nextRequestNumber(
      RequestType.INSURANCE_CLAIM,
      new Date('2026-03-04T00:00:00Z'),
    );
    expect(number).toBe('CLM-2026-1234567');
  });
});
