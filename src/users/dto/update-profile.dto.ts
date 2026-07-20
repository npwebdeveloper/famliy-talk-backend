import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class UpdateProfileDto {
    @ApiProperty({
        description: 'Display name shown to other users',
        example: 'Radhe',
        maxLength: 100,
    })
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    name: string;

    @ApiPropertyOptional({
        description: 'Short bio / status line',
        example: 'Hey there! I am using Family Talk',
        maxLength: 500,
    })
    @IsString()
    @IsOptional()
    @MaxLength(500)
    bio?: string;
}
