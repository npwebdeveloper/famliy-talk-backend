import { Controller, Post, Body, UseGuards, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('send-otp')
    @ApiOperation({
        summary: 'Send OTP to a phone number',
        description: 'Rate limited: max 3 OTPs per phone per hour. OTP expires in 5 minutes. Dev OTP is static (123456).',
    })
    @ApiResponse({ status: 201, description: 'OTP sent successfully' })
    @ApiResponse({ status: 400, description: 'Invalid phone number or rate limit exceeded' })
    async sendOtp(@Body() sendOtpDto: SendOtpDto) {
        return this.authService.sendOtp(sendOtpDto);
    }

    @Post('verify-otp')
    @ApiOperation({
        summary: 'Verify OTP and login/register',
        description: 'Creates the user on first login. Returns accessToken + refreshToken + user profile. Also notifies contacts who had this number saved (contact-joined push).',
    })
    @ApiResponse({ status: 201, description: 'Verified — returns tokens and user' })
    @ApiResponse({ status: 401, description: 'Invalid or expired OTP' })
    async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
        return this.authService.verifyOtp(verifyOtpDto);
    }

    @Post('refresh-token')
    @ApiOperation({ summary: 'Exchange a refresh token for new access + refresh tokens' })
    @ApiResponse({ status: 201, description: 'New token pair issued' })
    @ApiResponse({ status: 401, description: 'Invalid refresh token' })
    async refreshToken(@Body() refreshTokenDto: RefreshTokenDto) {
        return this.authService.refreshToken(refreshTokenDto.refreshToken);
    }

    @UseGuards(JwtAuthGuard)
    @Post('logout')
    @ApiBearerAuth('JWT-auth')
    @ApiOperation({
        summary: 'Logout current user',
        description: 'Sets isOnline=false and clears the FCM token so this device stops receiving pushes.',
    })
    @ApiResponse({ status: 201, description: 'Logged out' })
    @ApiResponse({ status: 401, description: 'Missing/invalid access token' })
    async logout(@CurrentUser() user: any) {
        return this.authService.logout(user.userId);
    }

    @UseGuards(JwtAuthGuard)
    @Get('me')
    @ApiBearerAuth('JWT-auth')
    @ApiOperation({ summary: 'Get the user identity embedded in the access token' })
    @ApiResponse({ status: 200, description: 'Token payload (userId, phoneNumber)' })
    @ApiResponse({ status: 401, description: 'Missing/invalid access token' })
    async getMe(@CurrentUser() user: any) {
        return user;
    }
}
