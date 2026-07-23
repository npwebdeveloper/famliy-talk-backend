import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { UserContact } from './entities/user-contact.entity';
import { UserBlock } from './entities/user-block.entity';

@Module({
    imports: [TypeOrmModule.forFeature([User, UserContact, UserBlock])],
    controllers: [UsersController],
    providers: [UsersService],
    exports: [UsersService],
})
export class UsersModule { }
