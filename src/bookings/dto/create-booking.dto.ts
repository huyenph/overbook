import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ example: 'user-42' })
  @IsString()
  @Length(1, 100)
  userId!: string;

  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  quantity = 1;
}
