/**
 * migrate-mongo pakai CommonJS agar kompatibel dengan CLI walau project pakai "type": "module".
 * Jalankan dari folder backend: npm run migrate:up
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const url = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/kandara_kas_digital";

module.exports = {
  mongodb: {
    url,
    databaseName: undefined,
    options: {},
  },
  migrationsDir: "migrations",
  changelogCollectionName: "migration_changelog",
  migrationFileExtension: ".cjs",
  useFileHash: false,
  moduleSystem: "commonjs",
};
