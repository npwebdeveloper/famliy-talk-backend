import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class SendOtpDto {
    @ApiProperty({
        description: 'Phone number in international format',
        example: '+919876543210',
    })
    @IsString()
    @IsNotEmpty()
    @Matches(/^\+?[1-9]\d{1,14}$/, {
        message: 'Phone number must be in valid international format',
    })
    phoneNumber: string;
}
