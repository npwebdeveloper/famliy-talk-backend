import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIsActiveAndUserBlocks1784363541709 implements MigrationInterface {
    name = 'AddIsActiveAndUserBlocks1784363541709'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`users\` ADD \`is_active\` tinyint NOT NULL DEFAULT 1`);

        await queryRunner.query(`CREATE TABLE \`user_blocks\` (\`id\` varchar(36) NOT NULL, \`blocker_id\` varchar(255) NOT NULL, \`blocked_id\` varchar(255) NOT NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_user_blocks_pair\` (\`blocker_id\`, \`blocked_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`user_blocks\` ADD CONSTRAINT \`FK_user_blocks_blocker_id\` FOREIGN KEY (\`blocker_id\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`user_blocks\` ADD CONSTRAINT \`FK_user_blocks_blocked_id\` FOREIGN KEY (\`blocked_id\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`user_blocks\` DROP FOREIGN KEY \`FK_user_blocks_blocked_id\``);
        await queryRunner.query(`ALTER TABLE \`user_blocks\` DROP FOREIGN KEY \`FK_user_blocks_blocker_id\``);
        await queryRunner.query(`DROP INDEX \`IDX_user_blocks_pair\` ON \`user_blocks\``);
        await queryRunner.query(`DROP TABLE \`user_blocks\``);

        await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`is_active\``);
    }
}
