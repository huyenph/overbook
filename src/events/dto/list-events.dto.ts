import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * Q55 — keyset (cursor) pagination, not OFFSET. `OFFSET 100000` makes Postgres
 * walk and discard 100 000 rows on every page; `WHERE id > :cursor` does not.
 */
export class ListEventsDto {
  @ApiPropertyOptional({ description: 'Id of the last row from the previous page.' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
