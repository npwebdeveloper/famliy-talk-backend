import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUsersTable1784363541701 implements MigrationInterface {
    name = 'CreateUsersTable1784363541701'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`users\` (\`id\` varchar(36) NOT NULL, \`phone_number\` varchar(255) NOT NULL, \`name\` varchar(255) NOT NULL, \`bio\` text NULL, \`avatar_url\` varchar(255) NULL, \`is_online\` tinyint NOT NULL DEFAULT 0, \`last_seen\` timestamp NULL, \`fcm_token\` varchar(512) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_17d1817f241f10a3dbafb169fd\` (\`phone_number\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`IDX_17d1817f241f10a3dbafb169fd\` ON \`users\``);
        await queryRunner.query(`DROP TABLE \`users\``);
    }
}
