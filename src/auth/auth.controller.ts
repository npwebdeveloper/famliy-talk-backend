import { Controller, Post, Body, UseGuards, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('send-otp')
    async sendOtp(@Body() sendOtpDto: SendOtpDto) {
        return this.authService.sendOtp(sendOtpDto);
    }

    @Post('verify-otp')
    async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
        return this.authService.verifyOtp(verifyOtpDto);
    }

    @Post('refresh-token')
    async refreshToken(@Body('refreshToken') refreshToken: string) {
        return this.authService.refreshToken(refreshToken);
    }

    @UseGuards(JwtAuthGuard)
    @Post('logout')
    async logout(@CurrentUser() user: any) {
        return this.authService.logout(user.userId);
    }

    @UseGuards(JwtAuthGuard)
    @Get('me')
    async getMe(@CurrentUser() user: any) {
        return user;
    }
}
