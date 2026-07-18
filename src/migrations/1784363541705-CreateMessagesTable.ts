import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMessagesTable1784363541705 implements MigrationInterface {
    name = 'CreateMessagesTable1784363541705'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`messages\` (\`id\` varchar(36) NOT NULL, \`conversation_id\` varchar(255) NOT NULL, \`sender_id\` varchar(255) NOT NULL, \`text\` text NULL, \`type\` enum ('text', 'image', 'video', 'audio') NOT NULL DEFAULT 'text', \`media_url\` varchar(255) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`IDX_3bc55a7c3f9ed54b520bb5cfe2\` (\`conversation_id\`), INDEX \`IDX_0777b63da90c27d6ed993dc60b\` (\`created_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`messages\` ADD CONSTRAINT \`FK_3bc55a7c3f9ed54b520bb5cfe23\` FOREIGN KEY (\`conversation_id\`) REFERENCES \`conversations\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`messages\` ADD CONSTRAINT \`FK_22133395bd13b970ccd0c34ab22\` FOREIGN KEY (\`sender_id\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`messages\` DROP FOREIGN KEY \`FK_22133395bd13b970ccd0c34ab22\``);
        await queryRunner.query(`ALTER TABLE \`messages\` DROP FOREIGN KEY \`FK_3bc55a7c3f9ed54b520bb5cfe23\``);
        await queryRunner.query(`DROP INDEX \`IDX_0777b63da90c27d6ed993dc60b\` ON \`messages\``);
        await queryRunner.query(`DROP INDEX \`IDX_3bc55a7c3f9ed54b520bb5cfe2\` ON \`messages\``);
        await queryRunner.query(`DROP TABLE \`messages\``);
    }
}
