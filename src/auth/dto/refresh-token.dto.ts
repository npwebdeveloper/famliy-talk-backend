import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class RefreshTokenDto {
    @ApiProperty({
        description: 'Refresh token issued by POST /auth/verify-otp',
        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    })
    @IsString()
    @IsNotEmpty()
    refreshToken: string;
}
