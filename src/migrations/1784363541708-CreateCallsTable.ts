import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateCallsTable1784363541708 implements MigrationInterface {
    name = 'CreateCallsTable1784363541708'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`calls\` (\`id\` varchar(36) NOT NULL, \`conversation_id\` varchar(255) NOT NULL, \`caller_id\` varchar(255) NOT NULL, \`callee_id\` varchar(255) NOT NULL, \`type\` enum ('audio', 'video') NOT NULL, \`status\` enum ('ringing', 'ongoing', 'ended', 'missed', 'rejected', 'cancelled', 'busy') NOT NULL DEFAULT 'ringing', \`started_at\` timestamp NULL, \`ended_at\` timestamp NULL, \`duration_seconds\` int NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`IDX_calls_conversation_id\` (\`conversation_id\`), INDEX \`IDX_calls_status\` (\`status\`), INDEX \`IDX_calls_created_at\` (\`created_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`calls\` ADD CONSTRAINT \`FK_calls_conversation_id\` FOREIGN KEY (\`conversation_id\`) REFERENCES \`conversations\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`calls\` ADD CONSTRAINT \`FK_calls_caller_id\` FOREIGN KEY (\`caller_id\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`calls\` ADD CONSTRAINT \`FK_calls_callee_id\` FOREIGN KEY (\`callee_id\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`calls\` DROP FOREIGN KEY \`FK_calls_callee_id\``);
        await queryRunner.query(`ALTER TABLE \`calls\` DROP FOREIGN KEY \`FK_calls_caller_id\``);
        await queryRunner.query(`ALTER TABLE \`calls\` DROP FOREIGN KEY \`FK_calls_conversation_id\``);
        await queryRunner.query(`DROP INDEX \`IDX_calls_created_at\` ON \`calls\``);
        await queryRunner.query(`DROP INDEX \`IDX_calls_status\` ON \`calls\``);
        await queryRunner.query(`DROP INDEX \`IDX_calls_conversation_id\` ON \`calls\``);
        await queryRunner.query(`DROP TABLE \`calls\``);
    }
}
