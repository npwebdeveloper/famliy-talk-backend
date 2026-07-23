import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCallStatsColumns1784363541710 implements MigrationInterface {
    name = 'AddCallStatsColumns1784363541710'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`calls\` ADD \`ice_failures\` int NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`calls\` ADD \`reconnect_count\` int NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`calls\` ADD \`final_ice_state\` varchar(32) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`calls\` DROP COLUMN \`final_ice_state\``);
        await queryRunner.query(`ALTER TABLE \`calls\` DROP COLUMN \`reconnect_count\``);
        await queryRunner.query(`ALTER TABLE \`calls\` DROP COLUMN \`ice_failures\``);
    }
}
