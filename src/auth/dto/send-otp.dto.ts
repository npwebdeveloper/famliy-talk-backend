import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class SendOtpDto {
    @IsString()
    @IsNotEmpty()
    @Matches(/^\+?[1-9]\d{1,14}$/, {
        message: 'Phone number must be in valid international format',
    })
    phoneNumber: string;
}
