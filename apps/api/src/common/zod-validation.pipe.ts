import { PipeTransform, UnprocessableEntityException } from '@nestjs/common';
import { ZodSchema } from 'zod';

// Validates incoming request body/params against the provided Zod schema.
// On failure returns 422 with structured error details.
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new UnprocessableEntityException({
        message: 'Validation failed',
        details: result.error.flatten(),
      });
    }
    return result.data;
  }
}
