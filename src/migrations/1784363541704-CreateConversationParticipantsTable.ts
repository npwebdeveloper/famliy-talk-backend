import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateConversationParticipantsTable1784363541704 implements MigrationInterface {
    name = 'CreateConversationParticipantsTable1784363541704'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`conversation_participants\` (\`id\` varchar(36) NOT NULL, \`conversation_id\` varchar(255) NOT NULL, \`user_id\` varchar(255) NOT NULL, \`joined_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`last_read_at\` timestamp NULL, UNIQUE INDEX \`IDX_fdcd6405d74e797f10fa836033\` (\`conversation_id\`, \`user_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`conversation_participants\` ADD CONSTRAINT \`FK_1559e8a16b828f2e836a2312800\` FOREIGN KEY (\`conversation_id\`) REFERENCES \`conversations\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`conversation_participants\` ADD CONSTRAINT \`FK_377d4041a495b81ee1a85ae026f\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`conversation_participants\` DROP FOREIGN KEY \`FK_377d4041a495b81ee1a85ae026f\``);
        await queryRunner.query(`ALTER TABLE \`conversation_participants\` DROP FOREIGN KEY \`FK_1559e8a16b828f2e836a2312800\``);
        await queryRunner.query(`DROP INDEX \`IDX_fdcd6405d74e797f10fa836033\` ON \`conversation_participants\``);
        await queryRunner.query(`DROP TABLE \`conversation_participants\``);
    }
}
