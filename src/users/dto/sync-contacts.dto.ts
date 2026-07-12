import { IsArray, IsString, IsNotEmpty, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ContactItemDto {
    @IsString()
    @IsNotEmpty()
    phoneNumber: string;

    @IsString()
    @IsNotEmpty()
    contactName: string;
}

export class SyncContactsDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ContactItemDto)
    contacts: ContactItemDto[];
}
