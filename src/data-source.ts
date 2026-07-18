import 'dotenv/config';
import { DataSource } from 'typeorm';

/**
 * TypeORM CLI DataSource — used ONLY by migration commands
 * (migration:generate / migration:run / migration:revert).
 * The running app configures its own connection in app.module.ts.
 *
 * Works from both src/ (ts-node, local dev) and dist/ (compiled, production).
 */
export const AppDataSource = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    entities: [__dirname + '/**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/migrations/*{.ts,.js}'],
    synchronize: false,
    logging: true,
});
