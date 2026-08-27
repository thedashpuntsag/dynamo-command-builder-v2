import { z } from 'zod';

export const genericRecordSch = z.record(z.string(), z.unknown());
export type GenericRecord = z.infer<typeof genericRecordSch>;

export const requiredStringSch = z.string().trim().min(1);
export type RequiredString = z.infer<typeof requiredStringSch>;

export const optStringSch = z.preprocess((value) => {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }

  return typeof value === 'string' ? value.trim() : value;
}, z.string().optional());
export type OptString = z.infer<typeof optStringSch>;
