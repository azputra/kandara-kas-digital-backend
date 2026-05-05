/**
 * Index tambahan di luar schema Mongoose (idempotent).
 * Ekstensi .cjs karena package.json memakai "type": "module".
 */
module.exports = {
  async up(db) {
    await db.collection("users").createIndex({ email: 1 }, { unique: true });
    await db.collection("payments").createIndex({ orderId: 1 }, { unique: true });
    await db.collection("payments").createIndex({ organizationId: 1, status: 1 });
    await db.collection("expenses").createIndex({ organizationId: 1, occurredAt: -1 });
  },

  async down(db) {
    await db.collection("expenses").dropIndex("organizationId_1_occurredAt_-1").catch(() => {});
    await db.collection("payments").dropIndex("organizationId_1_status_1").catch(() => {});
    await db.collection("payments").dropIndex("orderId_1").catch(() => {});
    await db.collection("users").dropIndex("email_1").catch(() => {});
  },
};
