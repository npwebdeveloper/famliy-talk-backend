import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsNotEmpty, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ContactItemDto {
    @ApiProperty({
        description: 'Contact phone number from the device phone book',
        example: '+919876543210',
    })
    @IsString()
    @IsNotEmpty()
    phoneNumber: string;

    @ApiProperty({
        description: 'Name saved in the device phone book',
        example: 'Mummy',
    })
    @IsString()
    @IsNotEmpty()
    contactName: string;
}

export class SyncContactsDto {
    @ApiProperty({
        description: 'Full phone book to sync (upserted server-side)',
        type: [ContactItemDto],
    })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ContactItemDto)
    contacts: ContactItemDto[];
}
