import { IsArray, IsNotEmpty, ArrayMinSize } from 'class-validator';

export class CreateConversationDto {
    @IsArray()
    @ArrayMinSize(1)
    @IsNotEmpty({ each: true })
    participantIds: string[];
}
