import { PipeTransform } from '@nestjs/common';
import type { ZodType, infer as zInfer } from 'zod';
import { Err } from './errors';

/**
 * Validates a body / query / param with a Zod schema (the same schemas the web apps use,
 * from @670send/validation). Zod messages that are i18n keys (`errors.validation.phone`)
 * are translated by the exception filter into the caller's language.
 */
export class ZodValidationPipe<S extends ZodType> implements PipeTransform<unknown, zInfer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): zInfer<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw Err.validation(
        result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    return result.data;
  }
}
