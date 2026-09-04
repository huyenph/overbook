import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsString, Length, Min } from 'class-validator';

export class CreateEventDto {
  @ApiProperty({ example: 'Midnight Flash Sale — Arena Tour' })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ example: 'Hanoi Opera House' })
  @IsString()
  @Length(1, 200)
  venue!: string;

  @ApiProperty({ example: 100, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalSeats!: number;

  @ApiProperty({ example: 25000, description: 'Price per seat in the smallest currency unit.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceCents!: number;

  @ApiProperty({
    example: '2026-12-01T12:00:00Z',
    description: 'ISO-8601 instant. Stored as timestamptz; send UTC or an explicit offset.',
  })
  @IsDateString()
  startsAt!: string;
}
