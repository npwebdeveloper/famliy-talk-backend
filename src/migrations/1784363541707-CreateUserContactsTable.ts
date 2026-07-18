import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUserContactsTable1784363541707 implements MigrationInterface {
    name = 'CreateUserContactsTable1784363541707'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`user_contacts\` (\`id\` varchar(36) NOT NULL, \`owner_id\` varchar(255) NOT NULL, \`phone_number\` varchar(255) NOT NULL, \`contact_name\` varchar(255) NOT NULL, \`is_registered\` tinyint NOT NULL DEFAULT 0, \`registered_user_id\` varchar(255) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_03d834e75750efa7dffaef23a6\` (\`owner_id\`, \`phone_number\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`user_contacts\` ADD CONSTRAINT \`FK_06671d7cc324716e4625c548afa\` FOREIGN KEY (\`owner_id\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`user_contacts\` ADD CONSTRAINT \`FK_ab2d8c3a36dfb8ebc467e2aaae1\` FOREIGN KEY (\`registered_user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`user_contacts\` DROP FOREIGN KEY \`FK_ab2d8c3a36dfb8ebc467e2aaae1\``);
        await queryRunner.query(`ALTER TABLE \`user_contacts\` DROP FOREIGN KEY \`FK_06671d7cc324716e4625c548afa\``);
        await queryRunner.query(`DROP INDEX \`IDX_03d834e75750efa7dffaef23a6\` ON \`user_contacts\``);
        await queryRunner.query(`DROP TABLE \`user_contacts\``);
    }
}
