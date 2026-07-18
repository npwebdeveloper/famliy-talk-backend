import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMessageStatusTable1784363541706 implements MigrationInterface {
    name = 'CreateMessageStatusTable1784363541706'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`message_status\` (\`id\` varchar(36) NOT NULL, \`message_id\` varchar(255) NOT NULL, \`user_id\` varchar(255) NOT NULL, \`status\` enum ('sent', 'delivered', 'read') NOT NULL DEFAULT 'sent', \`timestamp\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`delivered_at\` timestamp NULL, \`read_at\` timestamp NULL, UNIQUE INDEX \`IDX_758651259f9427ebf95e063c0f\` (\`message_id\`, \`user_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`message_status\` ADD CONSTRAINT \`FK_ff8dd09dba401134707f7fdafd1\` FOREIGN KEY (\`message_id\`) REFERENCES \`messages\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`message_status\` ADD CONSTRAINT \`FK_4ae52d84e883c882b2f964d852f\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`message_status\` DROP FOREIGN KEY \`FK_4ae52d84e883c882b2f964d852f\``);
        await queryRunner.query(`ALTER TABLE \`message_status\` DROP FOREIGN KEY \`FK_ff8dd09dba401134707f7fdafd1\``);
        await queryRunner.query(`DROP INDEX \`IDX_758651259f9427ebf95e063c0f\` ON \`message_status\``);
        await queryRunner.query(`DROP TABLE \`message_status\``);
    }
}
