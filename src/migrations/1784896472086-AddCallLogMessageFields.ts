import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCallLogMessageFields1784896472086 implements MigrationInterface {
    name = 'AddCallLogMessageFields1784896472086'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`messages\` ADD \`call_type\` enum ('audio', 'video') NULL`);
        await queryRunner.query(`ALTER TABLE \`messages\` ADD \`call_status\` enum ('completed', 'missed', 'rejected', 'cancelled') NULL`);
        await queryRunner.query(`ALTER TABLE \`messages\` ADD \`call_duration_seconds\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`messages\` CHANGE \`type\` \`type\` enum ('text', 'image', 'video', 'audio', 'call') NOT NULL DEFAULT 'text'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`messages\` CHANGE \`type\` \`type\` enum ('text', 'image', 'video', 'audio') NOT NULL DEFAULT 'text'`);
        await queryRunner.query(`ALTER TABLE \`messages\` DROP COLUMN \`call_duration_seconds\``);
        await queryRunner.query(`ALTER TABLE \`messages\` DROP COLUMN \`call_status\``);
        await queryRunner.query(`ALTER TABLE \`messages\` DROP COLUMN \`call_type\``);
    }

}
