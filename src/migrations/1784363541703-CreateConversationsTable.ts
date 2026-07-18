import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateConversationsTable1784363541703 implements MigrationInterface {
    name = 'CreateConversationsTable1784363541703'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`conversations\` (\`id\` varchar(36) NOT NULL, \`type\` enum ('private', 'group') NOT NULL DEFAULT 'private', \`name\` varchar(255) NULL, \`avatar_url\` varchar(255) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE \`conversations\``);
    }
}
