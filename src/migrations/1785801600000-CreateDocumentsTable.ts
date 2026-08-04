import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateDocumentsTable1785801600000 implements MigrationInterface {
    name = 'CreateDocumentsTable1785801600000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`documents\` (\`id\` varchar(36) NOT NULL, \`owner_id\` varchar(255) NOT NULL, \`s3_key\` varchar(255) NOT NULL, \`original_name\` varchar(255) NOT NULL, \`mime_type\` varchar(255) NOT NULL, \`size\` int NOT NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`IDX_documents_owner_created\` (\`owner_id\`, \`created_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`documents\` ADD CONSTRAINT \`FK_documents_owner_id\` FOREIGN KEY (\`owner_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`documents\` DROP FOREIGN KEY \`FK_documents_owner_id\``);
        await queryRunner.query(`DROP INDEX \`IDX_documents_owner_created\` ON \`documents\``);
        await queryRunner.query(`DROP TABLE \`documents\``);
    }
}
