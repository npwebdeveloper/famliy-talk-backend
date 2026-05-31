import { IsString, IsNotEmpty, Length, Matches } from 'class-validator';

export class VerifyOtpDto {
    @IsString()
    @IsNotEmpty()
    @Matches(/^\+?[1-9]\d{1,14}$/, {
        message: 'Phone number must be in valid international format',
    })
    phoneNumber: string;

    @IsString()
    @IsNotEmpty()
    @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
    otp: string;
}
