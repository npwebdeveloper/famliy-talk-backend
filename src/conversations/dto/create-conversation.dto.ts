import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, ArrayMinSize } from 'class-validator';

export class CreateConversationDto {
    @ApiProperty({
        description:
            'User IDs to include (current user is added automatically). ' +
            '2 total participants = private chat (existing one is returned if it already exists), 3+ = group.',
        example: ['2a01950c-837d-4842-80d9-feec2c96999b'],
        type: [String],
    })
    @IsArray()
    @ArrayMinSize(1)
    @IsNotEmpty({ each: true })
    participantIds: string[];
}
