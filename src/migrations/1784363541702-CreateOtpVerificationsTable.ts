import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateOtpVerificationsTable1784363541702 implements MigrationInterface {
    name = 'CreateOtpVerificationsTable1784363541702'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`otp_verifications\` (\`id\` varchar(36) NOT NULL, \`phone_number\` varchar(255) NOT NULL, \`otp_code\` varchar(255) NOT NULL, \`expires_at\` timestamp NOT NULL, \`is_verified\` tinyint NOT NULL DEFAULT 0, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE \`otp_verifications\``);
    }
}
