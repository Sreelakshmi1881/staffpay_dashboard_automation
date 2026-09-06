import * as dotenv from 'dotenv';
dotenv.config();

/** Test data and environment values - the config.properties equivalent. */
export const config = {
  vendorNumber: process.env.VENDOR_NUMBER ?? '9519519514',
  opsNumber: process.env.OPS_NUMBER ?? '',

  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? '',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'titan',
  },
};
